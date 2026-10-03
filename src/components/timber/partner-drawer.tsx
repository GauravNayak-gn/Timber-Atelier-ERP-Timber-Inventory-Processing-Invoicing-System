"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Banknote,
  CalendarClock,
  CircleOff,
  Factory,
  FileText,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  Package2,
  Phone,
  ReceiptText,
  Smartphone,
  Truck,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PaidBadge, StatusBadge } from "@/components/timber/primitives";
import { SupplierStatementDialog } from "@/components/timber/supplier-statement";
import { useApi } from "@/components/timber/hooks";
import { api } from "@/lib/api-client";
import { formatCompactINR, formatDate, formatDateTime, formatINR, formatQty, parseNumber } from "@/lib/format";
import type {
  Invoice,
  PartnerCustomer,
  PartnerSupplier,
  RecordSupplierPaymentRequest,
  SupplierAgingSummary,
  SupplierPayment,
  SupplierPoBill,
} from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ── Payment method presentation (mirrors invoice drawer) ── */

const METHOD_META: Record<string, { icon: LucideIcon; label: string }> = {
  CASH: { icon: Banknote, label: "Cash" },
  UPI: { icon: Smartphone, label: "UPI" },
  BANK_TRANSFER: { icon: Landmark, label: "Bank Transfer" },
  CHEQUE: { icon: ReceiptText, label: "Cheque" },
};
const methodMeta = (m: string) => METHOD_META[m] ?? { icon: Banknote, label: m };

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CHEQUE", label: "Cheque" },
] as const;

/**
 * Drill-down drawer for the Partners view.
 * Suppliers → PAYABLES position: per-PO bills derived from the PURCHASE
 * ledger, with payment receipts, aging buckets and a pay/void flow
 * (GET/POST /api/suppliers/[id]/payables·payments).
 * Customers → their invoice history with payment status.
 */
export function PartnerDrawer({
  kind,
  partner,
  open,
  onOpenChange,
  autoPay = false,
}: {
  kind: "supplier" | "customer";
  partner: PartnerSupplier | PartnerCustomer | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** "Pay bill" deep-link: auto-open the Pay dialog on the most-outstanding bill. */
  autoPay?: boolean;
}) {
  const isSupplier = kind === "supplier";
  const [statementOpen, setStatementOpen] = React.useState(false);

  // Payables summary fetched only while the drawer is open (supplier side);
  // invoices list reused for the customer side.
  const payables = useApi<SupplierAgingSummary>(
    open && isSupplier && partner ? `/api/suppliers/${partner.id}/payables` : null
  );
  const invoices = useApi<Invoice[]>(
    open && !isSupplier ? "/api/invoices" : null
  );

  const customerInvoices = React.useMemo(() => {
    if (!invoices.data || !partner || isSupplier) return [];
    return invoices.data.filter((inv) => inv.customerId === partner.id);
  }, [invoices.data, partner, isSupplier]);

  const billedTotal = customerInvoices
    .filter((i) => i.status === "CONFIRMED")
    .reduce((s, i) => s + i.grandTotal, 0);
  const outstandingTotal = customerInvoices
    .filter((i) => i.status === "CONFIRMED" && !i.paidAt)
    .reduce((s, i) => s + i.grandTotal, 0);

  const summary = payables.data;

  // "Pay bill" chain: once the FRESH payables fetch lands (never stale data),
  // pick the unsettled bill with the largest outstanding balance.
  const autoPayPo = React.useMemo(() => {
    if (!autoPay || !summary || payables.loading) return null;
    const unsettled = summary.bills.filter((b) => b.status !== "SETTLED");
    if (unsettled.length === 0) return null;
    return unsettled.reduce((a, b) => (b.outstanding > a.outstanding ? b : a)).poNumber;
  }, [autoPay, summary, payables.loading]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/70 p-5 pb-4">
          <div className="flex items-start gap-3 pr-6">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
              {isSupplier ? <Truck className="size-5" /> : <ReceiptText className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-display truncate text-left text-lg">
                {partner?.companyName ?? "—"}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-left">
                {isSupplier ? "PO bills, payables & payment history" : "Invoice history & receivables"}
              </SheetDescription>
            </div>
            {isSupplier && partner ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground transition-colors hover:border hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                      aria-label={`Print account statement for ${partner.companyName}`}
                      onClick={() => setStatementOpen(true)}
                    >
                      <FileText className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Account statement (PDF)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>

          {/* Contact details */}
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            {partner?.contactPerson ? <p className="flex items-center gap-2"><Phone className="size-3 shrink-0" /> {partner.contactPerson}</p> : null}
            {partner?.phone ? <p className="flex items-center gap-2"><Phone className="size-3 shrink-0" /> {partner.phone}</p> : null}
            {partner?.email ? <p className="flex items-center gap-2"><Mail className="size-3 shrink-0" /> {partner.email}</p> : null}
            {"address" in (partner ?? {}) && (partner as PartnerSupplier).address ? (
              <p className="flex items-center gap-2"><MapPin className="size-3 shrink-0" /> {(partner as PartnerSupplier).address}</p>
            ) : null}
            {"billingAddress" in (partner ?? {}) && (partner as PartnerCustomer).billingAddress ? (
              <p className="flex items-center gap-2"><MapPin className="size-3 shrink-0" /> {(partner as PartnerCustomer).billingAddress}</p>
            ) : null}
            {partner?.gstNumber ? (
              <p className="font-mono text-[10px] tracking-wide">GSTIN {partner.gstNumber}</p>
            ) : null}
          </div>

          {/* Stat strip */}
          <div className="mt-4">
            {isSupplier ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <StatBlock
                    label="Billed"
                    value={summary ? formatCompactINR(summary.totalBilled) : "—"}
                    accent
                  />
                  <StatBlock
                    label="Paid"
                    value={summary ? formatCompactINR(summary.totalPaid) : "—"}
                    tone={(summary?.totalPaid ?? 0) > 0 ? "emerald" : undefined}
                  />
                  <StatBlock
                    label="Outstanding"
                    value={summary ? formatCompactINR(summary.totalOutstanding) : "—"}
                    tone={(summary?.totalOutstanding ?? 0) > 0 ? "amber" : "emerald"}
                  />
                </div>
                {/* Payables aging chips — only when there is money on the street */}
                {summary && summary.totalOutstanding > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {summary.buckets.map((b) => (
                      <span
                        key={b.label}
                        className={cn(
                          "rounded-full border px-2 py-0.5 font-mono tnum text-[10px]",
                          b.total > 0
                            ? "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"
                            : "border-border/70 text-muted-foreground/60"
                        )}
                        title={`${b.count} bill(s) in the ${b.label}-day bucket`}
                      >
                        {b.label}d · {formatCompactINR(b.total)}
                      </span>
                    ))}
                    {summary.overdueCount > 0 ? (
                      <span className="rounded-full border border-rose-300/80 bg-rose-50 px-2 py-0.5 font-mono tnum text-[10px] text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">
                        {summary.overdueCount} bill{summary.overdueCount === 1 ? "" : "s"} 30d+ overdue
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {summary && summary.totalBilled > 0 && summary.totalOutstanding <= 0.005 ? (
                  <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
                    All bills to this supplier are settled.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <StatBlock label="Invoices" value={String(customerInvoices.length)} />
                <StatBlock label="Billed" value={formatCompactINR(billedTotal)} accent />
                <StatBlock
                  label="Outstanding"
                  value={formatCompactINR(outstandingTotal)}
                  tone={outstandingTotal > 0 ? "amber" : "emerald"}
                />
              </div>
            )}
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {isSupplier ? (
            payables.loading && !summary ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
            ) : payables.error ? (
              <p className="py-10 text-center text-sm text-rose-700 dark:text-rose-300">{payables.error}</p>
            ) : !summary || summary.bills.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No purchase bills recorded for this supplier yet — receive stock against a PO in
                Raw Materials to open the first bill.
              </p>
            ) : (
              <SupplierBillsSection
                summary={summary}
                autoPayPo={autoPayPo}
                onChanged={() => void payables.reload()}
              />
            )
          ) : customerInvoices.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No invoices billed to this customer yet.
            </p>
          ) : (
            <ol className="relative space-y-4 border-l border-border/80 pl-5">
              {customerInvoices.map((inv, i) => (
                <motion.li
                  key={inv.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.25 }}
                  className="relative"
                >
                  <span
                    className={cn(
                      "absolute -left-[26.5px] top-1.5 grid size-3.5 place-items-center rounded-full border-2 border-background",
                      inv.status === "CANCELLED"
                        ? "bg-rose-500"
                        : inv.paidAt
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                    )}
                  />
                  <div className="rounded-lg border border-border/70 bg-secondary/30 p-3.5 transition-colors hover:border-primary/30 hover:bg-accent/40">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 font-mono text-xs font-semibold">
                        <FileText className="size-3.5 text-muted-foreground" />
                        {inv.invoiceNumber}
                      </p>
                      <p className="font-mono tnum text-sm font-semibold text-primary">
                        {formatINR(inv.grandTotal, { decimals: 0 })}
                      </p>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarClock className="size-3" /> {formatDate(inv.invoiceDate)}
                      </span>
                      <StatusBadge status={inv.status} className="h-5 px-1.5 text-[9px]" />
                      <PaidBadge paidAt={inv.paidAt} status={inv.status} className="h-5 px-1.5 text-[9px]" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Package2 className="size-3 shrink-0" />
                      {inv.items.length} line item{inv.items.length === 1 ? "" : "s"}
                      {" · "}
                      {inv.items.map((it) => it.productName ?? `#${it.productId}`).join(", ")}
                    </div>
                  </div>
                </motion.li>
              ))}
              {outstandingTotal > 0 ? (
                <li className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
                  <p className="flex items-center gap-1.5 font-medium">
                    <Banknote className="size-3.5" /> Outstanding balance {formatINR(outstandingTotal)}
                  </p>
                  <p className="mt-0.5 text-[11px] opacity-80">
                    Across {customerInvoices.filter((i) => i.status === "CONFIRMED" && !i.paidAt).length} unpaid
                    invoice(s) — mark them paid from the Invoicing view.
                  </p>
                </li>
              ) : (
                <li className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
                  All invoices from this customer are settled.
                </li>
              )}
            </ol>
          )}
        </div>
      {/* Printable supplier account statement (supplier side only) */}
      {isSupplier && partner ? (
        <SupplierStatementDialog
          supplier={{
            id: partner.id,
            companyName: partner.companyName,
            contactPerson: partner.contactPerson ?? null,
            phone: partner.phone ?? null,
            email: partner.email ?? null,
            address: (partner as PartnerSupplier).address ?? null,
            gstNumber: partner.gstNumber ?? null,
          }}
          open={statementOpen}
          onOpenChange={setStatementOpen}
        />
      ) : null}
      </SheetContent>
    </Sheet>
  );
}

/* ═══════════════ Supplier payables: per-PO bills + pay/void flows ═══════════════ */

function SupplierBillsSection({
  summary,
  autoPayPo,
  onChanged,
}: {
  summary: SupplierAgingSummary;
  /** PO to auto-open the Pay dialog for (deep-link chain); consumed once. */
  autoPayPo?: string | null;
  onChanged: () => void;
}) {
  // Pay-bill dialog state (one dialog serves every bill).
  const [payTarget, setPayTarget] = React.useState<SupplierPoBill | null>(null);
  // Void-receipt dialog state.
  const [voidTarget, setVoidTarget] = React.useState<SupplierPayment | null>(null);

  // Deep-link chain: open the Pay dialog once the target bill is available.
  const autoFiredRef = React.useRef(false);
  React.useEffect(() => {
    if (autoFiredRef.current || !autoPayPo) return;
    const bill = summary.bills.find((b) => b.poNumber === autoPayPo && b.status !== "SETTLED");
    if (bill) {
      autoFiredRef.current = true;
      setPayTarget(bill);
    }
  }, [autoPayPo, summary.bills]);

  return (
    <div className="space-y-5">
      <section aria-label="PO bills" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            PO bills · {summary.bills.length}
          </h3>
          <span className="font-mono tnum text-[11px] text-muted-foreground">
            {formatINR(summary.totalOutstanding, { decimals: 0 })} due
          </span>
        </div>

        <ol className="space-y-3">
          {summary.bills.map((bill, i) => (
            <PoBillCard
              key={bill.poNumber}
              bill={bill}
              index={i}
              supplierName={summary.supplierName}
              onPay={() => setPayTarget(bill)}
              onVoid={(p) => setVoidTarget(p)}
            />
          ))}
        </ol>
      </section>

      {/* Record supplier payment */}
      <PaySupplierDialog
        bill={payTarget}
        supplierId={summary.supplierId}
        onClose={() => setPayTarget(null)}
        onSubmitted={() => onChanged()}
      />

      {/* Void supplier receipt */}
      <AlertDialog open={Boolean(voidTarget)} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <VoidSupplierPaymentDialog
          target={voidTarget}
          onVoided={() => {
            setVoidTarget(null);
            onChanged();
          }}
          onClose={() => setVoidTarget(null)}
        />
      </AlertDialog>
    </div>
  );
}

/* ── One PO bill card ── */

function PoBillCard({
  bill,
  index,
  supplierName,
  onPay,
  onVoid,
}: {
  bill: SupplierPoBill;
  index: number;
  supplierName: string;
  onPay: () => void;
  onVoid: (payment: SupplierPayment) => void;
}) {
  const pct = bill.billed > 0 ? Math.min(100, (bill.paid / bill.billed) * 100) : 0;
  const settled = bill.status === "SETTLED";
  const meta = bill.materials.join(", ") || "—";

  const statusChip = settled ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
      Settled
    </span>
  ) : bill.status === "PARTIAL" ? (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
      Partial
    </span>
  ) : (
    <span className="rounded-full bg-rose-100 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-rose-800 dark:bg-rose-950/70 dark:text-rose-300">
      Unpaid
    </span>
  );

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.35), duration: 0.28 }}
      className={cn(
        "rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
        settled
          ? "border-emerald-200/70 bg-emerald-50/30 hover:border-emerald-300/70 dark:border-emerald-900/50 dark:bg-emerald-950/10"
          : "border-border/80 bg-secondary/30 hover:border-primary/30 hover:bg-accent/40"
      )}
    >
      {/* Head: PO · status · billed */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-1.5 font-mono text-sm font-semibold">
              <Factory className="size-3.5 text-muted-foreground" />
              {bill.poNumber}
            </p>
            {statusChip}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={meta}>
            {meta} · {bill.lineCount} line{bill.lineCount === 1 ? "" : "s"}
            {bill.lots.length > 0 ? ` · ${bill.lots.join(", ")}` : ""}
          </p>
        </div>
        <p className="shrink-0 font-mono tnum text-sm font-semibold text-primary">
          {formatINR(bill.billed, { decimals: 0 })}
        </p>
      </div>

      {/* Money math + progress */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border/60 bg-background/60 px-2 py-1.5">
          <p className="font-mono tnum text-xs font-semibold">{formatCompactINR(bill.billed)}</p>
          <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Billed</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 px-2 py-1.5">
          <p className="font-mono tnum text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            {formatCompactINR(bill.paid)}
          </p>
          <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Paid</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 px-2 py-1.5">
          <p
            className={cn(
              "font-mono tnum text-xs font-semibold",
              bill.outstanding > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
            )}
          >
            {formatCompactINR(bill.outstanding)}
          </p>
          <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Due</p>
        </div>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <motion.div
          className={cn("h-full rounded-full", settled ? "bg-emerald-500" : "bg-amber-500")}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarClock className="size-2.5" />
          First receipt {formatDate(bill.firstPurchaseDate)} · {bill.ageDays}d ago
        </span>
        <span className="font-mono tnum">{Math.round(pct)}% paid</span>
      </div>

      {/* Receipt rows (append-only; voided rows stay for audit) */}
      {bill.payments.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5">
          {bill.payments.map((p) => {
            const mMeta = methodMeta(p.method);
            const Icon = mMeta.icon;
            const voided = Boolean(p.voidedAt);
            return (
              <li
                key={p.id}
                className={cn(
                  "group/pay flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
                  voided
                    ? "border-rose-200/80 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/10"
                    : "border-border/60 bg-background/60"
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {voided ? (
                    <CircleOff className="size-3 shrink-0 text-rose-500" />
                  ) : (
                    <Icon className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn("truncate", voided ? "text-muted-foreground" : "")}>
                    {mMeta.label}
                    {p.notes ? (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground/80">· {p.notes}</span>
                    ) : null}
                    {voided && p.voidReason ? (
                      <span className="ml-1 italic text-rose-700/80 dark:text-rose-400/80">
                        · voided “{p.voidReason}”
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span
                    className={cn(
                      "font-mono tnum font-semibold",
                      voided
                        ? "text-rose-600/70 line-through decoration-rose-400/60 dark:text-rose-400/70"
                        : "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    −{formatINR(p.amount)}
                  </span>
                  {!voided ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/pay:opacity-100"
                      aria-label={`Void payment to ${supplierName} on ${bill.poNumber}`}
                      title="Void this payment"
                      onClick={() => onVoid(p)}
                    >
                      <Undo2 className="size-3" />
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[11px] italic text-muted-foreground/80">
          {settled ? "Settled." : "No payments recorded against this bill yet."}
        </p>
      )}

      {/* Pay action */}
      {!settled ? (
        <Button size="sm" className="mt-3 w-full" onClick={onPay}>
          <Banknote className="size-3.5" />
          {bill.paid > 0 ? "Pay balance" : "Pay bill"}
          <span className="font-mono tnum">{formatINR(bill.outstanding, { decimals: 0 })}</span>
        </Button>
      ) : null}
    </motion.li>
  );
}

/* ── Record supplier payment dialog (mirrors the invoicing flow) ── */

function PaySupplierDialog({
  bill,
  supplierId,
  onClose,
  onSubmitted,
}: {
  bill: SupplierPoBill | null;
  supplierId: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<string>("BANK_TRANSFER");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const open = bill !== null;
  const billed = bill?.billed ?? 0;
  const alreadyPaid = bill?.paid ?? 0;
  const balanceDue = Math.max(0, billed - alreadyPaid);

  React.useEffect(() => {
    if (open) {
      setAmount(balanceDue ? String(balanceDue) : "");
      setMethod("BANK_TRANSFER");
      setNotes("");
      setSubmitting(false);
    }
  }, [open, bill?.poNumber, balanceDue]);

  const parsedAmount = parseNumber(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= balanceDue + 0.005;
  const fullSettle = Number.isFinite(parsedAmount) && Math.abs(parsedAmount - balanceDue) <= 0.005;
  const afterPaid = alreadyPaid + (Number.isFinite(parsedAmount) ? parsedAmount : 0);
  const afterBalance = Math.max(0, billed - afterPaid);

  const submit = async () => {
    if (!bill || !amountValid || submitting) return;
    setSubmitting(true);
    const body: RecordSupplierPaymentRequest = {
      poNumber: bill.poNumber,
      ...(Math.abs(parsedAmount - balanceDue) <= 0.005 ? {} : { amount: parsedAmount }),
      ...(method ? { method: method as RecordSupplierPaymentRequest["method"] } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    try {
      await api.paySupplier(supplierId, body);
      toast({
        title: fullSettle ? "Bill settled" : "Payment recorded",
        description: `${bill.poNumber} · ${formatINR(parsedAmount)} via ${methodMeta(method).label}${
          fullSettle ? " · fully settled" : ` · ${formatINR(afterBalance)} still due`
        }`,
      });
      onSubmitted();
      onClose();
    } catch (e) {
      toast({
        title: "Could not record payment",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Pay Supplier Bill</DialogTitle>
          <DialogDescription>
            {bill ? `${bill.poNumber} · ${bill.materials.join(", ") || "Purchase"} · raised ${bill.ageDays}d ago` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Ledger strip */}
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/70 bg-secondary/30 p-3 text-center">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Billed</p>
              <p className="font-mono tnum text-sm font-semibold">{formatINR(billed)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Paid</p>
              <p className="font-mono tnum text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {formatINR(alreadyPaid)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Due</p>
              <p
                className={cn(
                  "font-mono tnum text-sm font-semibold",
                  balanceDue > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
                )}
              >
                {formatINR(balanceDue)}
              </p>
            </div>
            <div className="col-span-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-emerald-500"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${billed > 0 ? Math.min(100, (afterPaid / billed) * 100) : 0}%`,
                  }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sup-pay-amount">Amount (₹)</Label>
            <div className="flex gap-2">
              <Input
                id="sup-pay-amount"
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="font-mono"
                aria-invalid={!amountValid}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 px-3 text-xs"
                onClick={() => setAmount(String(balanceDue))}
              >
                Full balance
              </Button>
            </div>
            {!amountValid && amount !== "" && (
              <p className="text-xs text-destructive">
                Enter a positive amount up to the outstanding balance ({formatINR(balanceDue)}).
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Payment method</Label>
            <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-4 gap-1.5">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={method === m.value}
                  onClick={() => setMethod(m.value)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-medium transition-all",
                    method === m.value
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-border/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sup-pay-notes">Reference / remarks</Label>
            <Input
              id="sup-pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="UTR, cheque no., remarks…"
            />
          </div>

          {/* Live outcome preview */}
          {Number.isFinite(parsedAmount) && parsedAmount > 0 ? (
            <p
              className={cn(
                "rounded-lg px-3 py-2 text-xs",
                fullSettle
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"
              )}
            >
              {fullSettle
                ? `This settles ${bill?.poNumber} in full — ${formatINR(billed)} paid to the supplier.`
                : `After this payment: ${formatINR(afterPaid)} paid · ${formatINR(afterBalance)} still due (PARTIAL).`}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!amountValid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
            {fullSettle || amount === "" ? "Settle bill" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Void supplier payment dialog body ── */

function VoidSupplierPaymentDialog({
  target,
  onVoided,
  onClose,
}: {
  target: SupplierPayment | null;
  onVoided: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [voiding, setVoiding] = React.useState(false);

  React.useEffect(() => {
    if (target) {
      setReason("");
      setVoiding(false);
    }
  }, [target]);

  const confirmVoid = async () => {
    if (!target || reason.trim().length < 3) return;
    setVoiding(true);
    try {
      await api.voidSupplierPayment(target.supplierId, target.id, reason.trim());
      toast({
        title: `Payment #${target.id} voided`,
        description: `${formatINR(target.amount)} reversed — ${target.poNumber} balance recomputed.`,
      });
      onVoided();
    } catch (e) {
      toast({
        title: "Could not void payment",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setVoiding(false);
    }
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="font-display">Void payment #{target?.id}?</AlertDialogTitle>
        <AlertDialogDescription>
          This reverses a {target ? formatINR(target.amount) : ""}{" "}
          {target ? methodMeta(target.method).label : ""} payment on{" "}
          {target?.poNumber}. The row is kept for audit but excluded from paid
          totals; the bill reverts to its recomputed balance.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="sup-void-reason">Reason for voiding</Label>
        <Input
          id="sup-void-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. bank transfer failed — payment not made"
          autoFocus
          disabled={voiding}
          onKeyDown={(e) => {
            if (e.key === "Enter" && reason.trim().length >= 3 && !voiding) {
              e.preventDefault();
              void confirmVoid();
            }
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          Recorded on the voided payment — minimum 3 characters.
        </p>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={voiding}>Keep payment</AlertDialogCancel>
        <AlertDialogAction
          className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
          disabled={reason.trim().length < 3 || voiding}
          onClick={(e) => {
            e.preventDefault();
            void confirmVoid();
          }}
        >
          {voiding ? <Loader2 className="size-4 animate-spin" /> : <CircleOff className="size-4" />}
          Void payment
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

function StatBlock({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "amber" | "emerald";
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-secondary/40 px-2.5 py-2 text-center">
      <p
        className={cn(
          "font-mono tnum text-sm font-semibold leading-none",
          accent && "text-primary",
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
