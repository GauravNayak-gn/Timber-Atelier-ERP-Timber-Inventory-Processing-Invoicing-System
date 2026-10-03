"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Factory,
  GitBranch,
  Package,
  ReceiptText,
  SearchX,
  Search,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, OutputTypeBadge, SkeletonRows, StatusBadge } from "@/components/timber/primitives";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import type { BackwardTrace, ForwardTrace } from "@/lib/types";
import { cn } from "@/lib/utils";

type Mode = "forward" | "backward";

const SUGGESTIONS = ["LOT-RAW-TEAK-001", "LOT-FIN-TEAK-001", "INV-0001", "PB-0001"];

type TraceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; forward?: ForwardTrace; backward?: BackwardTrace }
  | { status: "error"; notFound?: boolean; message?: string };

export function TraceabilityView() {
  const [mode, setMode] = React.useState<Mode>("forward");
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<TraceState>({ status: "idle" });

  const run = React.useCallback(
    async (raw?: string) => {
      const term = (raw ?? query).trim();
      if (!term) return;
      setState({ status: "loading" });
      try {
        if (mode === "forward") {
          const forward = await api.forwardTrace(term);
          setState({ status: "done", forward });
        } else {
          const backward = await api.backwardTrace(term);
          setState({ status: "done", backward });
        }
      } catch (e) {
        const notFound = e instanceof ApiError && e.status === 404;
        setState({
          status: "error",
          notFound,
          message: e instanceof Error ? e.message : "Search failed",
        });
      }
    },
    [mode, query]
  );

  const switchMode = (m: Mode) => {
    setMode(m);
    setState({ status: "idle" });
  };

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
              <TabsList>
                <TabsTrigger value="forward" className="gap-1.5">
                  <ArrowRight className="size-3.5" /> Forward
                </TabsTrigger>
                <TabsTrigger value="backward" className="gap-1.5">
                  <ArrowRight className="size-3.5 rotate-180" /> Backward
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <form
              className="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={mode === "forward" ? "Raw material lot number…" : "Invoice number or finished lot…"}
                aria-label="Lot or invoice number"
                className="font-mono"
              />
              <Button type="submit" disabled={!query.trim() || state.status === "loading"} aria-label="Run trace">
                <Search className="size-4" />
                <span className="hidden sm:inline">Trace</span>
              </Button>
            </form>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Try:</span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuery(s);
                  void run(s);
                }}
                className="rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
              >
                {s}
              </button>
            ))}
            <span className="ml-1 hidden text-[11px] text-muted-foreground sm:inline">
              {mode === "forward" ? "lot → batches → invoices" : "invoice → lots → supplier"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {state.status === "idle" && (
        <EmptyState
          icon={GitBranch}
          title="Trace any lot through the workshop"
          hint="Forward traces a raw material lot to the batches and invoices it fed. Backward traces an invoice or finished lot all the way back to its supplier."
        />
      )}

      {state.status === "loading" && <SkeletonRows rows={4} />}

      {state.status === "error" && !state.notFound && (
        <ErrorState message={state.message} onRetry={() => void run()} />
      )}

      {state.status === "error" && state.notFound && (
        <EmptyState
          icon={SearchX}
          title="No trace found"
          hint={state.message ?? "Check the lot or invoice number and try again."}
        />
      )}

      {state.status === "done" && state.forward && <ForwardGraph data={state.forward} />}
      {state.status === "done" && state.backward && <BackwardGraph data={state.backward} />}
    </div>
  );
}

/* ══════════════════ Forward: lot → batches → invoices ══════════════════ */

function ForwardGraph({ data }: { data: ForwardTrace }) {
  let idx = 0;
  const next = () => idx++;

  return (
    <div>
      <TraceNode
        branch={false}
        index={next()}
        icon={Package}
        tone="amber"
        title={data.rootLot}
        right={
          data.material ? (
            <Badge
              variant="outline"
              className="border-border bg-secondary/70 font-mono text-[10px] text-muted-foreground"
            >
              {data.material.skuCode}
            </Badge>
          ) : null
        }
        lines={[data.material ? data.material.name : "Raw material lot"]}
      >
        {data.purchase ? (
          <TraceNode
            index={next()}
            icon={Truck}
            tone="stone"
            title={data.purchase.supplierName}
            right={
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 font-mono text-[10px] text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
              >
                {data.purchase.poNumber}
              </Badge>
            }
            lines={[
              `Purchased ${formatDate(data.purchase.purchaseDate)}`,
              `${formatQty(data.purchase.quantity)} @ ${formatINR(data.purchase.unitRate)}`,
              data.purchase.supplierGst ? `GSTIN ${data.purchase.supplierGst}` : "",
            ].filter(Boolean)}
          />
        ) : (
          <p className="py-1 text-xs italic text-muted-foreground">No purchase record for this lot.</p>
        )}

        <div className="pt-1">
          {data.batches.length === 0 ? (
            <p className="py-1 text-xs italic text-muted-foreground">
              No processing recorded for this lot yet — it is still in raw stock.
            </p>
          ) : (
            data.batches.map((b) => (
              <TraceNode
                key={b.batchNumber}
                index={next()}
                icon={Factory}
                tone="stone"
                title={b.batchNumber}
                lines={[
                  `Processed ${formatDate(b.processingDate)}`,
                  `Consumed ${formatQty(b.consumedQty)}`,
                ]}
                right={<WasteBadge percent={b.wastePercentage} />}
              >
                {/* Outputs */}
                <div className="space-y-2">
                  {b.outputs.map((o) => (
                    <div key={o.lotNumber} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs">
                      <OutputTypeBadge type={o.outputType} />
                      <span className="font-mono text-[11px] font-medium">{o.lotNumber}</span>
                      <span className="text-muted-foreground">{o.productName}</span>
                      <span className="font-mono tnum ml-auto font-medium">
                        {formatQty(o.quantityProduced)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Invoices */}
                {b.invoices.length > 0 && (
                  <div className="space-y-2">
                    {b.invoices.map((inv) => (
                      <TraceNode
                        key={`${b.batchNumber}-${inv.invoiceNumber}`}
                        index={next()}
                        icon={ReceiptText}
                        tone="emerald"
                        title={inv.invoiceNumber}
                        lines={[
                          `${inv.customerName} · ${formatDate(inv.invoiceDate)}`,
                          `Qty ${formatQty(inv.quantity)}`,
                          formatINR(inv.grandTotal),
                        ]}
                        right={<StatusBadge status={inv.status} />}
                      />
                    ))}
                  </div>
                )}
              </TraceNode>
            ))
          )}
        </div>
      </TraceNode>
    </div>
  );
}

/* ══════════════════ Backward: invoice → lots → supplier ══════════════════ */

function BackwardGraph({ data }: { data: BackwardTrace }) {
  let idx = 0;
  const next = () => idx++;

  return (
    <div>
      {data.invoice ? (
        <TraceNode
          branch={false}
          index={next()}
          icon={ReceiptText}
          tone="emerald"
          title={data.invoice.invoiceNumber}
          lines={[
            `${data.invoice.customerName} · ${formatDate(data.invoice.invoiceDate)}`,
            data.invoice.customerGst ? `GSTIN ${data.invoice.customerGst}` : "",
            formatINR(data.invoice.grandTotal),
          ].filter(Boolean)}
          right={<StatusBadge status={data.invoice.status} />}
        >
          {data.lots.length === 0 ? (
            <p className="py-1 text-xs italic text-muted-foreground">No lot linkage recorded.</p>
          ) : (
            data.lots.map((lot) => (
              <TraceNode
                key={lot.lotNumber}
                index={next()}
                icon={Package}
                tone="amber"
                title={lot.lotNumber}
                lines={[lot.productName, `Sold ${formatQty(lot.quantitySold)}`]}
              >
                {lot.batch && (
                  <TraceNode
                    index={next()}
                    icon={Factory}
                    tone="stone"
                    title={lot.batch.batchNumber}
                    lines={[
                      `Processed ${formatDate(lot.batch.processingDate)}`,
                      lot.batch.wastePercentage != null ? `Waste ${lot.batch.wastePercentage.toFixed(1)}%` : "",
                    ].filter(Boolean)}
                  >
                    {lot.rawInputs.length > 0 && (
                      <div className="space-y-2">
                        {lot.rawInputs.map((ri) => (
                          <div
                            key={`${lot.lotNumber}-${ri.lotNumber}-${ri.materialName}`}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
                          >
                            <Badge
                              variant="outline"
                              className="border-border bg-secondary/70 font-mono text-[10px] text-muted-foreground"
                            >
                              {ri.lotNumber}
                            </Badge>
                            <span className="text-muted-foreground">{ri.materialName}</span>
                            <span className="font-mono tnum ml-auto font-medium">
                              {formatQty(ri.quantityConsumed)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {lot.purchases.map((p) => (
                      <TraceNode
                        key={`${lot.lotNumber}-${p.poNumber}-${p.supplierName}`}
                        index={next()}
                        icon={Truck}
                        tone="emerald"
                        title={p.supplierName}
                        lines={[
                          `PO ${p.poNumber}`,
                          `Purchased ${formatDate(p.purchaseDate)}`,
                          `Qty ${formatQty(p.quantity)}`,
                          p.supplierGst ? `GSTIN ${p.supplierGst}` : "",
                        ].filter(Boolean)}
                      />
                    ))}
                  </TraceNode>
                )}

                {lot.purchases.length > 0 &&
                  lot.rawInputs.map((ri) =>
                    lot.purchases.map((p) => (
                      <TraceNode
                        key={`${ri.lotNumber}-${p.poNumber}`}
                        index={next()}
                        icon={Truck}
                        tone="emerald"
                        title={p.supplierName}
                        lines={[`PO ${p.poNumber}`, `Purchased ${formatDate(p.purchaseDate)}`, `Qty ${formatQty(p.quantity)}`]}
                      />
                    ))
                  )}
              </TraceNode>
            ))
          )}
        </TraceNode>
      ) : (
        <TraceNode
          branch={false}
          index={next()}
          icon={Package}
          tone="amber"
          title={data.root}
          lines={["Finished goods lot"]}
        >
          {data.lots.map((lot) => (
            <TraceNode
              key={lot.lotNumber}
              index={next()}
              icon={Factory}
              tone="stone"
              title={lot.batch?.batchNumber ?? "No batch"}
              lines={[lot.productName, `Sold ${formatQty(lot.quantitySold)}`]}
            >
              {lot.rawInputs.map((ri) => (
                <div
                  key={`${lot.lotNumber}-${ri.lotNumber}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
                >
                  <Badge variant="outline" className="border-border bg-secondary/70 font-mono text-[10px] text-muted-foreground">
                    {ri.lotNumber}
                  </Badge>
                  <span className="text-muted-foreground">{ri.materialName}</span>
                  <span className="font-mono tnum ml-auto font-medium">{formatQty(ri.quantityConsumed)}</span>
                </div>
              ))}
              {lot.purchases.map((p) => (
                <TraceNode
                  key={`${lot.lotNumber}-${p.poNumber}`}
                  index={next()}
                  icon={Truck}
                  tone="emerald"
                  title={p.supplierName}
                  lines={[`PO ${p.poNumber}`, `Purchased ${formatDate(p.purchaseDate)}`, `Qty ${formatQty(p.quantity)}`]}
                />
              ))}
            </TraceNode>
          ))}
        </TraceNode>
      )}
    </div>
  );
}

/* ══════════════════ Graph primitives ══════════════════ */

const TONES: Record<string, string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  stone: "bg-secondary text-secondary-foreground",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
};

function TraceNode({
  icon: Icon,
  tone,
  index,
  title,
  right,
  lines,
  branch = true,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONES;
  index: number;
  title: string;
  right?: React.ReactNode;
  lines?: string[];
  branch?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative", branch && "before:absolute before:-left-[27px] before:top-[22px] before:size-2 before:rounded-full before:bg-primary/70 before:ring-4 before:ring-background")}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index, 14) * 0.07, duration: 0.32, ease: "easeOut" }}
      >
        <Card className="transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardContent className="flex items-start gap-3 p-4">
            <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg", TONES[tone])}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="font-mono text-sm font-semibold leading-tight">{title}</p>
                {right}
              </div>
              {lines && lines.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {lines.map((l, i) => (
                    <span key={i}>{l}</span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
      {children && (
        <div className="ml-4 mt-3 space-y-3 border-l-2 border-dashed border-border/80 pl-6 sm:ml-6">
          {children}
        </div>
      )}
    </div>
  );
}

function WasteBadge({ percent }: { percent: number }) {
  const high = percent > 10;
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono tnum shrink-0",
        high
          ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
          : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300"
      )}
    >
      {percent.toFixed(1)}% waste
    </Badge>
  );
}
