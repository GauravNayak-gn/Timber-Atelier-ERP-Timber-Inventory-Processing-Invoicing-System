"use client";

import * as React from "react";
import { Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimberMark } from "@/components/timber/logo";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import type { PartnerSupplier, SupplierAgingSummary } from "@/lib/types";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
};

type SupplierRef = Pick<
  PartnerSupplier,
  "companyName" | "contactPerson" | "phone" | "email" | "address" | "gstNumber"
>;

/**
 * Paper-white supplier account statement — the payables mirror of the tax
 * invoice document. Every PO bill is ledger-derived; voided payment rows stay
 * visible, struck out (append-only audit). Everything inside `.invoice-print`
 * is visible when printing (see globals.css @media print rules).
 */
export function SupplierStatementDocument({
  summary,
  supplier,
}: {
  summary: SupplierAgingSummary;
  supplier: SupplierRef;
}) {
  const settled = summary.totalBilled > 0 && summary.totalOutstanding <= 0.005;
  const receipts = summary.bills
    .flatMap((b) => b.payments.map((p) => ({ ...p, po: b.poNumber })))
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt));

  return (
    <div className="invoice-print relative mx-auto w-full bg-white p-8 text-stone-900 sm:p-10">
      {settled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span className="font-display -rotate-[18deg] select-none rounded-2xl border-[5px] border-emerald-600/10 px-12 py-3 text-7xl font-bold uppercase tracking-[0.2em] text-emerald-600/10">
            Settled
          </span>
        </div>
      )}
      {summary.overdueTotal > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span className="font-display -rotate-[18deg] select-none rounded-2xl border-[5px] border-amber-600/10 px-10 py-3 text-6xl font-bold uppercase tracking-[0.2em] text-amber-600/10">
            Overdue
          </span>
        </div>
      )}

      {/* Company header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-stone-800 pb-6">
        <div className="flex items-center gap-3">
          <TimberMark className="size-11 text-stone-800" />
          <div>
            <p className="font-display text-2xl font-semibold tracking-tight">TIMBER ATELIER ERP</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.28em] text-stone-500">
              Supplier Account Statement
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Payables</p>
          <p className="mt-0.5 text-xs text-stone-500">
            As on {formatDate(new Date().toISOString())}
          </p>
          <span
            className={
              "mt-1.5 inline-block rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider " +
              (summary.totalOutstanding > 0.005
                ? "border-amber-400 text-amber-700"
                : "border-emerald-400 text-emerald-700")
            }
          >
            {summary.totalOutstanding > 0.005 ? "Balance due" : "No dues"}
          </span>
        </div>
      </header>

      {/* Supplier block */}
      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">Supplier</p>
          <p className="mt-1.5 text-sm font-semibold">{supplier.companyName}</p>
          {supplier.contactPerson && <p className="text-xs text-stone-600">{supplier.contactPerson}</p>}
          {supplier.phone && <p className="text-xs text-stone-600">{supplier.phone}</p>}
          {supplier.email && <p className="text-xs text-stone-600">{supplier.email}</p>}
          {supplier.address && (
            <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-stone-600">{supplier.address}</p>
          )}
          {supplier.gstNumber && (
            <p className="mt-1 font-mono text-[11px] text-stone-700">GSTIN: {supplier.gstNumber}</p>
          )}
        </div>
        <div className="sm:text-right">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">Scope</p>
          <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
            {summary.bills.length} purchase bill{summary.bills.length === 1 ? "" : "s"} across{" "}
            {summary.bills.length > 0 ? new Set(summary.bills.map((b) => b.poNumber)).size : 0} PO
            {summary.bills.length > 0 && new Set(summary.bills.map((b) => b.poNumber)).size === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-stone-600">
            {receipts.filter((r) => !r.voidedAt).length} active receipt
            {receipts.filter((r) => !r.voidedAt).length === 1 ? "" : "s"}
            {receipts.some((r) => r.voidedAt)
              ? ` · ${receipts.filter((r) => r.voidedAt).length} voided (audit)`
              : ""}
          </p>
        </div>
      </section>

      {/* Summary strip */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total billed", value: formatINR(summary.totalBilled) },
          { label: "Paid to date", value: formatINR(summary.totalPaid), tone: "text-emerald-700" },
          { label: "Outstanding", value: formatINR(summary.totalOutstanding), tone: summary.totalOutstanding > 0.005 ? "text-amber-700" : "text-emerald-700" },
          { label: "Overdue 30d+", value: formatINR(summary.overdueTotal), tone: summary.overdueTotal > 0 ? "text-rose-700" : undefined },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
            <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-stone-500">{s.label}</p>
            <p className={"font-mono tnum mt-1 text-sm font-semibold " + (s.tone ?? "")}>{s.value}</p>
          </div>
        ))}
      </section>

      {/* Aging buckets */}
      {summary.totalOutstanding > 0.005 ? (
        <section className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">Aging of outstanding</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {summary.buckets.map((b) => (
              <div key={b.label} className="rounded-lg border border-stone-200 px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-stone-500">{b.label} days</p>
                <p className={"font-mono tnum mt-0.5 text-sm font-semibold " + (b.total > 0 ? "text-stone-900" : "text-stone-400")}>
                  {formatINR(b.total)}
                </p>
                <p className="text-[10px] text-stone-500">{b.count} bill{b.count === 1 ? "" : "s"}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* PO bills */}
      <section className="mt-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">
          Purchase bills (ledger-derived)
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-stone-300 text-left text-[10px] uppercase tracking-[0.16em] text-stone-500">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">PO Number</th>
              <th className="py-2 pr-2 font-medium">Materials / Lots</th>
              <th className="py-2 pr-2 text-right font-medium">Billed</th>
              <th className="py-2 pr-2 text-right font-medium">Paid</th>
              <th className="py-2 pr-2 text-right font-medium">Due</th>
              <th className="py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {summary.bills.map((bill, i) => (
              <tr key={bill.poNumber} className="border-b border-stone-200">
                <td className="py-2.5 pr-2 text-stone-500">{i + 1}</td>
                <td className="py-2.5 pr-2">
                  <p className="font-mono font-medium">{bill.poNumber}</p>
                  <p className="text-[10px] text-stone-500">
                    first receipt {formatDate(bill.firstPurchaseDate)} · {bill.ageDays}d
                  </p>
                </td>
                <td className="py-2.5 pr-2 text-xs text-stone-700">
                  {bill.materials.join(", ") || "—"}
                  <p className="font-mono text-[10px] text-stone-500">
                    {bill.lots.join(", ")}
                    {bill.lineCount > 0 ? ` · ${bill.lineCount} line${bill.lineCount === 1 ? "" : "s"}` : ""}
                  </p>
                </td>
                <td className="font-mono tnum py-2.5 pr-2 text-right">{formatINR(bill.billed)}</td>
                <td className="font-mono tnum py-2.5 pr-2 text-right text-emerald-700">{formatINR(bill.paid)}</td>
                <td className="font-mono tnum py-2.5 pr-2 text-right font-medium">{formatINR(bill.outstanding)}</td>
                <td className="py-2.5 text-right">
                  <span
                    className={
                      "inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider " +
                      (bill.status === "SETTLED"
                        ? "border-emerald-300 text-emerald-700"
                        : bill.status === "PARTIAL"
                          ? "border-amber-300 text-amber-700"
                          : "border-rose-300 text-rose-700")
                    }
                  >
                    {bill.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-800 text-sm font-semibold">
              <td className="py-2.5" colSpan={3}>
                Total
              </td>
              <td className="font-mono tnum py-2.5 pr-2 text-right">{formatINR(summary.totalBilled)}</td>
              <td className="font-mono tnum py-2.5 pr-2 text-right">{formatINR(summary.totalPaid)}</td>
              <td className="font-mono tnum py-2.5 pr-2 text-right">{formatINR(summary.totalOutstanding)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      {/* Receipt schedule (chronological; voided rows stay visible, struck) */}
      {receipts.length > 0 ? (
        <section className="mt-5 rounded-lg border border-stone-200 p-4 text-xs">
          <p className="font-semibold uppercase tracking-wider text-stone-600">Payment receipt schedule</p>
          <table className="mt-2 w-full">
            <tbody>
              {receipts.map((r, i) => {
                const voided = Boolean(r.voidedAt);
                return (
                  <tr key={r.id} className="border-b border-stone-100 last:border-0">
                    <td className="py-1.5 pr-2 text-stone-500">{i + 1}</td>
                    <td className="py-1.5 pr-2 font-mono text-stone-700">{r.po}</td>
                    <td className="py-1.5 pr-2 text-stone-700">{formatDate(r.paidAt)}</td>
                    <td className="py-1.5 pr-2 text-stone-700">
                      {METHOD_LABEL[r.method] ?? r.method}
                      {voided ? (
                        <span className="ml-1.5 rounded bg-rose-100 px-1 py-px font-mono text-[9px] font-semibold uppercase text-rose-700">
                          Voided
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[10px] text-stone-500">
                      {voided ? `VOID: ${r.voidReason ?? "reversed"}` : r.notes || "—"}
                    </td>
                    <td
                      className={
                        "py-1.5 text-right font-mono font-medium " +
                        (voided ? "text-rose-600/70 line-through" : "text-emerald-700")
                      }
                    >
                      −{formatINR(r.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs italic text-stone-500">
          No payments recorded against this supplier yet.
        </p>
      )}

      {/* Signatory */}
      <footer className="mt-12 flex items-end justify-between border-t border-stone-200 pt-6">
        <p className="max-w-[320px] text-[11px] leading-relaxed text-stone-400">
          Computer-generated account statement. Every bill is derived from the append-only Timber
          Atelier purchase ledger — billed value can never drift from goods actually received.
          Generated {formatDateTime(new Date())}.
        </p>
        <div className="text-center">
          <div className="h-12 w-44 border-b border-stone-400" />
          <p className="mt-1.5 text-xs text-stone-500">Accounts Payable</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Statement dialog — fetches the supplier's full payables position
 * and offers Print / Save PDF.
 */
export function SupplierStatementDialog({
  supplier,
  open,
  onOpenChange,
}: {
  supplier: SupplierRef & { id: number } | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [summary, setSummary] = React.useState<SupplierAgingSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !supplier) {
      setSummary(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .supplierPayables(supplier.id)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load statement");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, supplier]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Statement — {supplier?.companyName}</DialogTitle>
          <DialogDescription>Printable supplier account statement</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="p-10 text-center text-sm text-rose-700 dark:text-rose-300">{error}</div>
        ) : summary && supplier ? (
          <>
            <SupplierStatementDocument summary={summary} supplier={supplier} />
            <DialogFooter className="border-t border-border/70 p-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => window.print()} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                Print / Save PDF
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="grid min-h-[320px] place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
