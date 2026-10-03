/**
 * Native tool schemas + execution dispatcher for the AI Audit Assistant.
 * Tools route to the same domain services used by the REST API, so the
 * assistant can never report data that diverges from the ledger.
 */
import { db } from "@/lib/db";
import { getDashboardStats } from "@/lib/services/dashboard";
import { round2, AppError, ValidationError } from "@/lib/api-error";
import { markInvoicePaid, voidInvoicePayment } from "@/lib/services/invoice";
import { cancelBatch } from "@/lib/services/processing";
import { paySupplierBill, voidSupplierPayment } from "@/lib/services/supplier-payment";
import { traceForward, traceBackward } from "@/lib/services/traceability";

export const AVAILABLE_TOOLS = [
  "get_stock_summary",
  "get_dashboard_kpis",
  "get_receivables",
  "get_payables",
  "mark_invoice_paid",
  "void_invoice_payment",
  "cancel_batch",
  "pay_supplier_bill",
  "void_supplier_payment",
  "trace_lot_forward",
  "trace_backward",
  "get_audit_trail",
  "find_entity",
  "none",
] as const;

export type ToolName = (typeof AVAILABLE_TOOLS)[number];

export interface ToolCall {
  tool: ToolName;
  arguments: {
    item_type?: "RAW_MATERIAL" | "FINISHED_PRODUCT" | "ALL";
    name_hint?: string;
    lot_number?: string;
    query?: string;
    invoice_number?: string;
    amount?: number;
    method?: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
    notes?: string;
    batch_number?: string;
    reason?: string;
    supplier_name?: string;
    po_number?: string;
    payment_id?: number;
  };
}

/** Fetch a confirmed-only trimmed invoice list for the find_entity tool. */
async function searchInvoices(q: string) {
  const list = await db.invoice.findMany({
    where: {
      OR: [
        { invoiceNumber: { contains: q } },
        { customer: { companyName: { contains: q } } },
      ],
    },
    include: { customer: true, items: true },
    orderBy: { invoiceDate: "desc" },
    take: 5,
  });
  return list.map((inv) => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    status: inv.status,
    customerName: inv.customer.companyName,
    grandTotal: inv.grandTotal,
    items: inv.items.map((it) => ({
      productName: it.lotNumber,
      lotNumber: it.lotNumber,
      quantity: it.quantity,
    })),
  }));
}

export async function executeTool(
  tool: ToolName,
  args: ToolCall["arguments"]
): Promise<Record<string, unknown>> {
  switch (tool) {
    case "get_stock_summary": {
      const itemType = args.item_type ?? "ALL";
      const hint = (args.name_hint ?? "").toLowerCase().trim();
      const result: Record<string, unknown> = {};
      if (itemType === "ALL" || itemType === "RAW_MATERIAL") {
        let mats = await db.rawMaterial.findMany({ orderBy: { name: "asc" } });
        if (hint) mats = mats.filter((m) => m.name.toLowerCase().includes(hint));
        result.rawMaterials = mats.map((m) => ({
          name: m.name,
          skuCode: m.skuCode,
          unit: m.unit,
          currentStock: m.currentStock,
          unitPurchaseRate: m.unitPurchaseRate,
          reorderThreshold: m.reorderThreshold,
          lowStock: m.currentStock < m.reorderThreshold,
        }));
      }
      if (itemType === "ALL" || itemType === "FINISHED_PRODUCT") {
        let prods = await db.finishedProduct.findMany({ orderBy: { name: "asc" } });
        if (hint) prods = prods.filter((p) => p.name.toLowerCase().includes(hint));
        result.finishedProducts = prods.map((p) => ({
          name: p.name,
          skuCode: p.skuCode,
          unit: p.unit,
          currentStock: p.currentStock,
          sellingPrice: p.sellingPrice,
          taxRatePercent: p.taxRatePercent,
          reorderThreshold: p.reorderThreshold,
          lowStock: p.currentStock < p.reorderThreshold,
        }));
      }
      return result;
    }

    case "get_dashboard_kpis": {
      const stats = await getDashboardStats();
      return {
        kpis: stats.kpis,
        lowStockItems: stats.lowStockItems,
        monthlySales: stats.monthlySales,
      };
    }

    case "get_receivables": {
      const stats = await getDashboardStats();
      return { receivables: stats.receivables };
    }

    case "get_payables": {
      const stats = await getDashboardStats();
      return { payables: stats.payables };
    }

    case "void_invoice_payment": {
      const invNumber = (args.invoice_number ?? args.query ?? "").trim();
      const reason = (args.reason ?? "").trim();
      if (!invNumber) return { error: "invoice_number is required. Use find_entity first if unsure." };
      if (reason.length < 3) {
        return {
          error:
            "A void reason of at least 3 characters is required. Ask the user WHY the payment receipt should be voided, then retry with that reason. Never invent a reason.",
        };
      }
      const candidates = await db.invoice.findMany({
        where: { invoiceNumber: { contains: invNumber } },
        include: { payments: { orderBy: [{ paidAt: "desc" }, { id: "desc" }] } },
        take: 10,
      });
      const invoice = candidates.find(
        (i) => i.invoiceNumber.toLowerCase() === invNumber.toLowerCase()
      );
      if (!invoice) {
        return { error: `No invoice found with number ${invNumber}. Use find_entity first if unsure.` };
      }
      if (invoice.status === "CANCELLED") {
        return { ok: false, error: `Invoice ${invoice.invoiceNumber} is cancelled — it has no live payments to void.` };
      }
      // Pick the receipt: explicit payment_id wins, otherwise the most recent ACTIVE one.
      const active = invoice.payments.filter((p) => !p.voidedAt);
      const payment = args.payment_id
        ? invoice.payments.find((p) => p.id === args.payment_id)
        : active[0];
      if (!payment) {
        return {
          ok: false,
          error:
            active.length === 0
              ? `Invoice ${invoice.invoiceNumber} has no active (non-voided) payment receipts to void.`
              : `Payment receipt #${args.payment_id} not found on invoice ${invoice.invoiceNumber}. Active receipt ids: ${active.map((p) => p.id).join(", ")}.`,
        };
      }
      if (payment.voidedAt) {
        return { ok: false, error: `Payment receipt #${payment.id} on ${invoice.invoiceNumber} was already voided.` };
      }
      try {
        const updated = await voidInvoicePayment(invoice.id, payment.id, reason);
        const paidAmount = updated.paidAmount ?? 0;
        const balance = Math.max(0, round2(updated.grandTotal - paidAmount));
        return {
          ok: true,
          invoiceNumber: updated.invoiceNumber,
          voidedPaymentId: payment.id,
          voidedAmount: round2(payment.amount),
          reason,
          status: updated.status,
          paidAmount,
          balanceDue: balance,
          customerName: updated.customerName,
          note: `Voided receipt #${payment.id} (₹${round2(payment.amount)}) on ${updated.invoiceNumber} — ₹${paidAmount} still paid, ₹${balance} due. The receipt row remains in history stamped "voided".`,
        };
      } catch (e) {
        const msg =
          e instanceof AppError
            ? e.message
            : `Payment on ${invNumber} could not be voided.`;
        return { ok: false, error: msg };
      }
    }

    case "void_supplier_payment": {
      const supplierName = (args.supplier_name ?? "").trim();
      const poNumber = (args.po_number ?? "").trim();
      const reason = (args.reason ?? "").trim();
      if (!supplierName) return { error: "supplier_name is required. Use find_entity first if unsure." };
      if (reason.length < 3) {
        return {
          error:
            "A void reason of at least 3 characters is required. Ask the user WHY the payment receipt should be voided, then retry with that reason. Never invent a reason.",
        };
      }
      const suppliers = await db.supplier.findMany({
        where: { companyName: { contains: supplierName } },
        take: 10,
      });
      const supplier = suppliers.find(
        (s) => s.companyName.toLowerCase() === supplierName.toLowerCase()
      );
      if (!supplier) {
        return { error: `No supplier found with name ${supplierName}. Use find_entity first if unsure.` };
      }
      const rows = await db.supplierPayment.findMany({
        where: { supplierId: supplier.id },
        orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      });
      const pool = poNumber
        ? rows.filter((r) => r.poNumber.toLowerCase() === poNumber.toLowerCase())
        : rows;
      const activeRows = pool.filter((r) => !r.voidedAt);
      const target = args.payment_id
        ? pool.find((r) => r.id === args.payment_id)
        : activeRows[0];
      if (!target) {
        return {
          ok: false,
          error:
            activeRows.length === 0
              ? `${supplier.companyName} has no active (non-voided) payment receipts${poNumber ? ` on PO ${poNumber}` : ""} to void.`
              : `Payment receipt #${args.payment_id} not found for ${supplier.companyName}. Active receipt ids: ${activeRows.map((r) => r.id).join(", ")}.`,
        };
      }
      if (target.voidedAt) {
        return { ok: false, error: `Payment receipt #${target.id} was already voided.` };
      }
      try {
        const { payment, summary } = await voidSupplierPayment(supplier.id, target.id, reason);
        return {
          ok: true,
          supplierName: summary.supplierName,
          voidedPaymentId: payment.id,
          voidedAmount: payment.amount,
          poNumber: payment.poNumber,
          reason,
          outstandingNow: summary.totalOutstanding,
          note: `Voided receipt #${payment.id} (₹${payment.amount}) on PO ${payment.poNumber} (${summary.supplierName}) — outstanding payables now ₹${summary.totalOutstanding}. The receipt row remains in history stamped "voided".`,
        };
      } catch (e) {
        const msg =
          e instanceof AppError
            ? e.message
            : `Payment receipt could not be voided for ${supplier.companyName}.`;
        return { ok: false, error: msg };
      }
    }

    case "mark_invoice_paid": {
      const invNumber = (args.invoice_number ?? args.query ?? "").trim();
      if (!invNumber) return { error: "invoice_number is required" };
      // SQLite has no case-insensitive mode — fetch candidates then match manually
      const candidates = await db.invoice.findMany({
        where: { invoiceNumber: { contains: invNumber } },
        take: 10,
      });
      const invoice = candidates.find(
        (i) => i.invoiceNumber.toLowerCase() === invNumber.toLowerCase()
      );
      if (!invoice) {
        return { error: `No invoice found with number ${invNumber}. Use find_entity first if unsure.` };
      }
      const amount =
        args.amount !== undefined && Number.isFinite(Number(args.amount))
          ? Number(args.amount)
          : undefined;
      try {
        const updated = await markInvoicePaid(invoice.id, {
          ...(amount !== undefined ? { amount } : {}),
          ...(args.method ? { method: args.method } : {}),
          ...(args.notes ? { notes: args.notes } : {}),
        });
        const paidAmount = updated.paidAmount ?? 0;
        const balance = Math.max(0, round2(updated.grandTotal - paidAmount));
        return {
          ok: true,
          invoiceNumber: updated.invoiceNumber,
          status: updated.status,
          fullySettled: Boolean(updated.paidAt),
          paidAt: updated.paidAt,
          paidAmount,
          balanceDue: balance,
          paymentMethod: updated.paymentMethod,
          customerName: updated.customerName,
          grandTotal: updated.grandTotal,
          note: updated.paidAt
            ? `Invoice ${updated.invoiceNumber} fully settled — ₹${updated.grandTotal} received.`
            : `Partial payment recorded for ${updated.invoiceNumber}: ₹${paidAmount} of ₹${updated.grandTotal} paid, ₹${balance} still due.`,
        };
      } catch (e) {
        const msg =
          e instanceof ValidationError
            ? e.message
            : `Invoice ${invNumber} could not be marked paid (possibly already paid or cancelled).`;
        return { ok: false, error: msg };
      }
    }

    case "cancel_batch": {
      const batchNumber = (args.batch_number ?? args.query ?? "").trim();
      const reason = (args.reason ?? "").trim();
      if (!batchNumber) return { error: "batch_number is required (e.g. PB-0001). Use find_entity first if unsure." };
      if (reason.length < 3) {
        return {
          error:
            "A cancellation reason of at least 3 characters is required. Ask the user WHY the batch should be cancelled, then retry with that reason. Never invent a reason.",
        };
      }
      // SQLite has no case-insensitive mode — fetch candidates then match manually
      const candidates = await db.processingBatch.findMany({
        where: { batchNumber: { contains: batchNumber } },
        take: 10,
      });
      const batch = candidates.find(
        (b) => b.batchNumber.toLowerCase() === batchNumber.toLowerCase()
      );
      if (!batch) {
        return { error: `No processing batch found with number ${batchNumber}. Use find_entity first if unsure.` };
      }
      if (batch.status === "CANCELLED") {
        return {
          ok: false,
          error: `Batch ${batch.batchNumber} was already cancelled${batch.cancelledAt ? ` on ${batch.cancelledAt.toISOString()}` : ""}. Nothing to reverse.`,
        };
      }
      try {
        const updated = await cancelBatch(batch.id, reason);
        return {
          ok: true,
          batchNumber: updated.batchNumber,
          status: updated.status,
          cancelledAt: updated.cancelledAt,
          reason,
          inputsReversed: updated.inputs.map((i) => ({
            material: i.rawMaterialName ?? `#${i.rawMaterialId}`,
            quantity: i.quantityConsumed,
          })),
          outputsReversed: updated.outputs
            .filter((o) => o.outputType !== "WASTE")
            .map((o) => ({ product: o.productName ?? `#${o.productId}`, quantity: o.quantityProduced })),
          note: `Batch ${updated.batchNumber} cancelled — input stock restored, produced output stock deducted, and BATCH_CANCELLATION rows written to the audit ledger.`,
        };
      } catch (e) {
        const msg =
          e instanceof ValidationError
            ? e.message
            : `Batch ${batchNumber} could not be cancelled — its output may already be partially sold. Cancel or reverse the related invoices first.`;
        return { ok: false, error: msg };
      }
    }

    case "pay_supplier_bill": {
      const supplierName = (args.supplier_name ?? "").trim();
      const poNumber = (args.po_number ?? args.query ?? "").trim();
      if (!supplierName) return { error: "supplier_name is required. Use find_entity first if unsure." };
      if (!poNumber) {
        return { error: "po_number is required (e.g. PO-0001). Ask the user which PO bill to pay." };
      }
      // SQLite has no case-insensitive mode — fetch candidates then match manually
      const suppliers = await db.supplier.findMany({
        where: { companyName: { contains: supplierName } },
        take: 10,
      });
      const supplier = suppliers.find(
        (s) => s.companyName.toLowerCase() === supplierName.toLowerCase()
      );
      if (!supplier) {
        return { error: `No supplier found with name ${supplierName}. Use find_entity first if unsure.` };
      }
      const amount =
        args.amount !== undefined && Number.isFinite(Number(args.amount))
          ? Number(args.amount)
          : undefined;
      try {
        const { bill, summary } = await paySupplierBill(supplier.id, {
          poNumber,
          ...(amount !== undefined ? { amount } : {}),
          ...(args.method ? { method: args.method } : {}),
          ...(args.notes ? { notes: args.notes } : {}),
        });
        return {
          ok: true,
          supplierName: summary.supplierName,
          poNumber: bill.poNumber,
          status: bill.status,
          paid: bill.paid,
          billed: bill.billed,
          outstanding: bill.outstanding,
          paymentMethod: args.method ?? "CASH",
          note:
            bill.status === "SETTLED"
              ? `PO ${bill.poNumber} (${summary.supplierName}) fully settled — ₹${bill.paid} of ₹${bill.billed} paid.`
              : `Payment recorded on PO ${bill.poNumber} (${summary.supplierName}): ₹${bill.paid} of ₹${bill.billed} paid, ₹${bill.outstanding} still due.`,
        };
      } catch (e) {
        const msg =
          e instanceof AppError
            ? e.message // ValidationError (400) + DuplicateCancellationError (409) surface verbatim
            : `Payment for PO ${poNumber} could not be recorded (check the supplier and PO number).`;
        return { ok: false, error: msg };
      }
    }

    case "trace_lot_forward": {
      const lot = (args.lot_number ?? "").trim();
      if (!lot) return { error: "lot_number is required" };
      try {
        return { ...(await traceForward(lot)) };
      } catch {
        return { error: `No trace found for raw lot ${lot}` };
      }
    }

    case "trace_backward": {
      const q = (args.query ?? "").trim();
      if (!q) return { error: "query is required" };
      try {
        return { ...(await traceBackward(q)) };
      } catch {
        return { error: `No backward trace found for ${q}` };
      }
    }

    case "get_audit_trail": {
      const q = (args.query ?? "").trim();
      if (!q) return { error: "query is required" };
      const entries = await db.inventoryTransaction.findMany({
        where: {
          OR: [{ lotNumber: { contains: q } }, { itemName: { contains: q } }],
        },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        take: 60,
      });
      return {
        query: q,
        entryCount: entries.length,
        entries: entries.map((e) => ({
          timestamp: e.timestamp,
          itemName: e.itemName,
          referenceType: e.referenceType,
          referenceNumber: e.referenceNumber,
          lotNumber: e.lotNumber,
          stockIn: e.stockIn,
          stockOut: e.stockOut,
          balanceAfter: e.balanceAfter,
        })),
      };
    }

    case "find_entity": {
      const q = (args.query ?? "").trim();
      if (!q) return { error: "query is required" };
      const [invoices, materials, products, suppliers, customers, batches] = await Promise.all([
        searchInvoices(q),
        db.rawMaterial.findMany({ where: { OR: [{ name: { contains: q } }, { skuCode: { contains: q } }] }, take: 5 }),
        db.finishedProduct.findMany({ where: { OR: [{ name: { contains: q } }, { skuCode: { contains: q } }] }, take: 5 }),
        db.supplier.findMany({ where: { companyName: { contains: q } }, take: 5 }),
        db.customer.findMany({ where: { companyName: { contains: q } }, take: 5 }),
        db.processingBatch.findMany({
          where: { OR: [{ batchNumber: { contains: q } }, { notes: { contains: q } }] },
          include: { inputs: true, outputs: true },
          orderBy: { processingDate: "desc" },
          take: 5,
        }),
      ]);
      const ledgerLots = await db.inventoryTransaction.findMany({
        where: { lotNumber: { contains: q } },
        distinct: ["lotNumber"],
        select: { lotNumber: true, itemName: true, itemType: true },
        take: 8,
      });
      return {
        invoices,
        rawMaterials: materials.map((m) => ({ name: m.name, skuCode: m.skuCode, currentStock: m.currentStock, unit: m.unit })),
        finishedProducts: products.map((p) => ({ name: p.name, skuCode: p.skuCode, currentStock: p.currentStock, unit: p.unit })),
        suppliers: suppliers.map((s) => ({ companyName: s.companyName, gstNumber: s.gstNumber })),
        customers: customers.map((c) => ({ companyName: c.companyName, gstNumber: c.gstNumber })),
        batches: batches.map((b) => ({
          batchNumber: b.batchNumber,
          status: b.status,
          wastePercentage: b.wastePercentage,
          inputs: b.inputs.map((i) => i.lotNumber),
          outputs: b.outputs.map((o) => o.lotNumber),
        })),
        knownLots: ledgerLots,
      };
    }

    case "none":
      return { note: "No tool needed — answer from general knowledge about the ERP." };

    default:
      return { error: `Unknown tool: ${tool}` };
  }
}
