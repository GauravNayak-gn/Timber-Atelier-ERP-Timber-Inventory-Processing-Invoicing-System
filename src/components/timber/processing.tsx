"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  ChevronDown,
  Factory,
  FileText,
  Layers,
  Loader2,
  PackageCheck,
  Plus,
  Recycle,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorState,
  OutputTypeBadge,
  SkeletonRows,
  StatusBadge,
} from "@/components/timber/primitives";
import { useApi } from "@/components/timber/hooks";
import { useAppAction } from "@/components/timber/actions";
import { BatchReportDialog } from "@/components/timber/batch-report";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime, formatQty, parseNumber, todayISO } from "@/lib/format";
import type {
  FinishedProduct,
  LedgerEntry,
  ProcessingBatch,
  RawMaterial,
} from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface InputRow {
  key: number;
  rawMaterialId: string;
  lotNumber: string;
  quantity: string;
}

interface OutputRow {
  key: number;
  outputType: "FINISHED" | "SECONDARY" | "WASTE";
  productId: string;
  lotNumber: string;
  quantity: string;
}

let rowSeq = 1;
const nextKey = () => rowSeq++;

const blankInput = (): InputRow => ({ key: nextKey(), rawMaterialId: "", lotNumber: "", quantity: "" });
const blankOutput = (): OutputRow => ({
  key: nextKey(),
  outputType: "FINISHED",
  productId: "",
  lotNumber: "",
  quantity: "",
});

export function ProcessingView({ refreshSignal, onMutate }: { refreshSignal: number; onMutate: () => void }) {
  const { toast } = useToast();

  const batches = useApi<ProcessingBatch[]>("/api/processing/batches", [refreshSignal]);
  const materials = useApi<RawMaterial[]>("/api/materials", [refreshSignal]);
  const products = useApi<FinishedProduct[]>("/api/products", [refreshSignal]);
  // Optional helper fetch: known raw lots for suggestions (fails silently).
  const rawLedger = useApi<{ entries: LedgerEntry[]; total: number }>(
    "/api/audit/ledger?itemType=RAW_MATERIAL&limit=200"
  );

  // Command-palette deep-link: open a batch report once the list has loaded.
  const [pendingBatch, setPendingBatch] = React.useState<string | null>(null);
  const onQuickAction = React.useCallback((action: { type: string; batchNumber?: string }) => {
    if (action.type === "open-batch" && action.batchNumber) setPendingBatch(action.batchNumber);
  }, []);
  useAppAction(onQuickAction);

  const [processingDate, setProcessingDate] = React.useState(todayISO());
  const [notes, setNotes] = React.useState("");
  const [inputs, setInputs] = React.useState<InputRow[]>([blankInput()]);
  const [outputs, setOutputs] = React.useState<OutputRow[]>([blankOutput()]);
  // Rows only complain after the user has actually touched them — a pristine
  // form must not greet the user with "Quantity must be greater than 0".
  const [touchedRows, setTouchedRows] = React.useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  const [reportTarget, setReportTarget] = React.useState<ProcessingBatch | null>(null);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [autoPrintReport, setAutoPrintReport] = React.useState(false);
  const [cancelTarget, setCancelTarget] = React.useState<ProcessingBatch | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);

  // When the pending deep-link batch appears in the fetched list, open its report.
  React.useEffect(() => {
    if (!pendingBatch || !batches.data) return;
    const target = batches.data.find(
      (b) => b.batchNumber.toLowerCase() === pendingBatch.toLowerCase()
    );
    if (target) {
      setReportTarget(target);
      setReportOpen(true);
    } else {
      toast({
        title: "Batch not found",
        description: `No batch matches “${pendingBatch}”.`,
        variant: "destructive",
      });
    }
    setPendingBatch(null);
  }, [pendingBatch, batches.data, toast]);

  const materialList = materials.data ?? [];
  const productList = products.data ?? [];

  const knownLotsByMaterial = React.useMemo(() => {
    const map = new Map<number, string[]>();
    for (const entry of rawLedger.data?.entries ?? []) {
      const list = map.get(entry.itemId) ?? [];
      if (entry.lotNumber && !list.includes(entry.lotNumber)) list.push(entry.lotNumber);
      map.set(entry.itemId, list);
    }
    return map;
  }, [rawLedger.data]);
  const allKnownRawLots = React.useMemo(
    () => Array.from(new Set((rawLedger.data?.entries ?? []).map((e) => e.lotNumber).filter(Boolean))),
    [rawLedger.data]
  );

  const stockOf = React.useCallback(
    (id: string) => materialList.find((m) => String(m.id) === id)?.currentStock ?? 0,
    [materialList]
  );

  /* ── Derived totals ── */
  const inputRows = inputs.map((r) => ({ row: r, qty: parseNumber(r.quantity) }));
  const outputRows = outputs.map((r) => ({ row: r, qty: parseNumber(r.quantity) }));

  const totalInput = inputRows.reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0), 0);
  const goodOutputTotal = outputRows.reduce(
    (s, r) => s + (r.row.outputType !== "WASTE" && Number.isFinite(r.qty) ? r.qty : 0),
    0
  );
  const wasteCft = Math.max(0, totalInput - goodOutputTotal);
  const wastePct = totalInput > 0 ? (wasteCft / totalInput) * 100 : 0;

  /* ── Validation ── */
  const inputErrors = inputRows.map(({ row, qty }) => {
    if (!row.rawMaterialId) return "Select a material";
    if (!row.lotNumber.trim()) return "Lot number is required";
    if (!Number.isFinite(qty) || qty <= 0) return "Quantity must be greater than 0";
    const stock = stockOf(row.rawMaterialId);
    if (qty > stock) return `Exceeds available (${formatQty(stock)} CFT)`;
    return null;
  });

  const outputErrors = outputRows.map(({ row, qty }) => {
    if (!Number.isFinite(qty) || qty <= 0) return "Quantity must be greater than 0";
    if (row.outputType !== "WASTE") {
      if (!row.productId) return "Select a product";
      if (!row.lotNumber.trim()) return "Lot number is required";
    }
    return null;
  });

  const hasGoodOutput = outputs.some(
    (o) => o.outputType !== "WASTE" && o.productId && o.lotNumber.trim() && parseNumber(o.quantity) > 0
  );
  const allValid =
    inputs.length > 0 &&
    outputs.length > 0 &&
    inputErrors.every((e) => e === null) &&
    outputErrors.every((e) => e === null) &&
    hasGoodOutput;

  /* ── Row mutation helpers ── */
  const markTouched = (key: number) =>
    setTouchedRows((t) => (t.has(key) ? t : new Set(t).add(key)));
  const patchInput = (key: number, patch: Partial<InputRow>) => {
    markTouched(key);
    setInputs((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const patchOutput = (key: number, patch: Partial<OutputRow>) => {
    markTouched(key);
    setOutputs((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const onInputMaterialChange = (key: number, value: string) => {
    const mat = materialList.find((m) => String(m.id) === value);
    const known = mat ? knownLotsByMaterial.get(mat.id) ?? [] : [];
    patchInput(key, {
      rawMaterialId: value,
      lotNumber: known.length === 1 ? known[0] : "",
    });
  };

  const onOutputTypeChange = (key: number, value: OutputRow["outputType"]) => {
    if (value === "WASTE") {
      setOutputs((rows) =>
        rows.map((r) => {
          if (r.key !== key) return r;
          const n = rows.filter((x) => x.outputType === "WASTE").length + 1;
          return { ...r, outputType: value, productId: "", lotNumber: r.lotNumber || `WASTE-OUT-${String(n).padStart(2, "0")}` };
        })
      );
      return;
    }
    setOutputs((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        if (r.outputType === "WASTE" && r.lotNumber.startsWith("WASTE-OUT-")) {
          return { ...r, outputType: value, lotNumber: "" };
        }
        return { ...r, outputType: value };
      })
    );
  };

  const onOutputProductChange = (key: number, value: string) => {
    const product = productList.find((p) => String(p.id) === value);
    setOutputs((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        const seg = product ? product.skuCode.split("-")[1] ?? "FIN" : "FIN";
        const n = rows.filter((x) => x.outputType !== "WASTE" && x.productId === value).length + 1;
        const suggestion = `LOT-FIN-${seg}-${String(n).padStart(3, "0")}`;
        const keepEmpty = !r.lotNumber || r.lotNumber.startsWith("WASTE-OUT-") || /^LOT-FIN-\w+-\d+$/.test(r.lotNumber);
        return { ...r, productId: value, lotNumber: keepEmpty ? suggestion : r.lotNumber };
      })
    );
  };

  /* ── Submit ── */
  const submit = async () => {
    if (!allValid || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.createBatch({
        processingDate: processingDate || undefined,
        notes: notes.trim() || undefined,
        inputs: inputRows.map(({ row, qty }) => ({
          rawMaterialId: Number(row.rawMaterialId),
          lotNumber: row.lotNumber.trim(),
          quantity: qty,
        })),
        outputs: outputRows.map(({ row, qty }) => ({
          productId: row.outputType === "WASTE" ? null : Number(row.productId),
          lotNumber: row.lotNumber.trim(),
          outputType: row.outputType,
          quantity: qty,
        })),
      });
      toast({
        title: `Batch ${res?.batchNumber ?? "created"} completed`,
        description: `Input ${formatQty(totalInput)} · Output ${formatQty(goodOutputTotal)} · Waste ${wastePct.toFixed(1)}%`,
      });
      setInputs([blankInput()]);
      setOutputs([blankOutput()]);
      setNotes("");
      setTouchedRows(new Set());
      batches.reload();
      onMutate();
    } catch (e) {
      toast({
        title: "Could not create batch",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* ── Batch cancellation (full stock reversal) ── */
  const confirmCancelBatch = async () => {
    if (!cancelTarget || cancelReason.trim().length < 3) return;
    setCancelling(true);
    try {
      await api.cancelBatch(cancelTarget.id, cancelReason.trim());
      toast({
        title: `Batch ${cancelTarget.batchNumber} cancelled`,
        description: "Raw materials returned to stock, produced output withdrawn, and the ledger records the reversal.",
      });
      setCancelTarget(null);
      setCancelReason("");
      batches.reload();
      onMutate();
    } catch (e) {
      toast({
        title: "Could not cancel batch",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* ── Left: form + recent batches ── */}
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">New Processing Batch</CardTitle>
            <CardDescription>Convert raw lots into finished and secondary products.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div className="grid gap-1.5">
                <Label htmlFor="b-date">Processing date</Label>
                <Input
                  id="b-date"
                  type="date"
                  value={processingDate}
                  onChange={(e) => setProcessingDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="b-notes">Notes (optional)</Label>
                <Textarea
                  id="b-notes"
                  rows={1}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Premium teak conversion run — sawmill line 2"
                />
              </div>
            </div>

            {/* Inputs */}
            <section className="space-y-3" aria-label="Batch inputs">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <Layers className="size-4 text-primary" /> Inputs
                  <span className="font-mono tnum text-xs text-muted-foreground">
                    {formatQty(totalInput)} total
                  </span>
                </h3>
                <Button variant="outline" size="sm" onClick={() => setInputs((r) => [...r, blankInput()])}>
                  <Plus className="size-3.5" /> Add input
                </Button>
              </div>
              <datalist id="raw-lot-suggestions">
                {allKnownRawLots.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <div className="space-y-2.5">
                {inputs.map((row, idx) => {
                  const stock = row.rawMaterialId ? stockOf(row.rawMaterialId) : null;
                  // Untouched rows stay silent — no premature "must be > 0" nag.
                  const err = touchedRows.has(row.key) ? inputErrors[idx] : null;
                  const over = err !== null && err.startsWith("Exceeds available");
                  return (
                    <div key={row.key}>
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,150px)_92px_auto] items-start gap-2">
                        <Select value={row.rawMaterialId} onValueChange={(v) => onInputMaterialChange(row.key, v)}>
                          <SelectTrigger aria-label={`Raw material for input ${idx + 1}`}>
                            <SelectValue placeholder="Select material" />
                          </SelectTrigger>
                          <SelectContent>
                            {materialList.map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.name} · {formatQty(m.currentStock)} {m.unit} avail.
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          list="raw-lot-suggestions"
                          value={row.lotNumber}
                          onChange={(e) => patchInput(row.key, { lotNumber: e.target.value })}
                          placeholder="LOT-RAW-…"
                          className={cn("font-mono", err && "border-destructive ring-destructive/30")}
                          aria-invalid={Boolean(err)}
                        />
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={row.quantity}
                          onChange={(e) => patchInput(row.key, { quantity: e.target.value })}
                          placeholder="Qty"
                          className={cn(over && "border-destructive ring-destructive/30")}
                          aria-invalid={over}
                          aria-label={`Quantity for input ${idx + 1}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove input ${idx + 1}`}
                          onClick={() =>
                            setInputs((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== row.key) : [blankInput()]))
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="mt-1 min-h-[16px] pl-0.5 text-xs">
                        {err ? (
                          <p className={cn(over ? "font-medium text-destructive" : "text-muted-foreground")}>{err}</p>
                        ) : stock !== null ? (
                          <p className="text-muted-foreground">
                            Available: <span className="font-mono tnum">{formatQty(stock)}</span>{" "}
                            {materialList.find((m) => String(m.id) === row.rawMaterialId)?.unit}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Outputs */}
            <section className="space-y-3" aria-label="Batch outputs">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <PackageCheck className="size-4 text-primary" /> Outputs
                  <span className="font-mono tnum text-xs text-muted-foreground">
                    {formatQty(goodOutputTotal)} good
                  </span>
                </h3>
                <Button variant="outline" size="sm" onClick={() => setOutputs((r) => [...r, blankOutput()])}>
                  <Plus className="size-3.5" /> Add output
                </Button>
              </div>
              <div className="space-y-2.5">
                {outputs.map((row, idx) => {
                  const err = touchedRows.has(row.key) ? outputErrors[idx] : null;
                  const isWaste = row.outputType === "WASTE";
                  return (
                    <div key={row.key}>
                      <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,150px)_92px_auto] items-start gap-2">
                        <Select value={row.outputType} onValueChange={(v) => onOutputTypeChange(row.key, v as OutputRow["outputType"])}>
                          <SelectTrigger aria-label={`Output type ${idx + 1}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FINISHED">FINISHED</SelectItem>
                            <SelectItem value="SECONDARY">SECONDARY</SelectItem>
                            <SelectItem value="WASTE">WASTE</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={row.productId}
                          onValueChange={(v) => onOutputProductChange(row.key, v)}
                          disabled={isWaste}
                        >
                          <SelectTrigger aria-label={`Product for output ${idx + 1}`}>
                            <SelectValue placeholder={isWaste ? "—" : "Select product"} />
                          </SelectTrigger>
                          <SelectContent>
                            {productList.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name} · {formatINRShort(p.sellingPrice)}/{p.unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={row.lotNumber}
                          onChange={(e) => patchOutput(row.key, { lotNumber: e.target.value })}
                          placeholder={isWaste ? "WASTE-OUT-01" : "LOT-FIN-…"}
                          className={cn("font-mono", err && "border-destructive ring-destructive/30")}
                          aria-invalid={Boolean(err)}
                        />
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={row.quantity}
                          onChange={(e) => patchOutput(row.key, { quantity: e.target.value })}
                          placeholder="Qty"
                          className={cn(err && "border-destructive ring-destructive/30")}
                          aria-invalid={Boolean(err)}
                          aria-label={`Quantity for output ${idx + 1}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove output ${idx + 1}`}
                          onClick={() =>
                            setOutputs((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== row.key) : [blankOutput()]))
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="mt-1 min-h-[16px] pl-0.5 text-xs">
                        {err ? (
                          <p className="font-medium text-destructive">{err}</p>
                        ) : isWaste ? (
                          <p className="text-muted-foreground">Scrap is tracked on the batch, not sold.</p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-4">
              {!allValid && (
                <p className="mr-auto text-xs text-muted-foreground">
                  Add at least one input and one finished/secondary output to submit.
                </p>
              )}
              <Button onClick={() => void submit()} disabled={!allValid || submitting} className="min-w-[160px]">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Factory className="size-4" />}
                {submitting ? "Processing…" : "Complete batch"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent batches (mobile / narrow: also visible here) */}
        <div className="xl:hidden">
          <RecentBatches
            batches={batches}
            expanded={expanded}
            onToggle={toggleExpanded}
            onReport={(b, auto) => {
              setReportTarget(b);
              setAutoPrintReport(auto);
              setReportOpen(true);
            }}
            onCancel={(b) => {
              setCancelTarget(b);
              setCancelReason("");
            }}
          />
        </div>
      </div>

      {/* ── Right: live summary + recent batches ── */}
      <div className="space-y-5 self-start xl:sticky xl:top-20">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="font-display text-base">Live Summary</CardTitle>
            <CardDescription>Updates as you build the batch</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <SummaryStat label="Input" value={formatQty(totalInput)} />
              <SummaryStat label="Output" value={formatQty(goodOutputTotal)} />
              <SummaryStat label="Waste" value={formatQty(wasteCft)} tone={wasteCft > 0 ? "amber" : undefined} />
            </div>
            <WasteRing percent={wastePct} />
            <AnimatePresence initial={false}>
              {hasGoodOutput && wastePct > 15 && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"
                >
                  Waste is above 15% — double-check quantities before completing the batch.
                </motion.p>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <div className="hidden xl:block">
          <RecentBatches
            batches={batches}
            expanded={expanded}
            onToggle={toggleExpanded}
            onReport={(b, auto) => {
              setReportTarget(b);
              setAutoPrintReport(auto);
              setReportOpen(true);
            }}
            onCancel={(b) => {
              setCancelTarget(b);
              setCancelReason("");
            }}
          />
        </div>
      </div>

      <BatchReportDialog
        batch={reportTarget}
        open={reportOpen}
        onOpenChange={setReportOpen}
        autoPrint={autoPrintReport}
      />

      {/* Cancel batch confirmation (full stock reversal) */}
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => {
          if (!o) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel batch {cancelTarget?.batchNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This reverses the whole run: consumed raw materials return to stock, produced output is
              withdrawn, and the audit ledger records a BATCH_CANCELLATION entry. Batches whose output has
              already been sold cannot be reversed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="batch-cancel-reason">Reason (min 3 characters)</Label>
            <Textarea
              id="batch-cancel-reason"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Wrong drying profile — output does not meet quality spec"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep batch</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmCancelBatch();
              }}
              disabled={cancelReason.trim().length < 3 || cancelling}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {cancelling ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancel batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── Summary pieces ── */

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-2 py-3">
      <p className={cn("font-mono tnum text-lg font-semibold leading-none", tone === "amber" && "text-amber-700 dark:text-amber-400")}>
        {value}
      </p>
      <p className="mt-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
    </div>
  );
}

function WasteRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const r = 52;
  const C = 2 * Math.PI * r;
  const color = clamped > 15 ? "#B45309" : "#059669";
  return (
    <div className="relative mx-auto h-[128px] w-[128px]">
      <svg viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--secondary)" strokeWidth="10" />
        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={false}
          animate={{ strokeDashoffset: C - (C * clamped) / 100 }}
          transition={{ type: "spring", stiffness: 60, damping: 20 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-mono tnum text-xl font-semibold leading-none">{clamped.toFixed(1)}%</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">waste</p>
        </div>
      </div>
    </div>
  );
}

/* ── Recent batches with expandable details ── */

function RecentBatches({
  batches,
  expanded,
  onToggle,
  onReport,
  onCancel,
}: {
  batches: {
    data: ProcessingBatch[] | null;
    loading: boolean;
    error: string | null;
    reload: () => Promise<void>;
  };
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onReport: (batch: ProcessingBatch, autoPrint: boolean) => void;
  onCancel: (batch: ProcessingBatch) => void;
}) {
  const list = batches.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Recent Batches</CardTitle>
        <CardDescription>Tap a batch to inspect inputs and outputs</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {batches.loading && !batches.data ? (
          <SkeletonRows rows={4} />
        ) : batches.error ? (
          <ErrorState message={batches.error} onRetry={batches.reload} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Factory}
            title="No batches yet"
            hint="Completed conversion runs will be listed here."
            className="py-8"
          />
        ) : (
          list.map((b) => {
            const open = expanded.has(b.id);
            const cancelled = b.status === "CANCELLED";
            return (
              <div
                key={b.id}
                className={cn(
                  "overflow-hidden rounded-lg border border-border/70 transition-opacity",
                  cancelled && "opacity-70"
                )}
              >
                <div className="flex w-full items-center gap-3 px-3.5 py-3 transition-colors hover:bg-accent/50">
                  <button
                    type="button"
                    onClick={() => onToggle(b.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg",
                        cancelled
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                          : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {cancelled ? <Ban className="size-4" /> : <Factory className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate font-mono text-sm font-medium",
                            cancelled && "line-through decoration-rose-400/70 decoration-1"
                          )}
                        >
                          {b.batchNumber}
                        </span>
                        <StatusBadge status={b.status} className="shrink-0" />
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">
                          {formatDate(b.processingDate)} · in {formatQty(b.totalInputQty)} → out {formatQty(b.totalOutputQty)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-mono tnum",
                            cancelled
                              ? "text-muted-foreground/60 line-through"
                              : b.wastePercentage > 10
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-emerald-700 dark:text-emerald-400"
                          )}
                        >
                          {b.wastePercentage.toFixed(1)}% waste
                        </span>
                      </span>
                    </span>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Open print report for ${b.batchNumber}`}
                    title="Print batch report"
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onReport(b, false)}
                  >
                    <FileText className="size-3.5" />
                  </Button>
                  {!cancelled && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Cancel batch ${b.batchNumber}`}
                      title="Cancel batch (reverses stock)"
                      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onCancel(b)}
                    >
                      <Ban className="size-3.5" />
                    </Button>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                    >
                      <div className="grid gap-4 border-t border-border/70 bg-secondary/30 px-3.5 py-3 sm:grid-cols-2">
                        <div>
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Inputs
                          </p>
                          <ul className="space-y-1.5 text-xs">
                            {b.inputs.map((i) => (
                              <li key={i.id} className="flex items-center justify-between gap-2">
                                <span className="min-w-0">
                                  <span className="block truncate">{i.rawMaterialName ?? `Material #${i.rawMaterialId}`}</span>
                                  <span className="block font-mono text-[10px] text-muted-foreground">{i.lotNumber}</span>
                                </span>
                                <span className="font-mono tnum shrink-0">
                                  −{formatQty(i.quantityConsumed)} {i.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Outputs
                          </p>
                          <ul className="space-y-1.5 text-xs">
                            {b.outputs.map((o) => (
                              <li key={o.id} className="flex items-center justify-between gap-2">
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1.5">
                                    <OutputTypeBadge type={o.outputType} />
                                    <span className="truncate">{o.productName ?? "Waste"}</span>
                                  </span>
                                  <span className="block font-mono text-[10px] text-muted-foreground">{o.lotNumber}</span>
                                </span>
                                <span className="font-mono tnum shrink-0">
                                  +{formatQty(o.quantityProduced)} {o.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {b.notes ? <p className="text-xs italic text-muted-foreground sm:col-span-2">{b.notes}</p> : null}
                        {cancelled && b.cancellationReason ? (
                          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 sm:col-span-2 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">
                            <span className="font-medium">Cancellation reason:</span> {b.cancellationReason}
                            {b.cancelledAt ? (
                              <span className="ml-1 text-rose-700/70 dark:text-rose-300/70">
                                · {formatDateTime(b.cancelledAt)}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="flex justify-end gap-2 sm:col-span-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onReport(b, false)}
                          >
                            <FileText className="size-3.5" /> View report
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onReport(b, true)}
                          >
                            <FileText className="size-3.5" /> Print / PDF
                          </Button>
                          {!cancelled && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onCancel(b)}
                              className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900/70 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            >
                              <Ban className="size-3.5" /> Cancel batch
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function formatINRShort(v: number): string {
  return `₹${formatQty(v)}`;
}
