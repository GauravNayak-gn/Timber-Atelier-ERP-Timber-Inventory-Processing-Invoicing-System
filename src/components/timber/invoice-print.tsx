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
import { StatusBadge } from "@/components/timber/primitives";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR, formatQty } from "@/lib/format";
import type { Invoice } from "@/lib/types";

const METHOD_LABEL_PRINT: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
};

/**
 * Paper-white tax invoice document. Everything inside `.invoice-print`
 * is visible when printing (see globals.css @media print rules).
 */
export function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const customer = invoice.customer;
  const cancelled = invoice.status === "CANCELLED";

  return (
    <div className="invoice-print relative mx-auto w-full bg-white p-8 text-stone-900 sm:p-10">
      {cancelled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span className="font-display -rotate-[18deg] select-none rounded-2xl border-[5px] border-rose-600/10 px-10 py-3 text-7xl font-bold uppercase tracking-[0.2em] text-rose-600/10">
            Cancelled
          </span>
        </div>
      )}
      {!cancelled && invoice.paidAt && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span className="font-display -rotate-[18deg] select-none rounded-2xl border-[5px] border-emerald-600/10 px-12 py-3 text-7xl font-bold uppercase tracking-[0.2em] text-emerald-600/10">
            Paid
          </span>
        </div>
      )}
      {!cancelled && !invoice.paidAt && (invoice.paidAmount ?? 0) > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span className="font-display -rotate-[18deg] select-none rounded-2xl border-[5px] border-amber-600/10 px-8 py-3 text-6xl font-bold uppercase tracking-[0.2em] text-amber-600/10">
            Partial
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
              Timber Inventory · Processing · Trade
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Tax Invoice</p>
          <p className="font-mono text-lg font-semibold">{invoice.invoiceNumber}</p>
          <p className="mt-0.5 text-xs text-stone-500">{formatDate(invoice.invoiceDate)}</p>
          <div className="mt-1.5 flex justify-end">
            <StatusBadge status={invoice.status} />
          </div>
        </div>
      </header>

      {/* Customer block */}
      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">Bill To</p>
          <p className="mt-1.5 text-sm font-semibold">{customer?.companyName ?? invoice.customerName ?? "—"}</p>
          {customer?.contactPerson && <p className="text-xs text-stone-600">{customer.contactPerson}</p>}
          {customer?.phone && <p className="text-xs text-stone-600">{customer.phone}</p>}
          {customer?.email && <p className="text-xs text-stone-600">{customer.email}</p>}
          {customer?.billingAddress && (
            <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-stone-600">{customer.billingAddress}</p>
          )}
          {customer?.gstNumber && (
            <p className="mt-1 font-mono text-[11px] text-stone-700">GSTIN: {customer.gstNumber}</p>
          )}
        </div>
        <div className="sm:text-right">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">Ship To</p>
          {customer?.shippingAddress ? (
            <p className="mt-1.5 max-w-[280px] text-xs leading-relaxed text-stone-600 sm:ml-auto">
              {customer.shippingAddress}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-stone-500">Same as billing address</p>
          )}
        </div>
      </section>

      {/* Items */}
      <table className="mt-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-stone-300 text-left text-[10px] uppercase tracking-[0.16em] text-stone-500">
            <th className="py-2 pr-2 font-medium">#</th>
            <th className="py-2 pr-2 font-medium">Product</th>
            <th className="py-2 pr-2 font-medium">Lot No.</th>
            <th className="py-2 pr-2 text-right font-medium">Qty</th>
            <th className="py-2 pr-2 text-right font-medium">Rate</th>
            <th className="py-2 pr-2 text-right font-medium">GST</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={item.id ?? i} className="border-b border-stone-200">
              <td className="py-2.5 pr-2 text-stone-500">{i + 1}</td>
              <td className="py-2.5 pr-2 font-medium">{item.productName ?? `Product #${item.productId}`}</td>
              <td className="py-2.5 pr-2 font-mono text-xs text-stone-600">{item.lotNumber || "—"}</td>
              <td className="font-mono tnum py-2.5 pr-2 text-right">{formatQty(item.quantity)}</td>
              <td className="font-mono tnum py-2.5 pr-2 text-right">{formatINR(item.unitPrice)}</td>
              <td className="font-mono tnum py-2.5 pr-2 text-right text-stone-600">{item.taxRatePercent}%</td>
              <td className="font-mono tnum py-2.5 text-right font-medium">{formatINR(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-5 flex justify-end">
        <div className="w-full max-w-[280px] space-y-1.5 text-sm">
          <div className="flex justify-between text-stone-600">
            <span>Subtotal</span>
            <span className="font-mono tnum">{formatINR(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between text-stone-600">
            <span>CGST 9%</span>
            <span className="font-mono tnum">{formatINR(invoice.taxTotal / 2)}</span>
          </div>
          <div className="flex justify-between text-stone-600">
            <span>SGST 9%</span>
            <span className="font-mono tnum">{formatINR(invoice.taxTotal / 2)}</span>
          </div>
          <div className="flex justify-between border-t-2 border-stone-800 pt-2 text-base font-semibold">
            <span>Grand Total</span>
            <span className="font-mono tnum">{formatINR(invoice.grandTotal)}</span>
          </div>
          {!cancelled && (invoice.paidAt || (invoice.paidAmount ?? 0) > 0) && (
            <div className="border-t border-stone-200 pt-2 text-xs">
              {invoice.paidAt ? (
                <div className="flex justify-between text-emerald-700">
                  <span className="font-medium uppercase tracking-wider">Payment received</span>
                  <span className="font-mono">
                    {formatINR(invoice.grandTotal)}
                    {invoice.paymentMethod ? ` · ${METHOD_LABEL_PRINT[invoice.paymentMethod] ?? invoice.paymentMethod}` : ""}
                    {invoice.paidAmount != null && invoice.paidAmount < invoice.grandTotal - 0.005
                      ? ""
                      : ` · ${formatDate(invoice.paidAt)}`}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between text-amber-700">
                  <span className="font-medium uppercase tracking-wider">Part payment</span>
                  <span className="font-mono">
                    {formatINR(invoice.paidAmount ?? 0)} of {formatINR(invoice.grandTotal)}
                    {invoice.paymentMethod
                      ? ` · ${METHOD_LABEL_PRINT[invoice.paymentMethod] ?? invoice.paymentMethod}`
                      : ""}
                  </span>
                </div>
              )}
              {!invoice.paidAt && (
                <div className="mt-1 flex justify-between font-medium text-stone-800">
                  <span className="uppercase tracking-wider">Balance due</span>
                  <span className="font-mono">
                    {formatINR(invoice.grandTotal - (invoice.paidAmount ?? 0))}
                  </span>
                </div>
              )}
              {invoice.paidAt && invoice.paidAmount != null && invoice.paidAmount < invoice.grandTotal - 0.005 && (
                <div className="mt-1 flex justify-between font-medium text-stone-800">
                  <span className="uppercase tracking-wider">Settled on</span>
                  <span className="font-mono">{formatDate(invoice.paidAt)}</span>
                </div>
              )}
              {invoice.paymentNotes && (
                <p className="mt-1 text-right text-[10px] text-stone-500">Ref: {invoice.paymentNotes}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Payment receipt history (per-payment ledger rows; voided receipts stay visible, struck out) */}
      {!cancelled && (invoice.payments?.length ?? 0) > 0 && (
        <section className="mt-5 rounded-lg border border-stone-200 p-4 text-xs">
          <p className="font-semibold uppercase tracking-wider text-stone-600">Payment receipts</p>
          <table className="mt-2 w-full">
            <tbody>
              {invoice.payments!.map((p, i) => {
                const voided = Boolean(p.voidedAt);
                return (
                  <tr key={p.id} className="border-b border-stone-100 last:border-0">
                    <td className="py-1.5 pr-2 text-stone-500">{i + 1}</td>
                    <td className="py-1.5 pr-2 text-stone-700">{formatDate(p.paidAt)}</td>
                    <td className="py-1.5 pr-2 text-stone-700">
                      {METHOD_LABEL_PRINT[p.method] ?? p.method}
                      {voided ? (
                        <span className="ml-1.5 rounded bg-rose-100 px-1 py-px font-mono text-[9px] font-semibold uppercase text-rose-700">
                          Voided
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[10px] text-stone-500">
                      {voided ? `VOID: ${p.voidReason ?? "reversed"}` : p.notes || "—"}
                    </td>
                    <td
                      className={
                        "py-1.5 text-right font-mono font-medium " +
                        (voided ? "text-rose-600/70 line-through" : "text-emerald-700")
                      }
                    >
                      {formatINR(p.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Cancellation note */}
      {cancelled && invoice.cancellationReason && (
        <section className="mt-6 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm">
          <p className="font-semibold text-rose-700">Cancellation reason</p>
          <p className="mt-1 text-stone-700">{invoice.cancellationReason}</p>
          {invoice.cancelledAt && (
            <p className="mt-1 text-xs text-rose-600/90">
              Cancelled {formatDateTime(invoice.cancelledAt)} · stock restored to inventory
            </p>
          )}
        </section>
      )}

      {/* Signatory */}
      <footer className="mt-12 flex items-end justify-between border-t border-stone-200 pt-6">
        <p className="max-w-[300px] text-[11px] leading-relaxed text-stone-400">
          This is a computer-generated tax invoice and does not require a physical stamp. Goods once
          sold are traceable to their source lot via the Timber Atelier ledger.
        </p>
        <div className="text-center">
          <div className="h-12 w-44 border-b border-stone-400" />
          <p className="mt-1.5 text-xs text-stone-500">Authorized Signatory</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Print dialog — fetches full invoice detail (with customer object)
 * and offers Print / Save PDF. `autoPrint` triggers window.print()
 * automatically (used by the "Download PDF" row action).
 */
export function InvoicePrintDialog({
  invoice,
  open,
  onOpenChange,
  autoPrint = false,
}: {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  autoPrint?: boolean;
}) {
  const [detail, setDetail] = React.useState<Invoice | null>(null);
  const [loading, setLoading] = React.useState(false);
  const autoPrintedRef = React.useRef(false);

  React.useEffect(() => {
    if (!open || !invoice) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .invoice(invoice.id)
      .then((full) => {
        if (!cancelled) setDetail(full);
      })
      .catch(() => {
        // Fall back to the row data (list may already embed customer fields).
        if (!cancelled) setDetail(invoice);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, invoice]);

  React.useEffect(() => {
    if (!open) {
      autoPrintedRef.current = false;
      return;
    }
    if (!autoPrint || loading || !detail || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [open, autoPrint, loading, detail]);

  const inv = detail ?? invoice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Invoice {inv?.invoiceNumber}</DialogTitle>
          <DialogDescription>Printable tax invoice document</DialogDescription>
        </DialogHeader>
        {inv ? (
          <>
            <InvoiceDocument invoice={inv} />
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
