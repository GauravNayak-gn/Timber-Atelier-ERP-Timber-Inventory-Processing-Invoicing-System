import { db } from "@/lib/db";
import { NotFoundError, round2 } from "@/lib/api-error";
import type {
  ForwardTrace,
  BackwardTrace,
  InvoiceStatus,
  OutputType,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Traceability — lot genealogy across the full chain:
//   PURCHASE → PROCESSING batch → FINISHED lot → INVOICE
// traceForward: raw-material lot ⇒ what was made from it & who bought it
// traceBackward: invoice number / finished lot ⇒ which raw lots
//                and supplier POs fed it
// ─────────────────────────────────────────────────────────────

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : "";
}

async function supplierInfo(supplierId: number | null | undefined) {
  if (!supplierId) return { name: "Unknown supplier", gst: null as string | null };
  const s = await db.supplier.findUnique({ where: { id: supplierId } });
  return { name: s?.companyName ?? "Unknown supplier", gst: s?.gstNumber ?? null };
}

interface PurchaseLedger {
  id: number;
  referenceNumber: string;
  lotNumber: string;
  stockIn: number;
  unitRate: number;
  timestamp: Date;
  supplierId: number | null;
}

/** All PURCHASE ledger entries for a raw-material lot (chronological). */
async function purchasesForLot(lotNumber: string): Promise<PurchaseLedger[]> {
  return db.inventoryTransaction.findMany({
    where: { lotNumber, referenceType: "PURCHASE" },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
  });
}

// ── Forward ──────────────────────────────────────────────────

export async function traceForward(lotNumber: string): Promise<ForwardTrace> {
  // Root: first PURCHASE for the lot, else the first PROCESSING_INPUT.
  const purchaseEntry =
    (await db.inventoryTransaction.findFirst({
      where: { lotNumber, referenceType: "PURCHASE" },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    })) ??
    (await db.inventoryTransaction.findFirst({
      where: { lotNumber, referenceType: "PROCESSING_INPUT" },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    }));

  if (!purchaseEntry) {
    throw new NotFoundError(`No purchase or processing history found for lot "${lotNumber}".`);
  }

  // Material identity from the root ledger entry.
  let material: ForwardTrace["material"] = null;
  if (purchaseEntry.itemType === "RAW_MATERIAL") {
    const m = await db.rawMaterial.findUnique({ where: { id: purchaseEntry.itemId } });
    if (m) material = { id: m.id, name: m.name, skuCode: m.skuCode };
  } else {
    const p = await db.finishedProduct.findUnique({ where: { id: purchaseEntry.itemId } });
    if (p) material = { id: p.id, name: p.name, skuCode: p.skuCode };
  }

  const purchase = purchaseEntry.referenceType === "PURCHASE"
    ? await (async () => {
        const supplier = await supplierInfo(purchaseEntry.supplierId);
        return {
          poNumber: purchaseEntry.referenceNumber,
          supplierName: supplier.name,
          supplierGst: supplier.gst,
          purchaseDate: iso(purchaseEntry.timestamp),
          quantity: round2(purchaseEntry.stockIn),
          unitRate: round2(purchaseEntry.unitRate),
        };
      })()
    : null;

  // Batches that consumed this lot.
  const inputItems = await db.batchInputItem.findMany({
    where: { lotNumber },
    include: {
      batch: { include: { outputs: { include: { product: true } } } },
    },
    orderBy: { id: "asc" },
  });

  const batchIds = [...new Set(inputItems.map((i) => i.batchId))];
  const batches: ForwardTrace["batches"] = [];

  for (const batchId of batchIds) {
    const batchInputs = inputItems.filter((i) => i.batchId === batchId);
    const batch = batchInputs[0].batch;
    const consumedQty = round2(batchInputs.reduce((s, i) => s + i.quantityConsumed, 0));

    const outputs = batch.outputs.map((o) => ({
      lotNumber: o.lotNumber,
      outputType: o.outputType as OutputType,
      productName: o.product?.name ?? "Waste",
      quantityProduced: round2(o.quantityProduced),
    }));

    // Invoices that sold any of this batch's output lots.
    const invoices: NonNullable<ForwardTrace["batches"][number]["invoices"]> = [];
    const seen = new Set<string>();
    for (const output of batch.outputs) {
      const soldItems = await db.invoiceItem.findMany({
        where: { lotNumber: output.lotNumber },
        include: { invoice: { include: { customer: true } } },
      });
      for (const item of soldItems) {
        const key = `${item.invoice.invoiceNumber}|${output.lotNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        invoices.push({
          invoiceNumber: item.invoice.invoiceNumber,
          invoiceDate: iso(item.invoice.invoiceDate),
          status: item.invoice.status as InvoiceStatus,
          customerName: item.invoice.customer?.companyName ?? "Unknown customer",
          grandTotal: round2(item.invoice.grandTotal),
          quantity: round2(item.quantity),
        });
      }
    }

    batches.push({
      batchNumber: batch.batchNumber,
      processingDate: iso(batch.processingDate),
      consumedQty,
      wastePercentage: round2(batch.wastePercentage),
      outputs,
      invoices,
    });
  }

  return { rootLot: lotNumber, material, purchase, batches };
}

// ── Backward ─────────────────────────────────────────────────

/** Shared: batch + raw inputs + purchase records behind an output lot. */
async function batchLineageForOutputLot(
  output: {
    batch: {
      batchNumber: string;
      processingDate: Date;
      wastePercentage: number;
      inputs: {
        lotNumber: string;
        quantityConsumed: number;
        rawMaterial: { name: string };
      }[];
    } | null;
  } | null
) {
  if (!output?.batch) return { batch: null, rawInputs: [], purchases: [] };

  const batch = output.batch;
  const rawInputs: BackwardTrace["lots"][number]["rawInputs"] = [];
  const purchaseSet = new Map<string, PurchaseLedger>();

  for (const input of batch.inputs) {
    rawInputs.push({
      lotNumber: input.lotNumber,
      materialName: input.rawMaterial.name,
      quantityConsumed: round2(input.quantityConsumed),
    });
    const entries = await purchasesForLot(input.lotNumber);
    for (const e of entries) purchaseSet.set(`${e.referenceNumber}|${e.lotNumber}`, e);
  }

  const purchases: BackwardTrace["lots"][number]["purchases"] = [];
  for (const entry of purchaseSet.values()) {
    const supplier = await supplierInfo(entry.supplierId);
    purchases.push({
      poNumber: entry.referenceNumber,
      supplierName: supplier.name,
      supplierGst: supplier.gst,
      purchaseDate: iso(entry.timestamp),
      quantity: round2(entry.stockIn),
    });
  }

  return {
    batch: {
      batchNumber: batch.batchNumber,
      processingDate: iso(batch.processingDate),
      wastePercentage: round2(batch.wastePercentage),
    },
    rawInputs,
    purchases,
  };
}

export async function traceBackward(q: string): Promise<BackwardTrace> {
  if (/^inv/i.test(q)) {
    // ── Invoice-rooted trace ──
    let invoice = await db.invoice.findUnique({
      where: { invoiceNumber: q },
      include: { customer: true, items: { include: { product: true } } },
    });
    if (!invoice) {
      // Lenient re-try: invoice numbers are stored upper-cased.
      invoice = await db.invoice.findFirst({
        where: { invoiceNumber: q.toUpperCase() },
        include: { customer: true, items: { include: { product: true } } },
      });
    }
    if (!invoice) throw new NotFoundError(`Invoice "${q}" not found.`);

    const lots: BackwardTrace["lots"] = [];
    for (const item of invoice.items) {
      const output = await db.batchOutputItem.findFirst({
        where: { lotNumber: item.lotNumber },
        include: {
          product: true,
          batch: { include: { inputs: { include: { rawMaterial: true } } } },
        },
      });
      const lineage = await batchLineageForOutputLot(output);
      lots.push({
        lotNumber: item.lotNumber,
        productName: output?.product?.name ?? item.product.name,
        quantitySold: round2(item.quantity),
        batch: lineage.batch,
        rawInputs: lineage.rawInputs,
        purchases: lineage.purchases,
      });
    }

    return {
      root: q,
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: iso(invoice.invoiceDate),
        status: invoice.status as InvoiceStatus,
        customerName: invoice.customer?.companyName ?? "Unknown customer",
        customerGst: invoice.customer?.gstNumber ?? null,
        grandTotal: round2(invoice.grandTotal),
      },
      lots,
    };
  }

  // ── Finished-lot-rooted trace ──
  const output = await db.batchOutputItem.findFirst({
    where: { lotNumber: q },
    include: {
      product: true,
      batch: { include: { inputs: { include: { rawMaterial: true } } } },
    },
    orderBy: { id: "desc" },
  });

  const soldItems = await db.invoiceItem.findMany({
    where: { lotNumber: q },
    include: { product: true, invoice: { include: { customer: true } } },
  });

  if (!output && soldItems.length === 0) {
    throw new NotFoundError(`No finished-goods production or sales found for lot "${q}".`);
  }

  const confirmedSold = soldItems
    .filter((i) => i.invoice.status === "CONFIRMED")
    .reduce((s, i) => s + i.quantity, 0);

  // Most recent invoice that touched this lot (informational block).
  const latestInvoice = soldItems
    .slice()
    .sort((a, b) => b.invoice.invoiceDate.getTime() - a.invoice.invoiceDate.getTime() || b.invoice.id - a.invoice.id)[0]
    ?.invoice;

  const lineage = await batchLineageForOutputLot(output);

  return {
    root: q,
    invoice: latestInvoice
      ? {
          invoiceNumber: latestInvoice.invoiceNumber,
          invoiceDate: iso(latestInvoice.invoiceDate),
          status: latestInvoice.status as InvoiceStatus,
          customerName: latestInvoice.customer?.companyName ?? "Unknown customer",
          customerGst: latestInvoice.customer?.gstNumber ?? null,
          grandTotal: round2(latestInvoice.grandTotal),
        }
      : null,
    lots: [
      {
        lotNumber: q,
        productName: output?.product?.name ?? soldItems[0]?.product?.name ?? "Unknown product",
        quantitySold: round2(confirmedSold),
        batch: lineage.batch,
        rawInputs: lineage.rawInputs,
        purchases: lineage.purchases,
      },
    ],
  };
}
