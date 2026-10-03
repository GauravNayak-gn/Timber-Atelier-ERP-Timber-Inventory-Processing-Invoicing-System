import { db } from "@/lib/db";
import { round2 } from "@/lib/api-error";
import { listBatches } from "@/lib/services/processing";
import { listInvoices } from "@/lib/services/invoice";
import { toISO } from "@/lib/serialize";
import type { DashboardStats, ItemType, LedgerEntry, PayablesSummary, ReceivablesSummary } from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Dashboard aggregates — all monetary/quantity outputs rounded
// to 2 decimals. Monthly sales cover the last 6 calendar months
// (current included), CONFIRMED invoices only, zero-filled.
// Receivables = CONFIRMED invoices without paidAt, bucketed by
// invoice age (0–30 / 31–60 / 61–90 / 90+ days).
// ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Aging buckets for receivables — computed from today's date.
 *  Outstanding per invoice = grandTotal − paidAmount (partial payments aware);
 *  fully-settled invoices (paidAt stamped) contribute to collectedTotal only. */
function buildReceivables(
  invoices: {
    invoiceDate: Date;
    grandTotal: number;
    paidAmount: number;
    paidAt: Date | null;
    customerId: number;
    customerName: string | null;
  }[],
  now: Date
): ReceivablesSummary {
  const DAY = 24 * 60 * 60 * 1000;
  const labels = ["0–30", "31–60", "61–90", "90+"];
  const buckets = labels.map((label) => ({ label, total: 0, count: 0 }));

  const debtors = new Map<
    number,
    { customerId: number; customerName: string; total: number; invoiceCount: number; oldestDays: number }
  >();

  let outstandingTotal = 0;
  let invoiceCount = 0;
  let collectedTotal = 0;

  for (const inv of invoices) {
    collectedTotal += inv.paidAmount ?? 0;
    if (inv.paidAt) continue; // fully settled
    const due = Math.max(0, round2(inv.grandTotal - (inv.paidAmount ?? 0)));
    if (due <= 0.005) continue; // defensive: settled but not stamped
    const ageDays = Math.max(0, Math.floor((now.getTime() - inv.invoiceDate.getTime()) / DAY));
    const idx = ageDays <= 30 ? 0 : ageDays <= 60 ? 1 : ageDays <= 90 ? 2 : 3;
    buckets[idx].total += due;
    buckets[idx].count += 1;
    outstandingTotal += due;
    invoiceCount += 1;

    const agg = debtors.get(inv.customerId) ?? {
      customerId: inv.customerId,
      customerName: inv.customerName ?? `Customer #${inv.customerId}`,
      total: 0,
      invoiceCount: 0,
      oldestDays: 0,
    };
    agg.total += due;
    agg.invoiceCount += 1;
    agg.oldestDays = Math.max(agg.oldestDays, ageDays);
    debtors.set(inv.customerId, agg);
  }

  const topDebtors = Array.from(debtors.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((d) => ({ ...d, total: round2(d.total) }));

  return {
    outstandingTotal: round2(outstandingTotal),
    collectedTotal: round2(collectedTotal),
    invoiceCount,
    overdueTotal: round2(buckets.slice(1).reduce((s, b) => s + b.total, 0)),
    buckets: buckets.map((b) => ({ ...b, total: round2(b.total) })),
    topDebtors,
  };
}

/** Aging buckets for PAYABLES — supplier PO bills derived from the immutable
 *  PURCHASE ledger (stockIn × unitRate grouped by referenceNumber per supplier),
 *  joined with active (non-voided) SupplierPayment receipts. Mirrors buildReceivables. */
function buildPayables(
  purchaseRows: {
    supplierId: number;
    referenceNumber: string;
    stockIn: number;
    unitRate: number;
    timestamp: Date;
  }[],
  payments: { supplierId: number; poNumber: string; amount: number; voidedAt: Date | null }[],
  supplierNames: Map<number, string>,
  now: Date
): PayablesSummary {
  const DAY = 24 * 60 * 60 * 1000;
  const labels = ["0–30", "31–60", "61–90", "90+"];
  const buckets = labels.map((label) => ({ label, total: 0, count: 0 }));

  // Bill key = supplierId + PO number (mirrors the payables service).
  const bills = new Map<
    string,
    { supplierId: number; billed: number; paid: number; first: Date }
  >();

  for (const row of purchaseRows) {
    const po = row.referenceNumber || "UNSPECIFIED";
    const key = `${row.supplierId}::${po.toLowerCase()}`;
    const bill = bills.get(key) ?? {
      supplierId: row.supplierId,
      billed: 0,
      paid: 0,
      first: row.timestamp,
    };
    bill.billed += row.stockIn * row.unitRate;
    if (row.timestamp < bill.first) bill.first = row.timestamp;
    bills.set(key, bill);
  }

  for (const p of payments) {
    if (p.voidedAt) continue; // voided receipts never settle anything
    const key = `${p.supplierId}::${p.poNumber.toLowerCase()}`;
    const bill = bills.get(key);
    if (bill) bill.paid += p.amount;
  }

  const creditors = new Map<
    number,
    { supplierId: number; supplierName: string; total: number; billCount: number; oldestDays: number }
  >();

  let outstandingTotal = 0;
  let paidTotal = 0;
  let billCount = 0;
  let overdueTotal = 0;

  for (const bill of bills.values()) {
    const billed = round2(bill.billed);
    const paid = round2(bill.paid);
    paidTotal += paid;
    const due = Math.max(0, round2(billed - paid));
    if (due <= 0.005) continue; // settled
    const ageDays = Math.max(0, Math.floor((now.getTime() - bill.first.getTime()) / DAY));
    const idx = ageDays <= 30 ? 0 : ageDays <= 60 ? 1 : ageDays <= 90 ? 2 : 3;
    buckets[idx].total += due;
    buckets[idx].count += 1;
    outstandingTotal += due;
    billCount += 1;
    if (idx >= 1) overdueTotal += due;

    const agg = creditors.get(bill.supplierId) ?? {
      supplierId: bill.supplierId,
      supplierName: supplierNames.get(bill.supplierId) ?? `Supplier #${bill.supplierId}`,
      total: 0,
      billCount: 0,
      oldestDays: 0,
    };
    agg.total += due;
    agg.billCount += 1;
    agg.oldestDays = Math.max(agg.oldestDays, ageDays);
    creditors.set(bill.supplierId, agg);
  }

  const topCreditors = Array.from(creditors.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((d) => ({ ...d, total: round2(d.total) }));

  return {
    outstandingTotal: round2(outstandingTotal),
    paidTotal: round2(paidTotal),
    billCount,
    supplierCount: creditors.size,
    overdueTotal: round2(overdueTotal),
    buckets: buckets.map((b) => ({ ...b, total: round2(b.total) })),
    topCreditors,
  };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // ── Inventory aggregates ──
  const [materials, products, wasteAgg, monthSalesAgg, cancelledAgg, monthCollectedAgg] =
    await Promise.all([
      db.rawMaterial.findMany(),
      db.finishedProduct.findMany(),
      db.processingBatch.aggregate({ _sum: { totalInputQty: true, totalWasteQty: true } }),
      db.invoice.aggregate({
        _sum: { grandTotal: true, taxTotal: true },
        where: { status: "CONFIRMED", invoiceDate: { gte: monthStart, lt: nextMonthStart } },
      }),
      db.invoice.aggregate({
        _count: { _all: true },
        _sum: { grandTotal: true },
        where: { status: "CANCELLED" },
      }),
      // Cash actually received this month: active (non-voided) payment
      // receipts on CONFIRMED invoices — the receivables side of billing.
      db.invoicePayment.aggregate({
        _sum: { amount: true },
        where: {
          voidedAt: null,
          paidAt: { gte: monthStart, lt: nextMonthStart },
          invoice: { status: "CONFIRMED" },
        },
      }),
    ]);

  const totalRawStock = round2(materials.reduce((s, m) => s + m.currentStock, 0));
  const rawInventoryValue = round2(
    materials.reduce((s, m) => s + m.currentStock * m.unitPurchaseRate, 0)
  );
  const totalFinishedStock = round2(products.reduce((s, p) => s + p.currentStock, 0));
  const finishedInventoryValue = round2(
    products.reduce((s, p) => s + p.currentStock * p.sellingPrice, 0)
  );

  const wasteInputSum = wasteAgg._sum.totalInputQty ?? 0;
  const wasteQtySum = wasteAgg._sum.totalWasteQty ?? 0;
  const overallWastePercent =
    wasteInputSum > 0 ? round2((wasteQtySum / wasteInputSum) * 100) : 0;

  // ── Low stock (raw materials + finished products) ──
  const lowStockItems: DashboardStats["lowStockItems"] = [
    ...materials
      .filter((m) => m.currentStock < m.reorderThreshold)
      .map((m) => ({
        id: m.id,
        name: m.name,
        kind: "RAW_MATERIAL" as ItemType,
        currentStock: round2(m.currentStock),
        unit: m.unit,
        reorderThreshold: round2(m.reorderThreshold),
      })),
    ...products
      .filter((p) => p.currentStock < p.reorderThreshold)
      .map((p) => ({
        id: p.id,
        name: p.name,
        kind: "FINISHED_PRODUCT" as ItemType,
        currentStock: round2(p.currentStock),
        unit: p.unit,
        reorderThreshold: round2(p.reorderThreshold),
      })),
  ];

  // ── Monthly sales: last 6 calendar months, zero-filled ──
  const buckets: { key: string; month: string; sales: number; gst: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      month: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      sales: 0,
      gst: 0,
    });
  }
  const bucketStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const confirmedInMonthRange = await db.invoice.findMany({
    where: { status: "CONFIRMED", invoiceDate: { gte: bucketStart, lt: nextMonthStart } },
    select: { invoiceDate: true, grandTotal: true, taxTotal: true },
  });
  for (const inv of confirmedInMonthRange) {
    const bucket = buckets.find(
      (b) => b.key === `${inv.invoiceDate.getFullYear()}-${inv.invoiceDate.getMonth()}`
    );
    if (bucket) {
      bucket.sales += inv.grandTotal;
      bucket.gst += inv.taxTotal;
    }
  }
  const monthlySales = buckets.map((b) => ({
    month: b.month,
    sales: round2(b.sales),
    gst: round2(b.gst),
  }));

  // ── Waste trend: last 8 COMPLETED batches (cancelled runs are reversed
  //    and excluded so the trend reflects real conversions only) ──
  const recentForWaste = await db.processingBatch.findMany({
    where: { status: "COMPLETED" },
    orderBy: [{ processingDate: "desc" }, { id: "desc" }],
    take: 8,
    select: {
      batchNumber: true,
      wastePercentage: true,
      processingDate: true,
      totalInputQty: true,
      totalWasteQty: true,
      status: true,
    },
  });

  // ── Receivables: every confirmed invoice, outstanding = balance due ──
  const confirmedForReceivables = await db.invoice.findMany({
    where: { status: "CONFIRMED" },
    select: {
      invoiceDate: true,
      grandTotal: true,
      paidAmount: true,
      paidAt: true,
      customerId: true,
      customer: { select: { companyName: true } },
    },
  });
  const receivables = buildReceivables(
    confirmedForReceivables.map((i) => ({
      invoiceDate: i.invoiceDate,
      grandTotal: i.grandTotal,
      paidAmount: i.paidAmount ?? 0,
      paidAt: i.paidAt,
      customerId: i.customerId,
      customerName: i.customer?.companyName ?? null,
    })),
    now
  );

  // ── Payables: PO bills from the PURCHASE ledger + active supplier receipts ──
  const [payablePurchaseRows, supplierPayments, payablesSuppliers] = await Promise.all([
    db.inventoryTransaction.findMany({
      where: { referenceType: "PURCHASE", supplierId: { not: null } },
      select: {
        supplierId: true,
        referenceNumber: true,
        stockIn: true,
        unitRate: true,
        timestamp: true,
      },
    }),
    db.supplierPayment.findMany({
      select: { supplierId: true, poNumber: true, amount: true, voidedAt: true },
    }),
    db.supplier.findMany({ select: { id: true, companyName: true } }),
  ]);
  const payables = buildPayables(
    payablePurchaseRows.map((r) => ({
      supplierId: r.supplierId as number,
      referenceNumber: r.referenceNumber,
      stockIn: r.stockIn,
      unitRate: r.unitRate,
      timestamp: r.timestamp,
    })),
    supplierPayments,
    new Map(payablesSuppliers.map((s) => [s.id, s.companyName])),
    now
  );

  // ── Live ledger activity feed: newest movements across every item ──
  const recentActivityRows = await db.inventoryTransaction.findMany({
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: 9,
  });
  const recentActivity: LedgerEntry[] = recentActivityRows.map((e) => ({
    id: e.id,
    timestamp: toISO(e.timestamp),
    itemType: e.itemType as LedgerEntry["itemType"],
    itemId: e.itemId,
    itemName: e.itemName,
    referenceType: e.referenceType as LedgerEntry["referenceType"],
    referenceNumber: e.referenceNumber,
    lotNumber: e.lotNumber,
    stockIn: round2(e.stockIn),
    stockOut: round2(e.stockOut),
    balanceAfter: round2(e.balanceAfter),
    unitRate: round2(e.unitRate),
    supplierId: e.supplierId,
    notes: e.notes,
  }));

  const [recentBatches, recentInvoices] = await Promise.all([listBatches(5), listInvoices(5)]);

  return {
    kpis: {
      totalRawStock,
      rawInventoryValue,
      totalFinishedStock,
      finishedInventoryValue,
      inventoryValue: round2(rawInventoryValue + finishedInventoryValue),
      overallWastePercent,
      monthSalesTotal: round2(monthSalesAgg._sum.grandTotal ?? 0),
      monthGstCollected: round2(monthSalesAgg._sum.taxTotal ?? 0),
      cancelledInvoiceCount: cancelledAgg._count._all,
      cancelledRefundValue: round2(cancelledAgg._sum.grandTotal ?? 0),
      collectedThisMonth: round2(monthCollectedAgg._sum.amount ?? 0),
    },
    receivables,
    payables,
    lowStockItems,
    recentBatches,
    recentInvoices,
    monthlySales,
    recentActivity,
    wasteMetrics: recentForWaste.map((b) => ({
      batchNumber: b.batchNumber,
      wastePercent: round2(b.wastePercentage),
      processingDate: toISO(b.processingDate),
      totalInputQty: round2(b.totalInputQty),
      totalWasteQty: round2(b.totalWasteQty),
      status: b.status as DashboardStats["wasteMetrics"][number]["status"],
    })),
  };
}
