import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DuplicateCancellationError,
  NotFoundError,
  ValidationError,
  round2,
} from "@/lib/api-error";
import { toISO } from "@/lib/serialize";
import type {
  PaymentMethod,
  RecordSupplierPaymentRequest,
  SupplierAgingSummary,
  SupplierPayment,
  SupplierPoBill,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Payables service — supplier PO bills & payments.
// Bills are DERIVED from the immutable PURCHASE ledger rows
// (stockIn × unitRate grouped by referenceNumber = poNumber per
// supplier), so no bill records can drift from the audit ledger.
// Payments are real rows (SupplierPayment) mirroring InvoicePayment
// semantics: append-only, voided rather than deleted.
// ─────────────────────────────────────────────────────────────

const EPS = 0.005; // half-paisa tolerance for float rounding

/** Maps a Prisma SupplierPayment row to the shared contract shape. */
export function mapSupplierPayment(p: {
  id: number;
  supplierId: number;
  poNumber: string;
  amount: number;
  method: string;
  notes: string | null;
  paidAt: Date;
  voidedAt?: Date | null;
  voidReason?: string | null;
}): SupplierPayment {
  return {
    id: p.id,
    supplierId: p.supplierId,
    poNumber: p.poNumber,
    amount: round2(p.amount),
    method: p.method as PaymentMethod,
    notes: p.notes,
    paidAt: toISO(p.paidAt),
    voidedAt: p.voidedAt ? toISO(p.voidedAt) : null,
    voidReason: p.voidReason ?? null,
  };
}

/** All payment rows for one supplier, oldest first. */
async function paymentsForSupplier(
  tx: Prisma.TransactionClient | typeof db,
  supplierId: number
): Promise<SupplierPayment[]> {
  const rows = await tx.supplierPayment.findMany({
    where: { supplierId },
    orderBy: [{ paidAt: "asc" }, { id: "asc" }],
  });
  return rows.map(mapSupplierPayment);
}

/** Builds per-PO bills from PURCHASE ledger rows joined with payments. */
function buildBills(
  purchaseRows: {
    referenceNumber: string;
    stockIn: number;
    unitRate: number;
    itemName: string;
    lotNumber: string;
    timestamp: Date;
  }[],
  payments: SupplierPayment[],
  now: Date
): SupplierPoBill[] {
  const DAY = 24 * 60 * 60 * 1000;
  const groups = new Map<
    string,
    {
      billed: number;
      lines: number;
      materials: Set<string>;
      lots: Set<string>;
      first: Date;
      last: Date;
    }
  >();

  for (const row of purchaseRows) {
    const po = row.referenceNumber || "UNSPECIFIED";
    const agg = groups.get(po) ?? {
      billed: 0,
      lines: 0,
      materials: new Set<string>(),
      lots: new Set<string>(),
      first: row.timestamp,
      last: row.timestamp,
    };
    agg.billed += row.stockIn * row.unitRate;
    agg.lines += 1;
    agg.materials.add(row.itemName);
    agg.lots.add(row.lotNumber);
    if (row.timestamp < agg.first) agg.first = row.timestamp;
    if (row.timestamp > agg.last) agg.last = row.timestamp;
    groups.set(po, agg);
  }

  const bills: SupplierPoBill[] = [];
  for (const [poNumber, agg] of groups) {
    const all = payments.filter((p) => p.poNumber === poNumber);
    const active = all.filter((p) => !p.voidedAt);
    const paid = round2(active.reduce((s, p) => s + p.amount, 0));
    const billed = round2(agg.billed);
    const outstanding = Math.max(0, round2(billed - paid));
    const status: SupplierPoBill["status"] =
      outstanding <= EPS ? "SETTLED" : paid > EPS ? "PARTIAL" : "UNPAID";
    bills.push({
      poNumber,
      billed,
      paid,
      outstanding,
      status,
      firstPurchaseDate: toISO(agg.first),
      lastPurchaseDate: toISO(agg.last),
      ageDays: Math.max(0, Math.floor((now.getTime() - agg.first.getTime()) / DAY)),
      lineCount: agg.lines,
      materials: Array.from(agg.materials).sort(),
      lots: Array.from(agg.lots).sort(),
      payments: all,
    });
  }

  return bills.sort((a, b) => (a.firstPurchaseDate < b.firstPurchaseDate ? -1 : 1));
}

/**
 * GET /api/suppliers/[id]/payables — the full payables position:
 * per-PO bills with paid/outstanding/age, plus aging buckets on the
 * outstanding balance (0–30 / 31–60 / 61–90 / 90+ days from first receipt).
 */
export async function getSupplierPayables(supplierId: number): Promise<SupplierAgingSummary> {
  const now = new Date();
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new NotFoundError(`Supplier with id ${supplierId} not found.`);

  const [purchaseRows, payments] = await Promise.all([
    db.inventoryTransaction.findMany({
      where: { referenceType: "PURCHASE", supplierId },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    }),
    paymentsForSupplier(db, supplierId),
  ]);

  const bills = buildBills(purchaseRows, payments, now);

  const labels = ["0–30", "31–60", "61–90", "90+"];
  const buckets = labels.map((label) => ({ label, total: 0, count: 0 }));
  let overdueTotal = 0;
  let overdueCount = 0;

  for (const bill of bills) {
    if (bill.outstanding <= EPS) continue;
    const idx =
      bill.ageDays <= 30 ? 0 : bill.ageDays <= 60 ? 1 : bill.ageDays <= 90 ? 2 : 3;
    buckets[idx].total = round2(buckets[idx].total + bill.outstanding);
    buckets[idx].count += 1;
    if (idx >= 1) {
      overdueTotal += bill.outstanding;
      overdueCount += 1;
    }
  }

  return {
    supplierId: supplier.id,
    supplierName: supplier.companyName,
    totalBilled: round2(bills.reduce((s, b) => s + b.billed, 0)),
    totalPaid: round2(bills.reduce((s, b) => s + b.paid, 0)),
    totalOutstanding: round2(bills.reduce((s, b) => s + b.outstanding, 0)),
    overdueTotal: round2(overdueTotal),
    overdueCount,
    buckets,
    bills,
  };
}

/**
 * Records a payment to a supplier against one PO bill.
 *  - amount omitted → settle the PO's remaining outstanding balance.
 *  - Errors: 404 missing supplier, 400 unknown PO / non-positive / overpay,
 *    409 already settled.
 */
export async function paySupplierBill(
  supplierId: number,
  payment: RecordSupplierPaymentRequest
): Promise<{ bill: SupplierPoBill; summary: SupplierAgingSummary }> {
  const poNumber = payment.poNumber.trim();
  if (!poNumber) throw new ValidationError("poNumber is required.");

  // Write the receipt inside the transaction; derive the fresh summary
  // AFTER commit (reading via the global client inside the tx would race).
  const paidPo = await db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundError(`Supplier with id ${supplierId} not found.`);

    // The bill must exist in the immutable ledger (case-insensitive match —
    // SQLite has no insensitive contains, so fetch candidates and filter).
    const candidates = await tx.inventoryTransaction.findMany({
      where: { referenceType: "PURCHASE", supplierId, referenceNumber: { contains: poNumber } },
    });
    const matched = candidates.filter(
      (r) => r.referenceNumber.toLowerCase() === poNumber.toLowerCase()
    );
    if (matched.length === 0) {
      throw new NotFoundError(
        `No purchase found for PO ${poNumber} from ${supplier.companyName}. Bills derive from PURCHASE ledger rows — check the PO number.`
      );
    }

    const bills = buildBills(
      matched.map((r) => ({
        referenceNumber: r.referenceNumber,
        stockIn: r.stockIn,
        unitRate: r.unitRate,
        itemName: r.itemName,
        lotNumber: r.lotNumber,
        timestamp: r.timestamp,
      })),
      await paymentsForSupplier(tx, supplierId),
      new Date()
    );
    const bill = bills[0];

    if (bill.outstanding <= EPS) {
      throw new DuplicateCancellationError(
        `PO ${bill.poNumber} is already fully settled — ₹${bill.paid} of ₹${bill.billed} paid.`
      );
    }

    let amount = bill.outstanding;
    if (payment.amount !== undefined && payment.amount !== null) {
      if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
        throw new ValidationError("Payment amount must be a positive number.");
      }
      amount = round2(payment.amount);
      if (amount > bill.outstanding + EPS) {
        throw new ValidationError(
          `Payment ${amount} exceeds the outstanding balance of ${bill.outstanding} on PO ${bill.poNumber}.`
        );
      }
    }

    await tx.supplierPayment.create({
      data: {
        supplierId,
        poNumber: bill.poNumber,
        amount,
        method: payment.method ?? "CASH",
        ...(payment.notes?.trim() ? { notes: payment.notes.trim() } : {}),
      },
    });

    return bill.poNumber;
  });

  const summary = await getSupplierPayables(supplierId);
  const updatedBill = summary.bills.find((b) => b.poNumber === paidPo);
  if (!updatedBill) {
    throw new Error(`PO ${paidPo} vanished after payment — inconsistent ledger state.`);
  }
  return { bill: updatedBill, summary };
}

/**
 * Voids a supplier payment receipt (mis-recorded payment correction):
 *  - the row is NEVER deleted — voidedAt/voidReason stamped (append-only);
 *  - Errors: 404 missing supplier/receipt, 409 already-voided.
 */
export async function voidSupplierPayment(
  supplierId: number,
  paymentId: number,
  reason: string
): Promise<{ payment: SupplierPayment; summary: SupplierAgingSummary }> {
  // Stamp the void inside the transaction; derive the fresh summary after commit.
  const payment = await db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundError(`Supplier with id ${supplierId} not found.`);

    const row = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
    if (!row || row.supplierId !== supplierId) {
      throw new NotFoundError(
        `Payment receipt #${paymentId} not found for supplier ${supplier.companyName}.`
      );
    }
    if (row.voidedAt) {
      throw new DuplicateCancellationError(
        `Payment receipt #${paymentId} was already voided.`
      );
    }

    const stampedAt = new Date();
    await tx.supplierPayment.update({
      where: { id: row.id },
      data: { voidedAt: stampedAt, voidReason: reason },
    });

    return mapSupplierPayment({ ...row, voidedAt: stampedAt, voidReason: reason });
  });

  const summary = await getSupplierPayables(supplierId);
  return { payment, summary };
}
