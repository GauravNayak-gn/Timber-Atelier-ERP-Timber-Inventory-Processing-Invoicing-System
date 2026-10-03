"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ChevronDown,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  Scale,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { EmptyState, ErrorState, RefChip, SectionHeading, SkeletonGrid } from "@/components/timber/primitives";
import { AdjustStockDialog } from "@/components/timber/stock-adjust";
import { useApi } from "@/components/timber/hooks";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR, formatQty, parseNumber } from "@/lib/format";
import type { FinishedProduct, LedgerEntry, ProcessingBatch } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function ProductsView({ refreshSignal, onMutate }: { refreshSignal: number; onMutate: () => void }) {
  const { toast } = useToast();
  const products = useApi<FinishedProduct[]>("/api/products", [refreshSignal]);
  // Batch history powers the per-product production sparklines.
  const batches = useApi<ProcessingBatch[]>("/api/processing/batches", [refreshSignal]);
  const [addOpen, setAddOpen] = React.useState(false);

  const list = products.data ?? [];

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Finished Goods"
        sub={`${list.length} product${list.length === 1 ? "" : "s"} ready for sale`}
      >
        <Button onClick={() => setAddOpen(true)}>
          <PackagePlus className="size-4" /> Add Product
        </Button>
      </SectionHeading>

      {products.loading && !products.data ? (
        <SkeletonGrid count={6} />
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No finished products yet"
          hint="Products are created here and stocked by processing batch outputs."
          action={
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" /> Add Product
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              index={i}
              batches={batches.data}
              onChanged={onMutate}
            />
          ))}
        </div>
      )}

      <AddProductDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={() => {
          products.reload();
          onMutate();
        }}
        notify={toast}
      />
    </div>
  );
}

/** One production run for a product: batch ref + produced qty + run waste. */
interface ProductRun {
  batchNumber: string;
  date: string;
  qty: number;
  wastePct: number;
}

/** Waste severity palette shared with the dashboard Waste-by-Batch card. */
const wasteBarColor = (wastePct: number) =>
  wastePct <= 8 ? "bg-emerald-500" : wastePct <= 10 ? "bg-amber-500" : "bg-amber-600";

function ProductCard({
  product: p,
  index,
  batches,
  onChanged,
}: {
  product: FinishedProduct;
  index: number;
  batches: ProcessingBatch[] | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const low = p.currentStock <= p.reorderThreshold;
  const out = p.currentStock <= 0;
  const [adjustOpen, setAdjustOpen] = React.useState(false);
  const [showMovements, setShowMovements] = React.useState(false);

  // Production runs that produced this product (COMPLETED batches only).
  const runs = React.useMemo<ProductRun[]>(() => {
    if (!batches) return [];
    const list: ProductRun[] = [];
    for (const b of batches) {
      if (b.status !== "COMPLETED") continue;
      const qty = b.outputs
        .filter((o) => o.productId === p.id && o.outputType !== "WASTE")
        .reduce((s, o) => s + o.quantityProduced, 0);
      if (qty > 0) {
        list.push({ batchNumber: b.batchNumber, date: b.processingDate, qty, wastePct: b.wastePercentage });
      }
    }
    return list.slice(-6); // oldest → newest, last 6 runs
  }, [batches, p.id]);
  const maxRunQty = Math.max(1, ...runs.map((r) => r.qty));
  const totalProduced = runs.reduce((s, r) => s + r.qty, 0);

  // Lazy: only fetch movement history when expanded.
  const movements = useApi<{ entries: LedgerEntry[]; total: string | number }>(
    showMovements ? `/api/audit/ledger?itemType=FINISHED_PRODUCT&itemId=${p.id}&limit=10` : null
  );

  return (
    <Card
      className="group transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display truncate text-lg font-semibold leading-tight">{p.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="border-border bg-secondary/70 text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                {p.category}
              </Badge>
              <Badge
                variant="outline"
                className="border-border bg-secondary/70 font-mono text-[10px] tracking-wide text-muted-foreground"
              >
                {p.skuCode}
              </Badge>
            </div>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 border-primary/25 bg-primary/5 font-mono text-[10px] text-primary"
          >
            GST {p.taxRatePercent}%
          </Badge>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono tnum text-3xl font-semibold leading-none tracking-tight text-primary">
              {formatINR(p.sellingPrice)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">per {p.unit}</p>
          </div>
          <div className="text-right">
            <p className="font-mono tnum text-lg font-semibold leading-none">{formatQty(p.currentStock)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {p.unit} in stock{p.reorderThreshold > 0 ? ` · reorder @ ${formatQty(p.reorderThreshold)}` : ""}
            </p>
          </div>
        </div>

        {low && (
          <p
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs",
              out
                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"
            )}
          >
            <TriangleAlert className="size-3.5 shrink-0" />
            {out
              ? "Out of stock — process a batch to produce more"
              : `Low stock — only ${formatQty(p.currentStock)} ${p.unit} left`}
          </p>
        )}

        {/* Production yield sparkline — last runs that produced this product */}
        {runs.length > 0 ? (
          <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Production
              </p>
              <p className="font-mono tnum text-[10px] text-muted-foreground">
                {formatQty(totalProduced)} {p.unit} · {runs.length} run{runs.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="mt-2 flex h-9 items-end gap-1.5" aria-hidden="true">
              {runs.map((r, i) => (
                <motion.div
                  key={r.batchNumber}
                  className={cn("min-w-[8px] flex-1 rounded-t-sm", wasteBarColor(r.wastePct))}
                  initial={{ height: 2, opacity: 0.4 }}
                  animate={{ height: `${Math.max(12, (r.qty / maxRunQty) * 100)}%`, opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.4, ease: "easeOut" }}
                  title={`${r.batchNumber} · ${formatDate(r.date)} · ${formatQty(r.qty)} ${p.unit} produced · waste ${r.wastePct.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="truncate font-mono">{runs[runs.length - 1].batchNumber}</span>
              <span>last {formatDate(runs[runs.length - 1].date)}</span>
            </div>
          </div>
        ) : null}

        {/* Card actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 text-xs"
            onClick={() => setAdjustOpen(true)}
          >
            <Scale className="size-3.5" /> Adjust
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 flex-1 text-xs text-muted-foreground"
            aria-expanded={showMovements}
            aria-controls={`movements-${p.id}`}
            onClick={() => setShowMovements((v) => !v)}
          >
            <Activity className="size-3.5" /> Movements
            <ChevronDown className={cn("size-3 transition-transform", showMovements && "rotate-180")} />
          </Button>
        </div>

        {/* Movement history */}
        <AnimatePresence initial={false}>
          {showMovements && (
            <motion.div
              id={`movements-${p.id}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border/70 bg-secondary/30 p-3">
                {movements.loading && !movements.data ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">Loading movements…</p>
                ) : movements.error ? (
                  <p className="py-4 text-center text-xs text-destructive">{movements.error}</p>
                ) : (movements.data?.entries.length ?? 0) === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">No movements recorded yet.</p>
                ) : (
                  movements.data!.entries.map((e) => {
                    const moved = e.stockIn > 0 ? e.stockIn : e.stockOut;
                    const incoming = e.stockIn > 0;
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 rounded-md bg-background/70 px-2.5 py-1.5 text-[11px]"
                      >
                        <RefChip type={e.referenceType} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                          {e.referenceNumber}
                          {e.lotNumber ? ` · ${e.lotNumber}` : ""}
                        </span>
                        <span
                          className={cn(
                            "font-mono tnum font-semibold",
                            incoming ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                          )}
                        >
                          {incoming ? "+" : "−"}
                          {formatQty(moved)}
                        </span>
                        <span
                          className={cn(
                            "font-mono tnum w-14 text-right",
                            e.balanceAfter <= 0 ? "text-rose-600" : "text-muted-foreground"
                          )}
                        >
                          = {formatQty(e.balanceAfter)}
                        </span>
                      </div>
                    );
                  })
                )}
                {movements.data ? (
                  <p className="pt-1 text-center text-[10px] text-muted-foreground">
                    Latest {movements.data.entries.length} of {movements.data.total} movements · full trail in
                    Audit Ledger
                  </p>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {showMovements ? (
          <p className="text-center text-[10px] text-muted-foreground/70">
            Updated {formatDateTime(new Date())}
          </p>
        ) : null}
      </CardContent>

      <AdjustStockDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        itemType="FINISHED_PRODUCT"
        item={p}
        onDone={() => {
          onChanged();
          if (showMovements) movements.reload();
        }}
        notify={toast}
      />
    </Card>
  );
}

interface Notify {
  (opts: { title: string; description?: string; variant?: "destructive" | undefined }): void;
}

function AddProductDialog({
  open,
  onOpenChange,
  onDone,
  notify,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  notify: Notify;
}) {
  const [form, setForm] = React.useState({
    name: "",
    skuCode: "",
    category: "",
    unit: "CFT",
    sellingPrice: "",
    taxRatePercent: "18",
  });
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open)
      setForm({ name: "", skuCode: "", category: "", unit: "CFT", sellingPrice: "", taxRatePercent: "18" });
  }, [open]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const price = parseNumber(form.sellingPrice);
  const tax = parseNumber(form.taxRatePercent);
  const valid =
    form.name.trim() !== "" &&
    form.skuCode.trim() !== "" &&
    form.category.trim() !== "" &&
    form.unit.trim() !== "" &&
    Number.isFinite(price) &&
    price >= 0 &&
    Number.isFinite(tax) &&
    tax >= 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await api.createProduct({
        name: form.name.trim(),
        skuCode: form.skuCode.trim().toUpperCase(),
        category: form.category.trim(),
        unit: form.unit.trim(),
        sellingPrice: price,
        taxRatePercent: tax,
      });
      notify({ title: "Product added", description: `${form.name.trim()} is ready to receive batch output.` });
      onOpenChange(false);
      onDone();
    } catch (e) {
      notify({
        title: "Could not add product",
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
          <DialogTitle className="font-display">Add Finished Product</DialogTitle>
          <DialogDescription>Create a product master record for batch outputs and invoicing.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pr-name">Name</Label>
              <Input id="pr-name" value={form.name} onChange={set("name")} placeholder="Teak Beam" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pr-sku">SKU code</Label>
              <Input id="pr-sku" value={form.skuCode} onChange={set("skuCode")} placeholder="FP-TEAK-B-002" className="font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pr-cat">Category</Label>
              <Input id="pr-cat" value={form.category} onChange={set("category")} placeholder="Beam" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pr-unit">Unit</Label>
              <Input id="pr-unit" value={form.unit} onChange={set("unit")} placeholder="CFT" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pr-price">Selling price (₹)</Label>
              <Input id="pr-price" type="number" min="0" step="any" value={form.sellingPrice} onChange={set("sellingPrice")} placeholder="3500" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pr-tax">GST rate (%)</Label>
              <Input id="pr-tax" type="number" min="0" max="28" step="any" value={form.taxRatePercent} onChange={set("taxRatePercent")} placeholder="18" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
