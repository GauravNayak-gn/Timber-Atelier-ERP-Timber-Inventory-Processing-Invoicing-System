"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Ban,
  Banknote,
  CalendarClock,
  CircleOff,
  Landmark,
  Layers,
  Loader2,
  Printer,
  ReceiptText,
  Smartphone,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PaidBadge, StatusBadge } from "@/components/timber/primitives";
import { useApi } from "@/components/timber/hooks";
import { api } from "@/lib/api-client";
import { formatDateTime, formatINR, formatQty } from "@/lib/format";
import type { Invoice, InvoicePayment } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ── Payment method presentation ── */

const METHOD_META: Record<string, { icon: LucideIcon; label: string }> = {
  CASH: { icon: Banknote, label: "Cash" },
  UPI: { icon: Smartphone, label: "UPI" },
  BANK_TRANSFER: { icon: Landmark, label: "Bank Transfer" },
  CHEQUE: { icon: ReceiptText, label: "Cheque" },
};
const methodMeta = (m: string) => METHOD_META[m] ?? { icon: Banknote, label: m };

/**
 * Quick-view invoice drawer — full line items, money math and the
 * per-payment receipt timeline (InvoicePayment rows) without opening
 * the printable document. Actions (print / pay / cancel) are delegated
 * to the parent so dialogs stay single-sourced. Voiding a mis-recorded
 * receipt is handled internally (append-only audit trail on the row).
 */
export function InvoiceDetailDrawer({
  invoice,
  open,
  onOpenChange,
  onPrint,
  onRecordPayment,
  onCancel,
  onVoided,
}: {
  /** Row snapshot (may lack payments) — enriched by a fresh fetch while open. */
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPrint: (invoice: Invoice) => void;
  onRecordPayment: (invoice: Invoice) => void;
  onCancel: (invoice: Invoice) => void;
  /** Called after a receipt is voided so the parent list can refresh. */
  onVoided?: () => void;
}) {
  const { toast } = useToast();
  // Fresh detail (with payment rows) fetched only while the drawer is open.
  const detail = useApi<Invoice>(open && invoice ? `/api/invoices/${invoice.id}` : null);
  const inv = detail.data ?? invoice;

  // Void-receipt flow (mis-recorded payment correction).
  const [voidTarget, setVoidTarget] = React.useState<InvoicePayment | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const [voiding, setVoiding] = React.useState(false);

  const confirmVoid = async () => {
    if (!inv || !voidTarget || voidReason.trim().length < 3) return;
    setVoiding(true);
    try {
      await api.voidPayment(inv.id, voidTarget.id, voidReason.trim());
      toast({
        title: `Receipt #${voidTarget.id} voided`,
        description: `${formatINR(voidTarget.amount)} reversed — settlement recomputed from remaining receipts.`,
      });
      setVoidTarget(null);
      setVoidReason("");
      detail.reload();
      onVoided?.();
    } catch (e) {
      toast({
        title: "Could not void receipt",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setVoiding(false);
    }
  };

  const grandTotal = inv?.grandTotal ?? 0;
  const paid = inv?.paidAmount ?? 0;
  const balance = Math.max(0, grandTotal - paid);
  const pct = grandTotal > 0 ? Math.min(100, (paid / grandTotal) * 100) : 0;
  const payments = inv?.payments ?? [];
  const settled = Boolean(inv?.paidAt);
  const cancelled = inv?.status === "CANCELLED";
  const canPay = !cancelled && !settled;

  // Legacy guard: invoices settled before the payment ledger existed carry
  // aggregate totals without receipt rows — explain instead of showing "none".
  const legacyAggregate = !cancelled && paid > 0.005 && payments.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border/70 p-5 pb-4">
          <div className="flex items-start gap-3 pr-6">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
              <ReceiptText className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="font-display truncate text-left text-lg">
                  {inv?.invoiceNumber ?? "Invoice"}
                </SheetTitle>
                {inv ? (
                  <>
                    <StatusBadge status={inv.status} className="h-5 px-1.5 text-[9px]" />
                    <PaidBadge
                      paidAt={inv.paidAt}
                      status={inv.status}
                      paidAmount={inv.paidAmount}
                      grandTotal={inv.grandTotal}
                      className="h-5 px-1.5 text-[9px]"
                    />
                  </>
                ) : null}
              </div>
              <SheetDescription className="mt-0.5 text-left">
                {inv
                  ? `${inv.customerName ?? "Customer"} · ${formatDateTime(inv.invoiceDate)}`
                  : "Loading…"}
              </SheetDescription>
            </div>
          </div>

          {/* Money strip */}
          <div className="mt-4">
            <div className="grid grid-cols-3 gap-2">
              <StatBlock label="Grand Total" value={formatINR(grandTotal)} />
              <StatBlock
                label="Received"
                value={formatINR(paid)}
                tone={paid > 0 ? "emerald" : undefined}
              />
              <StatBlock
                label="Balance"
                value={formatINR(balance)}
                tone={balance > 0 ? "amber" : "emerald"}
              />
            </div>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <motion.div
                className={cn("h-full rounded-full", settled ? "bg-emerald-500" : "bg-amber-500")}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!inv || detail.loading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
          ) : detail.error ? (
            <p className="py-10 text-center text-sm text-rose-700 dark:text-rose-300">{detail.error}</p>
          ) : (
            <div className="space-y-6">
              {/* Line items */}
              <section aria-label="Invoice line items" className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Line items · {inv.items.length}
                </h3>
                <ul className="space-y-2">
                  {inv.items.map((item, i) => (
                    <motion.li
                      key={item.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.25 }}
                      className="rounded-lg border border-border/70 bg-secondary/30 p-3 transition-colors hover:border-primary/30 hover:bg-accent/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.productName ?? `Product #${item.productId}`}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                            <Layers className="size-3 shrink-0" />
                            {item.lotNumber}
                          </p>
                        </div>
                        <p className="font-mono tnum text-sm font-semibold text-primary">
                          {formatINR(item.lineTotal)}
                        </p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono tnum text-[11px] text-muted-foreground">
                        <span>{formatQty(item.quantity)} × {formatINR(item.unitPrice)}</span>
                        <span>GST {item.taxRatePercent}% ({formatINR(item.taxAmount)})</span>
                      </div>
                    </motion.li>
                  ))}
                </ul>

                {/* Totals */}
                <div className="space-y-1 rounded-lg border border-border/70 bg-card p-3 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-mono tnum">{formatINR(inv.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>GST (CGST {formatINR(inv.taxTotal / 2)} + SGST {formatINR(inv.taxTotal / 2)})</span>
                    <span className="font-mono tnum">{formatINR(inv.taxTotal)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border/70 pt-1.5 text-sm font-semibold">
                    <span>Grand Total</span>
                    <span className="font-mono tnum text-primary">{formatINR(inv.grandTotal)}</span>
                  </div>
                </div>
              </section>

              {/* Cancellation record */}
              {cancelled ? (
                <section className="rounded-lg border border-rose-200 bg-rose-50/70 p-3.5 text-xs text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">
                  <p className="flex items-center gap-1.5 font-medium">
                    <Ban className="size-3.5" /> Invoice cancelled
                    {inv.cancelledAt ? ` · ${formatDateTime(inv.cancelledAt)}` : ""}
                  </p>
                  {inv.cancellationReason ? (
                    <p className="mt-1 italic opacity-90">“{inv.cancellationReason}”</p>
                  ) : null}
                  <p className="mt-1 opacity-80">
                    Stock was restored to inventory and the ledger records the reversal.
                  </p>
                </section>
              ) : (
                /* Payment history timeline */
                <section aria-label="Payment history" className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Payment history
                    </h3>
                    <span className="font-mono tnum text-[11px] text-muted-foreground">
                      {payments.length} receipt{payments.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  {payments.length === 0 ? (
                    <div
                      className={cn(
                        "rounded-lg border border-dashed px-4 py-6 text-center text-xs",
                        legacyAggregate
                          ? "border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-300"
                          : "border-border/90 bg-card/60 text-muted-foreground"
                      )}
                    >
                      {legacyAggregate ? (
                        <>
                          <p className="font-medium">{formatINR(paid)} received (aggregate)</p>
                          <p className="mt-1 opacity-80">
                            This invoice was settled before per-payment receipts were tracked. The
                            total is shown on the invoice; individual receipts are not itemised.
                          </p>
                        </>
                      ) : cancelled ? (
                        <p>No payments were recorded before cancellation.</p>
                      ) : (
                        <>
                          <p className="font-medium">No payments received yet</p>
                          <p className="mt-1 opacity-80">
                            Use “Record payment” to log the first receipt — partial payments are
                            tracked one by one.
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <ol className="relative space-y-3 border-l border-border/80 pl-5">
                      {payments.map((p, i) => (
                        <PaymentRow
                          key={p.id}
                          payment={p}
                          index={i}
                          last={i === payments.length - 1}
                          canVoid={!cancelled && !p.voidedAt}
                          onVoid={() => {
                            setVoidReason("");
                            setVoidTarget(p);
                          }}
                        />
                      ))}
                    </ol>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {inv ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-card/70 p-4">
            <Button variant="outline" size="sm" onClick={() => onPrint(inv)}>
              <Printer className="size-3.5" /> Print / PDF
            </Button>
            {canPay ? (
              <Button size="sm" onClick={() => onRecordPayment(inv)}>
                <Banknote className="size-3.5" />
                {paid > 0 ? "Record another payment" : "Record payment"}
              </Button>
            ) : null}
            {!cancelled ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCancel(inv)}
                className="ml-auto text-muted-foreground hover:text-destructive"
              >
                <Ban className="size-3.5" /> Cancel invoice
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>

      {/* Void receipt dialog — mis-recorded payment correction */}
      <AlertDialog open={Boolean(voidTarget)} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Void receipt #{voidTarget?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This reverses a {voidTarget ? formatINR(voidTarget.amount) : ""} {voidTarget ? methodMeta(voidTarget.method).label : ""} receipt on
              {" "}
              {inv?.invoiceNumber}. The receipt row is kept for audit but excluded from
              received totals; the invoice reverts to its recomputed balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="void-reason">Reason for voiding</Label>
            <Input
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. wrong UTR recorded — payment not received"
              autoFocus
              disabled={voiding}
              onKeyDown={(e) => {
                if (e.key === "Enter" && voidReason.trim().length >= 3 && !voiding) {
                  e.preventDefault();
                  void confirmVoid();
                }
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Recorded on the voided receipt — minimum 3 characters.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voiding}>Keep receipt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
              disabled={voidReason.trim().length < 3 || voiding}
              onClick={(e) => {
                e.preventDefault();
                void confirmVoid();
              }}
            >
              {voiding ? <Loader2 className="size-4 animate-spin" /> : <CircleOff className="size-4" />}
              Void receipt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/* ── Single payment receipt row ── */

function PaymentRow({
  payment,
  index,
  last,
  canVoid,
  onVoid,
}: {
  payment: InvoicePayment;
  index: number;
  last: boolean;
  canVoid: boolean;
  onVoid: () => void;
}) {
  const meta = methodMeta(payment.method);
  const Icon = meta.icon;
  const voided = Boolean(payment.voidedAt);
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.35), duration: 0.25 }}
      className="relative"
    >
      <span
        className={cn(
          "absolute -left-[26.5px] top-1.5 grid size-3.5 place-items-center rounded-full border-2 border-background",
          voided
            ? "bg-rose-200 dark:bg-rose-900"
            : last
              ? "bg-emerald-500"
              : "bg-amber-500"
        )}
      />
      <div
        className={cn(
          "group/row flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors",
          voided
            ? "border-rose-200/80 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/10"
            : "border-border/70 bg-secondary/30 hover:border-emerald-200 hover:bg-emerald-50/40 dark:hover:border-emerald-900/70 dark:hover:bg-emerald-950/20"
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg shadow-sm",
              voided ? "bg-rose-100 text-rose-500 dark:bg-rose-950/60 dark:text-rose-400" : "bg-background text-muted-foreground"
            )}
          >
            {voided ? <CircleOff className="size-4" /> : <Icon className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className={cn("flex items-center gap-1.5 text-xs font-medium", voided && "text-muted-foreground")}>
              Receipt {index + 1} · {meta.label}
              {voided ? (
                <span className="rounded bg-rose-100 px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wider text-rose-700 dark:bg-rose-950/70 dark:text-rose-300">
                  Voided
                </span>
              ) : null}
            </p>
            <p className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <CalendarClock className="size-2.5 shrink-0" />
              {formatDateTime(payment.paidAt)}
            </p>
            {payment.notes ? (
              <p className="truncate font-mono text-[10px] text-muted-foreground/80" title={payment.notes}>
                Ref: {payment.notes}
              </p>
            ) : null}
            {voided && payment.voidReason ? (
              <p className="mt-0.5 text-[10px] italic text-rose-700/80 dark:text-rose-400/80">
                Voided{payment.voidedAt ? ` ${formatDateTime(payment.voidedAt)}` : ""} · “{payment.voidReason}”
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <p
            className={cn(
              "font-mono tnum text-sm font-semibold",
              voided
                ? "text-rose-600/70 line-through decoration-rose-400/60 dark:text-rose-400/70"
                : "text-emerald-700 dark:text-emerald-400"
            )}
          >
            +{formatINR(payment.amount)}
          </p>
          {canVoid ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
              aria-label={`Void receipt ${index + 1}`}
              title="Void this receipt"
              onClick={onVoid}
            >
              <Undo2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "emerald";
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-secondary/40 px-2.5 py-2 text-center">
      <p
        className={cn(
          "font-mono tnum text-sm font-semibold leading-none",
          tone === "amber" && "text-amber-700 dark:text-amber-400",
          tone === "emerald" && "text-emerald-700 dark:text-emerald-400"
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
    </div>
  );
}
