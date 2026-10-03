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
import { formatDate, formatDateTime, formatINR, formatQty } from "@/lib/format";
import type { Invoice, ProcessingBatch } from "@/lib/types";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
};

/** One fully-settled invoice tied to this batch's output lots. */
export interface LotSettlement {
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  settledAt: string;
  method?: string | null;
  grandTotal: number;
  lines: { lotNumber: string; productName: string; quantity: number }[];
}

/**
 * Paper-white processing batch report. Everything inside `.invoice-print`
 * is visible when printing (see globals.css @media print rules).
 */
export function BatchReportDocument({
  batch,
  settlements = [],
}: {
  batch: ProcessingBatch;
  /** Fully-paid invoices whose lines sell lots this batch produced. */
  settlements?: LotSettlement[];
}) {
  const cancelled = batch.status === "CANCELLED";
  const finished = batch.outputs.filter((o) => o.outputType !== "WASTE");
  const waste = batch.outputs.filter((o) => o.outputType === "WASTE");
  const yieldPct =
    batch.totalInputQty > 0
      ? Math.min(100, (batch.totalOutputQty / batch.totalInputQty) * 100)
      : 0;

  return (
    <div className="invoice-print relative mx-auto w-full bg-white p-8 text-stone-900 sm:p-10">
      {cancelled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span className="font-display -rotate-[18deg] select-none rounded-2xl border-[5px] border-rose-600/10 px-10 py-3 text-7xl font-bold uppercase tracking-[0.2em] text-rose-600/10">
            Cancelled
          </span>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-stone-800 pb-6">
        <div className="flex items-center gap-3">
          <TimberMark className="size-11 text-stone-800" />
          <div>
            <p className="font-display text-2xl font-semibold tracking-tight">TIMBER ATELIER ERP</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.28em] text-stone-500">
              Processing Batch Report
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Batch</p>
          <p className="font-mono text-lg font-semibold">{batch.batchNumber}</p>
          <p className="mt-0.5 text-xs text-stone-500">{formatDate(batch.processingDate)}</p>
          <p className="mt-1 inline-block rounded border border-stone-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-600">
            {batch.status}
          </p>
        </div>
      </header>

      {/* Totals strip */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Input", value: `${formatQty(batch.totalInputQty)} CFT` },
          { label: "Good output", value: `${formatQty(batch.totalOutputQty)} CFT` },
          { label: "Waste", value: `${formatQty(batch.totalWasteQty)} CFT` },
          { label: "Yield", value: `${yieldPct.toFixed(1)}%` },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
            <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-stone-500">{s.label}</p>
            <p className="font-mono tnum mt-1 text-sm font-semibold">{s.value}</p>
          </div>
        ))}
      </section>

      {/* Inputs */}
      <section className="mt-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">
          Raw materials consumed
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-stone-300 text-left text-[10px] uppercase tracking-[0.16em] text-stone-500">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Material</th>
              <th className="py-2 pr-2 font-medium">Lot No.</th>
              <th className="py-2 text-right font-medium">Qty consumed</th>
            </tr>
          </thead>
          <tbody>
            {batch.inputs.map((input, i) => (
              <tr key={input.id ?? i} className="border-b border-stone-200">
                <td className="py-2.5 pr-2 text-stone-500">{i + 1}</td>
                <td className="py-2.5 pr-2 font-medium">{input.rawMaterialName ?? `Material #${input.rawMaterialId}`}</td>
                <td className="py-2.5 pr-2 font-mono text-xs text-stone-600">{input.lotNumber}</td>
                <td className="font-mono tnum py-2.5 text-right">
                  −{formatQty(input.quantityConsumed)} {input.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Outputs */}
      <section className="mt-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">
          Output produced
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-stone-300 text-left text-[10px] uppercase tracking-[0.16em] text-stone-500">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Product</th>
              <th className="py-2 pr-2 font-medium">Type</th>
              <th className="py-2 pr-2 font-medium">Lot No.</th>
              <th className="py-2 text-right font-medium">Qty produced</th>
            </tr>
          </thead>
          <tbody>
            {batch.outputs.map((output, i) => (
              <tr key={output.id ?? i} className="border-b border-stone-200">
                <td className="py-2.5 pr-2 text-stone-500">{i + 1}</td>
                <td className="py-2.5 pr-2 font-medium">
                  {output.productName ?? (output.outputType === "WASTE" ? "Waste" : `Product #${output.productId ?? "—"}`)}
                </td>
                <td className="py-2.5 pr-2">
                  <span className="inline-block rounded border border-stone-300 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-stone-600">
                    {output.outputType}
                  </span>
                </td>
                <td className="py-2.5 pr-2 font-mono text-xs text-stone-600">{output.lotNumber}</td>
                <td className="font-mono tnum py-2.5 text-right">
                  {output.outputType === "WASTE" ? "" : "+"}
                  {formatQty(output.quantityProduced)} {output.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Waste note */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm">
        <p className="font-semibold">Conversion summary</p>
        <p className="mt-1 text-stone-700">
          {formatQty(batch.totalInputQty)} CFT of raw input produced {formatQty(batch.totalOutputQty)} CFT of
          saleable output ({finished.length} finished/secondary lot{finished.length === 1 ? "" : "s"})
          {waste.length > 0 ? ` with ${formatQty(batch.totalWasteQty)} CFT recorded as waste` : ""} — a waste
          factor of {batch.wastePercentage.toFixed(1)}%.
        </p>
      </section>

      {batch.notes && (
        <section className="mt-4 text-sm">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">Notes</p>
          <p className="mt-1 italic text-stone-700">{batch.notes}</p>
        </section>
      )}

      {/* Settlement receipts — invoices fully paid against lots this batch produced */}
      {settlements.length > 0 ? (
        <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-xs print:break-inside-avoid">
          <p className="font-semibold uppercase tracking-wider text-emerald-800">Lot settlement receipts</p>
          <p className="mt-0.5 text-[11px] text-stone-600">
            Output lots from this batch that have been fully paid for by customers.
          </p>
          <table className="mt-2 w-full">
            <thead>
              <tr className="border-y border-stone-300 text-left text-[10px] uppercase tracking-[0.16em] text-stone-500">
                <th className="py-1.5 pr-2 font-medium">Invoice</th>
                <th className="py-1.5 pr-2 font-medium">Customer</th>
                <th className="py-1.5 pr-2 font-medium">Lot(s) from this batch</th>
                <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-2 text-right font-medium">Invoice total</th>
                <th className="py-1.5 text-right font-medium">Settled</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.invoiceNumber} className="border-b border-stone-100 last:border-0">
                  <td className="py-2 pr-2 font-mono font-medium text-stone-800">{s.invoiceNumber}</td>
                  <td className="py-2 pr-2 text-stone-700">{s.customerName}</td>
                  <td className="py-2 pr-2 font-mono text-[10px] text-stone-600">
                    {s.lines.map((l) => l.lotNumber).join(", ")}
                  </td>
                  <td className="font-mono tnum py-2 pr-2 text-right text-stone-700">
                    {formatQty(s.lines.reduce((sum, l) => sum + l.quantity, 0))}
                  </td>
                  <td className="font-mono tnum py-2 pr-2 text-right font-medium text-stone-800">
                    {formatINR(s.grandTotal)}
                  </td>
                  <td className="py-2 text-right text-emerald-700">
                    {formatDate(s.settledAt)}
                    {s.method ? (
                      <span className="ml-1 font-mono text-[10px] text-stone-500">
                        {METHOD_LABEL[s.method] ?? s.method}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {cancelled && batch.cancellationReason && (
        <section className="mt-4 rounded-lg border-2 border-rose-300 bg-rose-50 px-4 py-3 text-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-700">
            Cancellation recorded
          </p>
          <p className="mt-1 text-rose-900">{batch.cancellationReason}</p>
          {batch.cancelledAt ? (
            <p className="mt-0.5 font-mono text-[11px] text-rose-700/80">
              Reversed on {formatDateTime(batch.cancelledAt)} — stock movements voided in the audit ledger.
            </p>
          ) : null}
        </section>
      )}

      {/* Signatory */}
      <footer className="mt-12 flex items-end justify-between border-t border-stone-200 pt-6">
        <p className="max-w-[300px] text-[11px] leading-relaxed text-stone-400">
          Computer-generated batch report. Every input and output is traceable in the append-only Timber
          Atelier audit ledger. Generated {formatDateTime(new Date())}.
        </p>
        <div className="text-center">
          <div className="h-12 w-44 border-b border-stone-400" />
          <p className="mt-1.5 text-xs text-stone-500">Workshop Supervisor</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Batch report dialog — Print / Save PDF for a processing batch.
 * While open it also resolves SETTLEMENT RECEIPTS: confirmed + fully paid
 * invoices whose line items sell lots this batch produced (receipt schedule
 * embedded on the printed report).
 */
export function BatchReportDialog({
  batch,
  open,
  onOpenChange,
  autoPrint = false,
}: {
  batch: ProcessingBatch | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  autoPrint?: boolean;
}) {
  const autoPrintedRef = React.useRef(false);
  const [invoices, setInvoices] = React.useState<Invoice[] | null>(null);

  React.useEffect(() => {
    if (!open || !batch) {
      setInvoices(null);
      return;
    }
    let cancelled = false;
    api
      .invoices()
      .then((list) => {
        if (!cancelled) setInvoices(list);
      })
      .catch(() => {
        // Settlement section is additive — the report still renders without it.
        if (!cancelled) setInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, batch]);

  const settlements = React.useMemo<LotSettlement[]>(() => {
    if (!batch || !invoices) return [];
    const batchLots = new Set(
      batch.outputs.filter((o) => o.outputType !== "WASTE").map((o) => o.lotNumber)
    );
    if (batchLots.size === 0) return [];
    return invoices
      .filter((inv) => inv.status === "CONFIRMED" && inv.paidAt)
      .map((inv) => ({
        invoice: inv,
        lines: inv.items
          .filter((it) => batchLots.has(it.lotNumber))
          .map((it) => ({
            lotNumber: it.lotNumber,
            productName: it.productName ?? `Product #${it.productId}`,
            quantity: it.quantity,
          })),
      }))
      .filter((m) => m.lines.length > 0)
      .map(({ invoice: inv, lines }) => ({
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer?.companyName ?? inv.customerName ?? "—",
        invoiceDate: inv.invoiceDate,
        settledAt: inv.paidAt as string,
        method: inv.paymentMethod,
        grandTotal: inv.grandTotal,
        lines,
      }));
  }, [batch, invoices]);

  React.useEffect(() => {
    if (!open) {
      autoPrintedRef.current = false;
      return;
    }
    if (!autoPrint || !batch || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [open, autoPrint, batch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Batch report {batch?.batchNumber}</DialogTitle>
          <DialogDescription>Printable processing batch report</DialogDescription>
        </DialogHeader>
        {batch ? (
          <>
            <BatchReportDocument batch={batch} settlements={settlements} />
            <DialogFooter className="border-t border-border/70 p-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="size-4" />
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
