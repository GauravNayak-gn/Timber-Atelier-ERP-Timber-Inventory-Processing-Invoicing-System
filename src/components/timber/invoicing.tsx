"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Ban,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileDown,
  Loader2,
  Plus,
  Printer,
  ReceiptText,
  Search,
  TriangleAlert,
  Trash2,
  UserPlus,
  X,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorState,
  PaidBadge,
  SectionHeading,
  SkeletonRows,
  StatusBadge,
} from "@/components/timber/primitives";
import { useApi, useCountUp } from "@/components/timber/hooks";
import { useAppAction } from "@/components/timber/actions";
import { InvoiceDetailDrawer } from "@/components/timber/invoice-drawer";
import { InvoicePrintDialog } from "@/components/timber/invoice-print";
import { api } from "@/lib/api-client";
import { exportInvoicesCsv } from "@/lib/ledger-export";
import { formatDate, formatCompactINR, formatINR, formatQty, parseNumber, todayISO } from "@/lib/format";
import type { Customer, FinishedProduct, Invoice, LedgerEntry, RecordPaymentRequest } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function InvoicingView({ refreshSignal, onMutate }: { refreshSignal: number; onMutate: () => void }) {
  // Controlled so the command palette can jump straight to the create form,
  // or deep-link into a specific invoice's quick-view drawer.
  const [tab, setTab] = React.useState<string>("create");
  const [deepLinkInvoice, setDeepLinkInvoice] = React.useState<string | null>(null);
  const onQuickAction = React.useCallback((action: { type: string; invoiceNumber?: string }) => {
    if (action.type === "new-invoice") setTab("create");
    if (action.type === "open-invoice" && action.invoiceNumber) {
      setTab("history");
      setDeepLinkInvoice(action.invoiceNumber);
    }
  }, []);
  useAppAction(onQuickAction);

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-5">
      <TabsList>
        <TabsTrigger value="create">Create Invoice</TabsTrigger>
        <TabsTrigger value="history">Invoice History</TabsTrigger>
      </TabsList>
      <TabsContent value="create">
        <CreateInvoicePanel refreshSignal={refreshSignal} onMutate={onMutate} />
      </TabsContent>
      <TabsContent value="history">
        <InvoiceHistoryPanel
          refreshSignal={refreshSignal}
          onMutate={onMutate}
          deepLinkInvoice={deepLinkInvoice}
          onDeepLinkHandled={() => setDeepLinkInvoice(null)}
        />
      </TabsContent>
    </Tabs>
  );
}

/* ══════════════════════════ Create ══════════════════════════ */

interface LineItem {
  key: number;
  productId: string;
  lotNumber: string;
  quantity: string;
}

let lineSeq = 1;
const nextLineKey = () => lineSeq++;
const blankLine = (): LineItem => ({ key: nextLineKey(), productId: "", lotNumber: "", quantity: "" });

function CreateInvoicePanel({ refreshSignal, onMutate }: { refreshSignal: number; onMutate: () => void }) {
  const { toast } = useToast();
  const customers = useApi<Customer[]>("/api/customers", [refreshSignal]);
  const products = useApi<FinishedProduct[]>("/api/products", [refreshSignal]);
  // Finished-goods ledger for lot suggestions (fails silently if unavailable).
  const finLedger = useApi<{ entries: LedgerEntry[]; total: number }>(
    "/api/audit/ledger?itemType=FINISHED_PRODUCT&limit=200"
  );

  const [customerId, setCustomerId] = React.useState("");
  const [invoiceDate, setInvoiceDate] = React.useState(todayISO());
  const [lines, setLines] = React.useState<LineItem[]>([blankLine()]);
  const [submitting, setSubmitting] = React.useState(false);
  const [newCustomerOpen, setNewCustomerOpen] = React.useState(false);

  const productList = products.data ?? [];
  const customerList = customers.data ?? [];

  const knownLotsByProduct = React.useMemo(() => {
    const map = new Map<number, string[]>();
    for (const entry of finLedger.data?.entries ?? []) {
      const list = map.get(entry.itemId) ?? [];
      if (entry.lotNumber && !list.includes(entry.lotNumber)) list.push(entry.lotNumber);
      map.set(entry.itemId, list);
    }
    return map;
  }, [finLedger.data]);

  const allKnownFinLots = React.useMemo(
    () => Array.from(new Set((finLedger.data?.entries ?? []).map((e) => e.lotNumber).filter(Boolean))),
    [finLedger.data]
  );

  const computed = lines.map((l) => {
    const product = productList.find((p) => String(p.id) === l.productId) ?? null;
    const qty = parseNumber(l.quantity);
    const subtotal = product && Number.isFinite(qty) && qty > 0 ? product.sellingPrice * qty : 0;
    const tax = product ? (subtotal * product.taxRatePercent) / 100 : 0;
    const exceeds = product != null && Number.isFinite(qty) && qty > product.currentStock;
    return { line: l, product, qty, subtotal, tax, total: subtotal + tax, exceeds };
  });

  const subtotal = computed.reduce((s, c) => s + c.subtotal, 0);
  const taxTotal = computed.reduce((s, c) => s + c.tax, 0);
  const grandTotal = subtotal + taxTotal;
  const anyExceeds = computed.some((c) => c.exceeds);
  const linesValid =
    computed.length > 0 &&
    computed.every((c) => c.product && Number.isFinite(c.qty) && c.qty > 0 && c.line.lotNumber.trim() && !c.exceeds);
  const canSubmit = customerId !== "" && linesValid && !anyExceeds && !submitting;

  const patchLine = (key: number, patch: Partial<LineItem>) =>
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const onLineProductChange = (key: number, value: string) => {
    const product = productList.find((p) => String(p.id) === value);
    setLines((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        const known = product ? knownLotsByProduct.get(product.id) ?? [] : [];
        const suggestion = known.length > 0 ? known[known.length - 1] : "";
        const auto = !r.lotNumber || /^LOT-FIN-\w+-\d+$/.test(r.lotNumber);
        return { ...r, productId: value, lotNumber: auto ? suggestion : r.lotNumber };
      })
    );
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await api.createInvoice({
        customerId: Number(customerId),
        invoiceDate: invoiceDate || undefined,
        items: computed.map((c) => ({
          productId: Number(c.line.productId),
          lotNumber: c.line.lotNumber.trim(),
          quantity: c.qty,
        })),
      });
      toast({
        title: `Invoice ${res?.invoiceNumber ?? "confirmed"}`,
        description: `${formatINR(res?.grandTotal ?? grandTotal)} confirmed — stock deducted from sold lots.`,
      });
      setLines([blankLine()]);
      products.reload();
      onMutate();
    } catch (e) {
      toast({
        title: "Could not create invoice",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">New Invoice</CardTitle>
          <CardDescription>Sell finished goods from specific lots — GST 18% split as CGST 9% + SGST 9%.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="inv-customer">Customer</Label>
                <button
                  type="button"
                  onClick={() => setNewCustomerOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <UserPlus className="size-3.5" /> New customer
                </button>
              </div>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="inv-customer" aria-label="Customer">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customerList.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.companyName}
                      {c.gstNumber ? ` · ${c.gstNumber}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inv-date">Invoice date</Label>
              <Input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
          </div>

          {/* Line items */}
          <section className="space-y-3" aria-label="Invoice line items">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Line items</h3>
              <Button variant="outline" size="sm" onClick={() => setLines((r) => [...r, blankLine()])}>
                <Plus className="size-3.5" /> Add item
              </Button>
            </div>
            <datalist id="fin-lot-suggestions">
              {allKnownFinLots.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>

            <div className="space-y-4">
              {computed.map(({ line, product, qty, subtotal: lineSub, tax, total, exceeds }, idx) => (
                <div key={line.key} className="rounded-lg border border-border/70 p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,150px)_92px_auto] items-start gap-2">
                    <Select value={line.productId} onValueChange={(v) => onLineProductChange(line.key, v)}>
                      <SelectTrigger aria-label={`Product for line ${idx + 1}`}>
                        <SelectValue placeholder="Select product" />
                      </SelectTrigger>
                      <SelectContent>
                        {productList.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name} · {formatINR(p.sellingPrice)}/{p.unit} · {formatQty(p.currentStock)} in stock
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      list="fin-lot-suggestions"
                      value={line.lotNumber}
                      onChange={(e) => patchLine(line.key, { lotNumber: e.target.value })}
                      placeholder="LOT-FIN-…"
                      className="font-mono"
                      aria-label={`Lot number for line ${idx + 1}`}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => patchLine(line.key, { quantity: e.target.value })}
                      placeholder="Qty"
                      aria-label={`Quantity for line ${idx + 1}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove line ${idx + 1}`}
                      onClick={() => setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== line.key) : [blankLine()]))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {exceeds ? (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
                      >
                        <TriangleAlert className="size-3" />
                        Exceeds available stock (max {formatQty(product?.currentStock ?? 0)} {product?.unit ?? "CFT"})
                      </Badge>
                    ) : product && Number.isFinite(qty) && qty > 0 ? (
                      <>
                        <span className="font-mono tnum text-muted-foreground">
                          {formatQty(qty)} × {formatINR(product.sellingPrice)}
                        </span>
                        <span className="font-mono tnum text-muted-foreground">GST {product.taxRatePercent}%</span>
                        <span className="font-mono tnum ml-auto font-semibold">{formatINR(total)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {product ? `Available: ${formatQty(product.currentStock)} ${product.unit}` : "Select a product"}
                      </span>
                    )}
                  </div>

                  {product && Number.isFinite(qty) && qty > 0 && !exceeds && (
                    <p className="mt-1 font-mono tnum text-[11px] text-muted-foreground">
                      Line: {formatINR(lineSub)} + tax {formatINR(tax)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="self-start xl:sticky xl:top-20">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="font-display text-base">Summary</CardTitle>
            <CardDescription>Live invoice totals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono tnum">{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>CGST 9%</span>
              <span className="font-mono tnum">{formatINR(taxTotal / 2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>SGST 9%</span>
              <span className="font-mono tnum">{formatINR(taxTotal / 2)}</span>
            </div>
            <div className="border-t border-border/70 pt-3">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Grand Total</span>
                <AnimatedGrandTotal value={grandTotal} />
              </div>
            </div>
            {anyExceeds && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
                One or more lines exceed available stock — adjust quantities to confirm the invoice.
              </p>
            )}
            <Button onClick={() => void submit()} disabled={!canSubmit} className="w-full">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ReceiptText className="size-4" />}
              {submitting ? "Confirming…" : "Confirm invoice"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <NewCustomerDialog
        open={newCustomerOpen}
        onOpenChange={setNewCustomerOpen}
        onCreated={(c) => {
          customers.reload();
          setCustomerId(String(c.id));
        }}
        notify={toast}
      />
    </div>
  );
}

function AnimatedGrandTotal({ value }: { value: number }) {
  const animated = useCountUp(value);
  return (
    <span className="font-mono tnum text-2xl font-semibold tracking-tight text-primary">
      {formatINR(animated)}
    </span>
  );
}

/* ══════════════════════════ History ══════════════════════════ */

function InvoiceHistoryPanel({
  refreshSignal,
  onMutate,
  deepLinkInvoice,
  onDeepLinkHandled,
}: {
  refreshSignal: number;
  onMutate: () => void;
  /** Command-palette deep-link — invoice number to auto-open once loaded. */
  deepLinkInvoice?: string | null;
  onDeepLinkHandled?: () => void;
}) {
  const { toast } = useToast();
  const invoices = useApi<Invoice[]>("/api/invoices", [refreshSignal]);

  const [printTarget, setPrintTarget] = React.useState<Invoice | null>(null);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [autoPrint, setAutoPrint] = React.useState(false);
  const [detailTarget, setDetailTarget] = React.useState<Invoice | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [cancelTarget, setCancelTarget] = React.useState<Invoice | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);
  const [payFilter, setPayFilter] = React.useState<"all" | "due" | "paid">("all");
  const [payTarget, setPayTarget] = React.useState<Invoice | null>(null);
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 8;

  const all = invoices.data ?? [];
  const dueCount = all.filter((i) => i.status === "CONFIRMED" && !i.paidAt).length;
  const paidCount = all.filter((i) => i.paidAt).length;
  const filtered = all.filter((inv) => {
    if (payFilter === "due") return inv.status === "CONFIRMED" && !inv.paidAt;
    if (payFilter === "paid") return Boolean(inv.paidAt);
    return true;
  });
  const q = search.trim().toLowerCase();
  const list = q
    ? filtered.filter(
        (inv) =>
          inv.invoiceNumber.toLowerCase().includes(q) ||
          (inv.customerName ?? "").toLowerCase().includes(q) ||
          inv.items.some((it) => it.lotNumber.toLowerCase().includes(q))
      )
    : filtered;

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const filterKey = `${payFilter}|${q}`;
  React.useEffect(() => {
    setPage(1);
  }, [filterKey]);

  // Live money totals for the visible filter — partial-payment aware.
  const confirmed = all.filter((i) => i.status === "CONFIRMED");
  const billedTotal = confirmed.reduce((s, i) => s + i.grandTotal, 0);
  const receivedTotal = confirmed.reduce((s, i) => s + (i.paidAmount ?? 0), 0);
  const outstandingTotal = Math.max(0, billedTotal - receivedTotal);

  const markPaid = async (inv: Invoice, body?: RecordPaymentRequest) => {
    try {
      const updated = await api.markInvoicePaid(inv.id, body);
      const paidAmt = updated.paidAmount ?? 0;
      const balance = Math.max(0, updated.grandTotal - paidAmt);
      toast({
        title: updated.paidAt
          ? `Invoice ${inv.invoiceNumber} fully settled`
          : `Payment recorded — ${inv.invoiceNumber} partially paid`,
        description: updated.paidAt
          ? `${formatINR(updated.grandTotal)} collected — receivables updated.`
          : `${formatINR(paidAmt)} of ${formatINR(updated.grandTotal)} paid · ${formatINR(balance)} still due.`,
      });
      setPayTarget(null);
      invoices.reload();
      onMutate();
    } catch (e) {
      toast({
        title: "Could not record payment",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const openPrint = (inv: Invoice, auto: boolean) => {
    setPrintTarget(inv);
    setAutoPrint(auto);
    setPrintOpen(true);
  };

  const openDetail = (inv: Invoice) => {
    setDetailTarget(inv);
    setDetailOpen(true);
  };

  const closeDetail = () => setDetailOpen(false);

  // Command-palette deep-link: auto-open the requested invoice's drawer.
  React.useEffect(() => {
    if (!deepLinkInvoice || !invoices.data) return;
    const target = invoices.data.find(
      (i) => i.invoiceNumber.toLowerCase() === deepLinkInvoice.toLowerCase()
    );
    if (target) {
      setDetailTarget(target);
      setDetailOpen(true);
    } else {
      toast({
        title: "Invoice not found",
        description: `No invoice matches “${deepLinkInvoice}”.`,
        variant: "destructive",
      });
    }
    onDeepLinkHandled?.();
  }, [deepLinkInvoice, invoices.data, toast, onDeepLinkHandled]);

  const confirmCancel = async () => {
    if (!cancelTarget || cancelReason.trim().length < 3) return;
    setCancelling(true);
    try {
      await api.cancelInvoice(cancelTarget.id, cancelReason.trim());
      toast({
        title: `Invoice ${cancelTarget.invoiceNumber} cancelled`,
        description: "Stock has been restored to inventory and the ledger records the reversal.",
      });
      setCancelTarget(null);
      setCancelReason("");
      invoices.reload();
      onMutate();
    } catch (e) {
      toast({
        title: "Could not cancel invoice",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading title="Invoice History" sub="All customer invoices with payment status and lineage">
        <Button
          variant="outline"
          size="sm"
          disabled={list.length === 0}
          onClick={() => {
            exportInvoicesCsv(list)
              .then((n) =>
                toast({
                  title: "Invoices exported",
                  description: `${n} invoice${n === 1 ? "" : "s"} downloaded as CSV.`,
                })
              )
              .catch((e) =>
                toast({
                  title: "Export failed",
                  description: e instanceof Error ? e.message : "Unexpected error",
                  variant: "destructive",
                })
              );
          }}
        >
          <FileDown className="size-4" /> Export CSV
        </Button>
      </SectionHeading>

      {invoices.loading && !invoices.data ? (
        <SkeletonRows rows={5} />
      ) : invoices.error ? (
        <ErrorState message={invoices.error} onRetry={invoices.reload} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No invoices yet"
          hint="Create your first invoice from the Create Invoice tab."
        />
      ) : (
        <div className="space-y-3">
          {/* Payment status filter + search */}
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Filter invoices by payment status"
              className="inline-flex rounded-lg border border-border/80 bg-secondary/50 p-0.5"
            >
              {([
                { key: "all", label: "All", count: all.length },
                { key: "due", label: "Due", count: dueCount },
                { key: "paid", label: "Paid", count: paidCount },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPayFilter(opt.key)}
                  aria-pressed={payFilter === opt.key}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    payFilter === opt.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                  <span
                    className={cn(
                      "font-mono tnum rounded-full px-1.5 text-[10px]",
                      opt.key === "due" && payFilter !== "due" && opt.count > 0
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        : opt.count > 0
                          ? "bg-secondary text-muted-foreground"
                          : "text-muted-foreground/50"
                    )}
                  >
                    {opt.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search invoice, customer, lot…"
                aria-label="Search invoice history"
                className="h-9 bg-background pl-8 pr-8 text-sm"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Live money strip — billed vs received vs outstanding (partial-payment aware) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border/70 bg-secondary/40 px-4 py-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              Billed
              <span className="font-mono tnum font-semibold text-foreground">{formatINR(billedTotal)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500/70" aria-hidden />
              Received
              <span className="font-mono tnum font-semibold text-emerald-700 dark:text-emerald-400">
                {formatINR(receivedTotal)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", outstandingTotal > 0 ? "bg-amber-500" : "bg-emerald-500")} aria-hidden />
              Outstanding
              <span
                className={cn(
                  "font-mono tnum font-semibold",
                  outstandingTotal > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
                )}
              >
                {formatINR(outstandingTotal)}
              </span>
            </span>
            <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 sm:inline">
              {confirmed.length} confirmed
            </span>
          </div>

          <Card className="overflow-hidden py-0">
          <div className="tbl-scroll">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      {q ? (
                        <span>
                          No invoices match “<span className="font-medium text-foreground">{search.trim()}</span>” in this view.
                        </span>
                      ) : (
                        <>No {payFilter === "due" ? "outstanding" : payFilter === "paid" ? "settled" : ""} invoices in this view.</>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                pageRows.map((inv, i) => (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-5">
                      <motion.span
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03, duration: 0.25 }}
                      >
                        <button
                          type="button"
                          onClick={() => openDetail(inv)}
                          aria-label={`Open details for ${inv.invoiceNumber}`}
                          className="font-mono text-sm font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                        >
                          {inv.invoiceNumber}
                        </button>
                      </motion.span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(inv.invoiceDate)}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={inv.customerName ?? undefined}>
                      {inv.customerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono tnum font-semibold">{formatINR(inv.grandTotal)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={inv.status} />
                        <PaidBadge
                          paidAt={inv.paidAt}
                          status={inv.status}
                          paidAmount={inv.paidAmount}
                          grandTotal={inv.grandTotal}
                        />
                        {inv.status === "CONFIRMED" && !inv.paidAt && (
                          <PaymentBar
                            paidAmount={inv.paidAmount ?? 0}
                            grandTotal={inv.grandTotal}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`View invoice ${inv.invoiceNumber}`}
                          onClick={() => openDetail(inv)}
                        >
                          <Eye className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Download PDF of ${inv.invoiceNumber}`}
                          onClick={() => openPrint(inv, true)}
                        >
                          <Printer className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={
                            inv.paidAt
                              ? `${inv.invoiceNumber} is already paid`
                              : inv.paidAmount && inv.paidAmount > 0
                                ? `Record another payment for ${inv.invoiceNumber}`
                                : `Record payment for ${inv.invoiceNumber}`
                          }
                          title={
                            inv.status === "CANCELLED"
                              ? "Cancelled invoices cannot be settled"
                              : inv.paidAt
                                ? "Already paid"
                                : "Record payment"
                          }
                          disabled={inv.status === "CANCELLED" || Boolean(inv.paidAt)}
                          onClick={() => setPayTarget(inv)}
                          className="text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400"
                        >
                          <Banknote className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Cancel invoice ${inv.invoiceNumber}`}
                          disabled={inv.status === "CANCELLED"}
                          onClick={() => {
                            setCancelTarget(inv);
                            setCancelReason("");
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Ban className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-5 py-3">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-mono tnum text-foreground">{list.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}</span>
              {"–"}
              <span className="font-mono tnum text-foreground">{Math.min(safePage * PAGE_SIZE, list.length)}</span> of{" "}
              <span className="font-mono tnum text-foreground">{list.length}</span> invoice{list.length === 1 ? "" : "s"}
              {q ? <span> (filtered)</span> : null}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-3.5" /> Prev
              </Button>
              <span className="px-1.5 font-mono text-xs text-muted-foreground">
                {safePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                Next <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </Card>
        </div>
      )}

      <InvoicePrintDialog
        invoice={printTarget}
        open={printOpen}
        onOpenChange={setPrintOpen}
        autoPrint={autoPrint}
      />

      <InvoiceDetailDrawer
        invoice={detailTarget}
        open={detailOpen}
        onOpenChange={(o) => (o ? setDetailOpen(true) : closeDetail())}
        onPrint={(inv) => {
          closeDetail();
          openPrint(inv, false);
        }}
        onRecordPayment={(inv) => {
          closeDetail();
          setPayTarget(inv);
        }}
        onCancel={(inv) => {
          closeDetail();
          setCancelTarget(inv);
          setCancelReason("");
        }}
        onVoided={invoices.reload}
      />

      <RecordPaymentDialog
        invoice={payTarget}
        onClose={() => setPayTarget(null)}
        onSubmit={(body) => (payTarget ? markPaid(payTarget, body) : Promise.resolve())}
      />

      {/* Cancel confirmation */}
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => {
          if (!o) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invoice {cancelTarget?.invoiceNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling reverses the sale: stock returns to inventory and the audit ledger records an
              INVOICE_CANCELLATION entry. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-reason">Reason (min 3 characters)</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Customer returned the goods — wrong dimensions"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep invoice</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmCancel();
              }}
              disabled={cancelReason.trim().length < 3 || cancelling}
              className={cn("bg-destructive text-white hover:bg-destructive/90")}
            >
              {cancelling ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancel invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ══════════════════════════ Record payment ══════════════════════════ */

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CHEQUE", label: "Cheque" },
] as const;

/** Slim paid-vs-total progress bar shown under the payment badge. */
function PaymentBar({ paidAmount, grandTotal }: { paidAmount: number; grandTotal: number }) {
  const pct = grandTotal > 0 ? Math.max(0, Math.min(100, (paidAmount / grandTotal) * 100)) : 0;
  return (
    <div className="w-28" title={`${formatINR(paidAmount)} of ${formatINR(grandTotal)} received`}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <motion.div
          className={cn("h-full rounded-full", pct >= 99.9 ? "bg-emerald-500" : "bg-amber-500")}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      {paidAmount > 0 && (
        <p className="font-mono tnum mt-0.5 text-[10px] text-muted-foreground">
          {formatCompactINR(paidAmount)} recd
        </p>
      )}
    </div>
  );
}

function RecordPaymentDialog({
  invoice,
  onClose,
  onSubmit,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  onSubmit: (body?: RecordPaymentRequest) => Promise<void>;
}) {
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<string>("BANK_TRANSFER");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const open = invoice !== null;
  const grandTotal = invoice?.grandTotal ?? 0;
  const alreadyPaid = invoice?.paidAmount ?? 0;
  const balanceDue = Math.max(0, grandTotal - alreadyPaid);

  React.useEffect(() => {
    if (open) {
      setAmount(balanceDue ? String(balanceDue) : "");
      setMethod("BANK_TRANSFER");
      setNotes("");
      setSubmitting(false);
    }
  }, [open, invoice?.id, balanceDue]);

  const parsedAmount = parseNumber(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= balanceDue + 0.005;
  const fullSettle = Number.isFinite(parsedAmount) && Math.abs(parsedAmount - balanceDue) <= 0.005;
  const afterPaid = alreadyPaid + (Number.isFinite(parsedAmount) ? parsedAmount : 0);
  const afterBalance = Math.max(0, grandTotal - afterPaid);

  const submit = async () => {
    if (!invoice || !amountValid || submitting) return;
    setSubmitting(true);
    const body: RecordPaymentRequest = {
      ...(Math.abs(parsedAmount - balanceDue) <= 0.005 ? {} : { amount: parsedAmount }),
      ...(method ? { method: method as RecordPaymentRequest["method"] } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    try {
      await onSubmit(body);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Record Payment</DialogTitle>
          <DialogDescription>
            {invoice
              ? `${invoice.invoiceNumber} · ${invoice.customerName ?? "Customer"} · ${formatDate(invoice.invoiceDate)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Ledger strip */}
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/70 bg-secondary/30 p-3 text-center">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Total</p>
              <p className="font-mono tnum text-sm font-semibold">{formatINR(grandTotal)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Received</p>
              <p className="font-mono tnum text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {formatINR(alreadyPaid)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Balance</p>
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
                    width: `${grandTotal > 0 ? Math.min(100, (afterPaid / grandTotal) * 100) : 0}%`,
                  }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pay-amount">Amount (₹)</Label>
            <div className="flex gap-2">
              <Input
                id="pay-amount"
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
            <div
              role="radiogroup"
              aria-label="Payment method"
              className="grid grid-cols-4 gap-1.5"
            >
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
            <Label htmlFor="pay-notes">Reference / remarks</Label>
            <Input
              id="pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="UTR, cheque no., remarks…"
            />
          </div>

          {/* Live outcome preview */}
          {Number.isFinite(parsedAmount) && parsedAmount > 0 && (
            <p
              className={cn(
                "rounded-lg px-3 py-2 text-xs",
                fullSettle
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"
              )}
            >
              {fullSettle
                ? `This settles the invoice in full — ${formatINR(grandTotal)} received, badge flips to PAID.`
                : `After this payment: ${formatINR(afterPaid)} received · ${formatINR(afterBalance)} still due (PARTIAL).`}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!amountValid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
            {fullSettle || amount === "" ? "Settle invoice" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════ New customer ══════════════════════════ */

function NewCustomerDialog({
  open,
  onOpenChange,
  onCreated,
  notify,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (customer: Customer) => void;
  notify: { (opts: { title: string; description?: string; variant?: "destructive" }): void };
}) {
  const [form, setForm] = React.useState({
    companyName: "",
    contactPerson: "",
    phone: "",
    email: "",
    gstNumber: "",
    billingAddress: "",
    shippingAddress: "",
  });
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open)
      setForm({
        companyName: "",
        contactPerson: "",
        phone: "",
        email: "",
        gstNumber: "",
        billingAddress: "",
        shippingAddress: "",
      });
  }, [open]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const valid = form.companyName.trim() !== "";

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const created = await api.createCustomer({
        companyName: form.companyName.trim(),
        contactPerson: form.contactPerson.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        gstNumber: form.gstNumber.trim().toUpperCase() || undefined,
        billingAddress: form.billingAddress.trim() || undefined,
        shippingAddress: form.shippingAddress.trim() || undefined,
      });
      notify({ title: "Customer added", description: created.companyName });
      onOpenChange(false);
      onCreated(created);
    } catch (e) {
      notify({
        title: "Could not add customer",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">New Customer</DialogTitle>
          <DialogDescription>Add a customer with GST details for invoicing.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="c-company">Company name *</Label>
              <Input id="c-company" value={form.companyName} onChange={set("companyName")} placeholder="ABC Furniture Pvt Ltd" />
            </div>
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="c-gst">GST number</Label>
              <Input id="c-gst" value={form.gstNumber} onChange={set("gstNumber")} placeholder="27AABCA1234A1Z5" className="font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="c-contact">Contact person</Label>
              <Input id="c-contact" value={form.contactPerson} onChange={set("contactPerson")} placeholder="Priya Sharma" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={form.phone} onChange={set("phone")} placeholder="+91 98111 22334" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" value={form.email} onChange={set("email")} placeholder="procurement@company.in" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-billing">Billing address</Label>
            <Input id="c-billing" value={form.billingAddress} onChange={set("billingAddress")} placeholder="402, Business Bay, Pune" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-shipping">Shipping address</Label>
            <Input id="c-shipping" value={form.shippingAddress} onChange={set("shippingAddress")} placeholder="Warehouse 7, Chakan MIDC" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
