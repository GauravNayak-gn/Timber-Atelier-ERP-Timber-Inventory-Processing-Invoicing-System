"use client";

import { apiGet } from "@/lib/api-client";
import { downloadFile, toCsv, todayISO } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types";

export interface LedgerExportFilters {
  itemType?: string;
  referenceType?: string;
  lotNumber?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Fetch up to 2000 ledger entries (honouring filters) and download as CSV.
 * Returns the number of exported rows for toast feedback.
 */
export async function exportLedgerCsv(filters: LedgerExportFilters = {}): Promise<number> {
  const p = new URLSearchParams();
  if (filters.itemType && filters.itemType !== "ALL") p.set("itemType", filters.itemType);
  if (filters.referenceType && filters.referenceType !== "ALL") p.set("referenceType", filters.referenceType);
  if (filters.lotNumber) p.set("lotNumber", filters.lotNumber);
  if (filters.startDate) p.set("startDate", filters.startDate);
  if (filters.endDate) p.set("endDate", filters.endDate);
  p.set("limit", "1000");
  p.set("offset", "0");

  const res = await apiGet<{ entries: LedgerEntry[]; total: number }>(`/api/audit/ledger?${p.toString()}`);
  const entries = res.entries ?? [];

  const csv = toCsv(
    ["Timestamp", "Item Type", "Item", "Reference Type", "Reference", "Lot Number", "Stock In", "Stock Out", "Balance After", "Unit Rate", "Notes"],
    entries.map((e) => [
      new Date(e.timestamp).toISOString(),
      e.itemType,
      e.itemName,
      e.referenceType,
      e.referenceNumber,
      e.lotNumber,
      e.stockIn,
      e.stockOut,
      e.balanceAfter,
      e.unitRate,
      e.notes ?? "",
    ])
  );
  downloadFile(`timber-audit-ledger-${todayISO()}.csv`, csv);
  return entries.length;
}

/** Build CSV for invoices and download. Returns row count. */
export async function exportInvoicesCsv(invoices: {
  invoiceNumber: string;
  invoiceDate: string;
  customerName?: string;
  status: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  items: { productName?: string; lotNumber: string; quantity: number; unitPrice: number; taxRatePercent: number; lineTotal: number }[];
}[]): Promise<number> {
  const csv = toCsv(
    ["Invoice #", "Date", "Customer", "Status", "Product", "Lot Number", "Qty", "Unit Price", "GST %", "Line Total", "Invoice Subtotal", "Invoice GST", "Invoice Grand Total"],
    invoices.flatMap((inv) =>
      inv.items.length === 0
        ? [[inv.invoiceNumber, inv.invoiceDate, inv.customerName ?? "", inv.status, "", "", "", "", "", "", inv.subtotal, inv.taxTotal, inv.grandTotal]]
        : inv.items.map((it) => [
            inv.invoiceNumber,
            inv.invoiceDate,
            inv.customerName ?? "",
            inv.status,
            it.productName ?? "",
            it.lotNumber,
            it.quantity,
            it.unitPrice,
            it.taxRatePercent,
            it.lineTotal,
            inv.subtotal,
            inv.taxTotal,
            inv.grandTotal,
          ])
    )
  );
  downloadFile(`timber-invoices-${todayISO()}.csv`, csv);
  return invoices.length;
}
