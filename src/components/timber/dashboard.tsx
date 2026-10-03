"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Ban,
  Banknote,
  CheckCircle2,
  ChevronRight,
  IndianRupee,
  Clock4,
  Factory,
  Package,
  ReceiptText,
  Recycle,
  TriangleAlert,
  TreePine,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  RefChip,
  SectionHeading,
  SkeletonRows,
  StatusBadge,
  StockBar,
} from "@/components/timber/primitives";
import { useApi, useCountUp } from "@/components/timber/hooks";
import { dispatchAppAction } from "@/components/timber/actions";
import { api } from "@/lib/api-client";
import { formatCompactINR, formatDate, formatINR, formatQty } from "@/lib/format";
import type { DashboardStats, PayablesSummary, ReceivablesSummary } from "@/lib/types";
import type { ViewId } from "@/components/timber/nav";
import { cn } from "@/lib/utils";

/* Chart palette — warm timber tones (no blue anywhere) */
const AMBER_DEEP = "#B45309";
const AMBER_MID = "#D97706";
const STONE = "#78716C";
const EMERALD = "#059669";

export function DashboardView({
  refreshSignal,
  onNavigate,
}: {
  refreshSignal: number;
  onNavigate: (view: ViewId) => void;
}) {
  const { data, loading, error, reload } = useApi<DashboardStats>("/api/dashboard/stats", [refreshSignal]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-4 p-5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="p-6">
              <Skeleton className="h-[280px] w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <Skeleton className="mx-auto h-[200px] w-[200px] rounded-full" />
            </CardContent>
          </Card>
        </div>
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  if (!data) return null;

  const { kpis, lowStockItems, recentBatches, recentInvoices, monthlySales } = data;

  return (
    <div className="space-y-6">
      {/* KPI hero row — 3×2 at laptop widths, single row of 6 on very wide screens */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          icon={Wallet}
          label="Inventory Value"
          value={kpis.inventoryValue}
          format={formatINR}
          sub={`Raw ${formatCompactINR(kpis.rawInventoryValue)} · Finished ${formatCompactINR(kpis.finishedInventoryValue)}`}
        />
        <KpiCard
          icon={TreePine}
          label="Raw Stock"
          value={kpis.totalRawStock}
          format={(v) => `${formatQty(v)} CFT`}
          sub={`Worth ${formatCompactINR(kpis.rawInventoryValue)} at cost`}
        />
        <KpiCard
          icon={Package}
          label="Finished Stock"
          value={kpis.totalFinishedStock}
          format={(v) => `${formatQty(v)} CFT`}
          sub={`Retail value ${formatCompactINR(kpis.finishedInventoryValue)}`}
        />
        <KpiCard
          icon={ReceiptText}
          label="Monthly Sales"
          value={kpis.monthSalesTotal}
          format={formatINR}
          sub={`GST collected ${formatCompactINR(kpis.monthGstCollected)}`}
        />
        <KpiCard
          icon={IndianRupee}
          label="Collected"
          value={kpis.collectedThisMonth}
          format={formatINR}
          sub="Cash received this month"
          tone={kpis.collectedThisMonth > 0 ? "emerald" : undefined}
        />
        <KpiCard
          icon={Recycle}
          label="Overall Waste"
          value={kpis.overallWastePercent}
          format={(v) => `${v.toFixed(1)}%`}
          sub="Share of processed input lost"
          tone={kpis.overallWastePercent > 12 ? "amber" : "emerald"}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="transition-shadow hover:shadow-md lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Sales Momentum</CardTitle>
            <CardDescription>Confirmed invoices over the last 6 months</CardDescription>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlySales} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={AMBER_MID} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={AMBER_MID} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gstGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={STONE} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={STONE} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatCompactINR(v)}
                    width={64}
                  />
                  <ChartTooltip content={<SalesTip />} cursor={{ stroke: "var(--border)" }} />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    name="Sales"
                    stroke={AMBER_DEEP}
                    strokeWidth={2.5}
                    fill="url(#salesGrad)"
                    strokeLinecap="round"
                  />
                  <Area
                    type="monotone"
                    dataKey="gst"
                    name="GST"
                    stroke={STONE}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    fill="url(#gstGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="font-display text-base">Waste Gauge</CardTitle>
              <CardDescription>Overall conversion efficiency</CardDescription>
            </CardHeader>
            <CardContent className="relative pb-6">
              <WasteGauge percent={kpis.overallWastePercent} />
            </CardContent>
          </Card>

          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                <Ban className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-mono tnum text-2xl font-semibold leading-none">
                  {kpis.cancelledInvoiceCount}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  Cancelled invoices · refunds {formatCompactINR(kpis.cancelledRefundValue)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Receivables & aging */}
      <ReceivablesPanel receivables={data.receivables} onNavigate={onNavigate} />

      {/* Payables & aging — the supplier-side mirror */}
      <PayablesPanel payables={data.payables} onNavigate={onNavigate} />

      {/* Live ledger activity feed */}
      <ActivityFeed entries={data.recentActivity ?? []} onNavigate={onNavigate} />

      {/* Low stock alerts */}
      <section aria-label="Low stock alerts" className="space-y-3">
        <SectionHeading
          title="Low Stock Alerts"
          sub={
            lowStockItems.length > 0
              ? `${lowStockItems.length} item${lowStockItems.length > 1 ? "s" : ""} at or below reorder threshold`
              : undefined
          }
        />
        {lowStockItems.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckCircle2 className="size-4.5 shrink-0" />
            All stock levels are healthy — nothing needs reordering right now.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {lowStockItems.map((item, i) => {
              const max = Math.max(item.reorderThreshold * 1.5, item.currentStock, 1);
              return (
                <motion.div
                  key={`${item.kind}-${item.id}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <Card className="border-amber-200/80 bg-amber-50/50 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-amber-900/60 dark:bg-amber-950/20">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <p className="truncate text-sm font-medium">{item.name}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-200 bg-amber-50 text-[10px] uppercase tracking-wider text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
                        >
                          {item.kind === "RAW_MATERIAL" ? "Raw" : "Finished"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono tnum font-semibold text-foreground">
                          {formatQty(item.currentStock)} {item.unit}
                        </span>{" "}
                        in stock · reorder at {formatQty(item.reorderThreshold)} {item.unit}
                      </p>
                      <StockBar
                        value={item.currentStock}
                        max={max}
                        tone={item.currentStock <= 0 ? "rose" : "amber"}
                      />
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display text-base">Recent Batches</CardTitle>
              <CardDescription>Latest processing runs</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("processing")}>
              Open <ChevronRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {recentBatches.length === 0 ? (
              <EmptyState
                icon={Factory}
                title="No batches yet"
                hint="Processing runs will appear here once the workshop records a conversion batch."
                className="py-8"
              />
            ) : (
              recentBatches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onNavigate("processing")}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/50"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <Factory className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-medium">{b.batchNumber}</span>
                    <span className="block text-xs text-muted-foreground">{formatDate(b.processingDate)}</span>
                  </span>
                  <WasteChip percent={b.wastePercentage} />
                  <StatusBadge status={b.status} className="hidden sm:inline-flex" />
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <WasteTrendCard batches={data.wasteMetrics ?? []} onNavigate={onNavigate} />

        <Card className="transition-shadow hover:shadow-md">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display text-base">Recent Invoices</CardTitle>
              <CardDescription>Latest customer billing</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("invoicing")}>
              Open <ChevronRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {recentInvoices.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="No invoices yet"
                hint="Confirm your first sale and it will show up here."
                className="py-8"
              />
            ) : (
              recentInvoices.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => onNavigate("invoicing")}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/50"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <ReceiptText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-medium">{inv.invoiceNumber}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {inv.customerName ?? "Walk-in customer"} · {formatDate(inv.invoiceDate)}
                    </span>
                  </span>
                  <span className="font-mono tnum text-sm font-semibold">{formatINR(inv.grandTotal)}</span>
                  <StatusBadge status={inv.status} className="hidden sm:inline-flex" />
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Waste-by-batch trend (per-run conversion loss vs 10% target) ── */

const WASTE_TARGET = 10; // % — dashed marker on every bar

function wasteTone(pct: number): "emerald" | "amber" | "deep" {
  if (pct <= 8) return "emerald";
  if (pct <= WASTE_TARGET) return "amber";
  return "deep";
}

function WasteTrendCard({
  batches,
  onNavigate,
}: {
  batches: DashboardStats["wasteMetrics"];
  onNavigate: (view: ViewId) => void;
}) {
  const maxWaste = Math.max(0, ...batches.map((b) => b.wastePercent));
  const scale = Math.max(16, Math.ceil(maxWaste + 2)); // bar scale, ≥16% for stable proportions
  const avg =
    batches.length > 0 ? batches.reduce((s, b) => s + b.wastePercent, 0) / batches.length : 0;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="font-display text-base">Waste by Batch</CardTitle>
          <CardDescription>Conversion loss per run · target ≤ {WASTE_TARGET}%</CardDescription>
        </div>
        {batches.length > 0 ? (
          <Badge
            variant="outline"
            className={cn(
              "font-mono tnum shrink-0",
              avg > WASTE_TARGET
                ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300"
            )}
          >
            avg {avg.toFixed(1)}%
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {batches.length === 0 ? (
          <EmptyState
            icon={Recycle}
            title="No completed batches"
            hint="Waste trend appears once the workshop completes a conversion run."
            className="py-8"
          />
        ) : (
          <>
            {batches.map((b, i) => {
              const tone = wasteTone(b.wastePercent);
              return (
                <button
                  key={b.batchNumber}
                  type="button"
                  onClick={() => onNavigate("processing")}
                  aria-label={`Batch ${b.batchNumber}, waste ${b.wastePercent.toFixed(1)} percent — open processing`}
                  title={`${b.batchNumber} · ${formatDate(b.processingDate)} · in ${formatQty(b.totalInputQty)} → waste ${formatQty(b.totalWasteQty)}`}
                  className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-accent/50"
                >
                  <span className="w-[4.5rem] shrink-0 truncate font-mono text-xs font-medium text-muted-foreground group-hover:text-foreground">
                    {b.batchNumber}
                  </span>
                  <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                    {/* target marker */}
                    <span
                      aria-hidden
                      className="absolute inset-y-0 w-px border-l border-dashed border-foreground/25"
                      style={{ left: `${(WASTE_TARGET / scale) * 100}%` }}
                    />
                    <motion.span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        tone === "emerald"
                          ? "bg-emerald-500"
                          : tone === "amber"
                            ? "bg-amber-500"
                            : "bg-amber-700"
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (b.wastePercent / scale) * 100)}%` }}
                      transition={{ delay: Math.min(i * 0.05, 0.35), duration: 0.55, ease: "easeOut" }}
                    />
                  </span>
                  <span
                    className={cn(
                      "font-mono tnum w-12 shrink-0 text-right text-xs font-semibold",
                      tone === "emerald"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : tone === "amber"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-amber-800 dark:text-amber-500"
                    )}
                  >
                    {b.wastePercent.toFixed(1)}%
                  </span>
                </button>
              );
            })}
            <p className="px-2 pt-1 text-[10px] text-muted-foreground">
              <span aria-hidden className="mr-1 inline-block h-px w-3 border-t border-dashed border-foreground/40 align-middle" />
              target {WASTE_TARGET}% · click a run to inspect it
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Live ledger activity feed ── */

function timeAgo(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return "just now";
  if (secs < 90) return "1 min ago";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 7200) return "1 hr ago";
  if (secs < 86400) return `${Math.floor(secs / 3600)} hrs ago`;
  const days = Math.floor(secs / 86400);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(d);
}

function ActivityFeed({
  entries,
  onNavigate,
}: {
  entries: DashboardStats["recentActivity"];
  onNavigate: (view: ViewId) => void;
}) {
  return (
    <section aria-label="Live ledger activity" className="space-y-3">
      <SectionHeading
        title="Live Ledger Activity"
        sub="Every stock movement, newest first — straight from the append-only audit ledger"
      >
        <Button variant="ghost" size="sm" onClick={() => onNavigate("ledger")}>
          Full ledger <ChevronRight className="size-3.5" />
        </Button>
      </SectionHeading>
      {entries.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No ledger activity yet"
          hint="Purchases, processing runs, sales and adjustments will stream here."
          className="py-8"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((e, i) => {
            const isOut = e.stockOut > 0;
            return (
              <motion.button
                key={e.id}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3, ease: "easeOut" }}
                onClick={() => onNavigate("ledger")}
                className="group rounded-xl border border-border/70 bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${e.referenceType} movement for ${e.itemName}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <RefChip type={e.referenceType} />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {timeAgo(e.timestamp)}
                  </span>
                </div>
                <div className="mt-2.5 flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium" title={e.itemName}>
                    {e.itemName}
                  </p>
                  <span
                    className={cn(
                      "font-mono tnum shrink-0 text-sm font-semibold",
                      isOut ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {isOut ? "−" : "+"}
                    {formatQty(e.stockOut > 0 ? e.stockOut : e.stockIn)} {""}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {e.itemType === "RAW_MATERIAL" ? "raw" : "fin"}
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate font-mono" title={`${e.referenceNumber} · ${e.lotNumber}`}>
                    {e.referenceNumber}
                    {e.lotNumber ? ` · ${e.lotNumber}` : ""}
                  </span>
                  <span className="font-mono tnum shrink-0">
                    bal {formatQty(e.balanceAfter)}
                  </span>
                </div>
                <span
                  aria-hidden
                  className="mt-3 block h-px w-full bg-gradient-to-r from-transparent via-border to-transparent transition-colors group-hover:via-primary/40"
                />
              </motion.button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ── KPI card with animated count-up ── */

function KpiCard({
  icon: Icon,
  label,
  value,
  format,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  format: (v: number) => string;
  sub: string;
  tone?: "amber" | "emerald";
}) {
  const animated = useCountUp(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      whileTap={{ scale: 0.98 }}
    >
      <Card className="group relative h-full overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
        {/* Hover hairline — warm gradient sheen along the top edge */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        />
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </p>
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110",
                tone === "amber"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                  : tone === "emerald"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-primary/10 text-primary"
              )}
            >
              <Icon className="size-4.5" />
            </span>
          </div>
          <p
            className="font-mono tnum mt-3 truncate text-[1.35rem] font-semibold leading-none tracking-tight md:text-[1.45rem]"
            title={format(animated)}
          >
            {format(animated)}
          </p>
          <p className="mt-2 truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ── Charts ── */

function SalesTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-mono tnum text-xs text-muted-foreground">
          {p.name}: {formatINR(Number(p.value ?? 0))}
        </p>
      ))}
    </div>
  );
}

function WasteGauge({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const color = clamped > 12 ? AMBER_DEEP : EMERALD;
  return (
    <div className="relative mx-auto h-[180px] w-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="74%"
          outerRadius="100%"
          data={[{ name: "waste", value: clamped, fill: color }]}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: "var(--secondary)" }} dataKey="value" cornerRadius={12} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <GaugeNumber percent={clamped} />
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">waste</p>
        </div>
      </div>
    </div>
  );
}

function GaugeNumber({ percent }: { percent: number }) {
  const animated = useCountUp(percent);
  return (
    <p className="font-mono tnum text-2xl font-semibold leading-tight">{animated.toFixed(1)}%</p>
  );
}

/* ── Small shared bits ── */

function WasteChip({ percent }: { percent: number }) {
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
      title={`Waste ${percent.toFixed(1)}%`}
    >
      {percent.toFixed(1)}% waste
    </Badge>
  );
}

/* ── Receivables & aging ── */

const AGE_SEGMENTS = [
  { key: "0–30", color: "#059669", soft: "bg-emerald-500", chip: "text-emerald-700 dark:text-emerald-400" },
  { key: "31–60", color: "#D97706", soft: "bg-amber-500", chip: "text-amber-700 dark:text-amber-400" },
  { key: "61–90", color: "#B45309", soft: "bg-amber-700", chip: "text-amber-800 dark:text-amber-500" },
  { key: "90+", color: "#E11D48", soft: "bg-rose-600", chip: "text-rose-700 dark:text-rose-400" },
] as const;

function ReceivablesPanel({
  receivables,
  onNavigate,
}: {
  receivables: ReceivablesSummary;
  onNavigate: (view: ViewId) => void;
}) {
  const animatedOutstanding = useCountUp(receivables.outstandingTotal);
  const animatedCollected = useCountUp(receivables.collectedTotal);
  const settled = receivables.outstandingTotal <= 0;

  return (
    <section aria-label="Receivables and aging" className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      {/* Aging card */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <div>
            <CardTitle className="font-display text-base">Receivables & Aging</CardTitle>
            <CardDescription>Confirmed invoices not yet settled, grouped by age</CardDescription>
          </div>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("invoicing")}>
              Invoices <ChevronRight className="size-3.5" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          {settled ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-6 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="size-5 shrink-0" />
              <div>
                <p className="font-medium">Every invoice is settled</p>
                <p className="mt-0.5 text-xs opacity-80">
                  Collected to date {formatINR(animatedCollected)} — nothing outstanding.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Outstanding
                  </p>
                  <p className="font-mono tnum mt-1 text-3xl font-semibold leading-none tracking-tight text-foreground">
                    {formatINR(animatedOutstanding)}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {receivables.invoiceCount} unpaid invoice{receivables.invoiceCount === 1 ? "" : "s"} ·{" "}
                    {receivables.overdueTotal > 0 ? (
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        {formatCompactINR(receivables.overdueTotal)} overdue 30+ days
                      </span>
                    ) : (
                      "nothing overdue yet"
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Collected
                  </p>
                  <p className="font-mono tnum mt-1 text-lg font-semibold leading-none text-emerald-700 dark:text-emerald-400">
                    {formatINR(animatedCollected)}
                  </p>
                </div>
              </div>

              {/* Stacked aging bar */}
              <div>
                <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-secondary">
                  {receivables.buckets.map((bucket, i) => {
                    const pct =
                      receivables.outstandingTotal > 0
                        ? (bucket.total / receivables.outstandingTotal) * 100
                        : 0;
                    return (
                      <motion.div
                        key={bucket.label}
                        className={cn("h-full", AGE_SEGMENTS[i].soft)}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
                        title={`${bucket.label} days · ${formatINR(bucket.total)}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {receivables.buckets.map((bucket, i) => (
                    <div
                      key={bucket.label}
                      className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2 transition-colors hover:border-border hover:bg-secondary/50"
                    >
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        <span className={cn("size-1.5 rounded-full", AGE_SEGMENTS[i].soft)} />
                        {bucket.label} days
                      </p>
                      <p className={cn("font-mono tnum mt-1 text-sm font-semibold", bucket.total > 0 ? AGE_SEGMENTS[i].chip : "text-muted-foreground/60")}>
                        {formatCompactINR(bucket.total)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {bucket.count} invoice{bucket.count === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Top debtors */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="font-display text-base">Follow-ups</CardTitle>
          <CardDescription>Largest outstanding balances by customer</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {settled || receivables.topDebtors.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-5 text-xs text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
              <Banknote className="size-4 shrink-0" />
              No collection calls needed — the ledger is clean.
            </div>
          ) : (
            receivables.topDebtors.map((d, i) => (
              <motion.button
                key={d.customerId}
                type="button"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.25 }}
                onClick={() => onNavigate("invoicing")}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/50"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary font-mono text-xs font-semibold text-muted-foreground">
                  #{i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.customerName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.invoiceCount} invoice{d.invoiceCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    d.oldestDays > 60
                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/50 dark:text-rose-300"
                      : d.oldestDays > 30
                        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300"
                  )}
                >
                  <Clock4 className="size-3" />
                  {d.oldestDays}d
                </span>
                <span className="font-mono tnum shrink-0 text-sm font-semibold">
                  {formatCompactINR(d.total)}
                </span>
              </motion.button>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* ── Payables & aging — supplier-side mirror of the receivables panel ── */

function PayablesPanel({
  payables,
  onNavigate,
}: {
  payables: PayablesSummary;
  onNavigate: (view: ViewId) => void;
}) {
  const animatedOutstanding = useCountUp(payables.outstandingTotal);
  const animatedPaid = useCountUp(payables.paidTotal);
  const settled = payables.outstandingTotal <= 0;

  const openSupplier = (supplierId: number, supplierName: string) => {
    onNavigate("partners");
    // Wait for the Partners view mount + its action listener (AnimatePresence).
    window.setTimeout(
      () => dispatchAppAction({ type: "open-supplier", supplierId, supplierName }),
      500
    );
  };

  return (
    <section aria-label="Payables and aging" className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      {/* Aging card */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <div>
            <CardTitle className="font-display text-base">Payables &amp; Aging</CardTitle>
            <CardDescription>Supplier PO bills outstanding, grouped by age</CardDescription>
          </div>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("partners")}>
              Partners <ChevronRight className="size-3.5" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          {settled ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-6 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="size-5 shrink-0" />
              <div>
                <p className="font-medium">Every supplier bill is settled</p>
                <p className="mt-0.5 text-xs opacity-80">
                  Paid to date {formatINR(animatedPaid)} — the workshop owes nothing.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Owed to suppliers
                  </p>
                  <p className="font-mono tnum mt-1 text-3xl font-semibold leading-none tracking-tight text-foreground">
                    {formatINR(animatedOutstanding)}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {payables.billCount} bill{payables.billCount === 1 ? "" : "s"} across{" "}
                    {payables.supplierCount} supplier{payables.supplierCount === 1 ? "" : "s"} ·{" "}
                    {payables.overdueTotal > 0 ? (
                      <span className="font-medium text-rose-700 dark:text-rose-400">
                        {formatCompactINR(payables.overdueTotal)} overdue 30+ days
                      </span>
                    ) : (
                      "nothing overdue yet"
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Paid to date
                  </p>
                  <p className="font-mono tnum mt-1 text-lg font-semibold leading-none text-emerald-700 dark:text-emerald-400">
                    {formatINR(animatedPaid)}
                  </p>
                </div>
              </div>

              {/* Stacked aging bar */}
              <div>
                <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-secondary">
                  {payables.buckets.map((bucket, i) => {
                    const pct =
                      payables.outstandingTotal > 0
                        ? (bucket.total / payables.outstandingTotal) * 100
                        : 0;
                    return (
                      <motion.div
                        key={bucket.label}
                        className={cn("h-full", AGE_SEGMENTS[i].soft)}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
                        title={`${bucket.label} days · ${formatINR(bucket.total)}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {payables.buckets.map((bucket, i) => (
                    <div
                      key={bucket.label}
                      className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2 transition-colors hover:border-border hover:bg-secondary/50"
                    >
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        <span className={cn("size-1.5 rounded-full", AGE_SEGMENTS[i].soft)} />
                        {bucket.label} days
                      </p>
                      <p className={cn("font-mono tnum mt-1 text-sm font-semibold", bucket.total > 0 ? AGE_SEGMENTS[i].chip : "text-muted-foreground/60")}>
                        {formatCompactINR(bucket.total)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {bucket.count} bill{bucket.count === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Top creditors */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="font-display text-base">Payments due</CardTitle>
          <CardDescription>Largest outstanding balances by supplier</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {settled || payables.topCreditors.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-5 text-xs text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
              <Banknote className="size-4 shrink-0" />
              No supplier payments due — the ledger is clean.
            </div>
          ) : (
            payables.topCreditors.map((c, i) => (
              <motion.button
                key={c.supplierId}
                type="button"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.25 }}
                onClick={() => openSupplier(c.supplierId, c.supplierName)}
                className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/50"
                title={`Open payables for ${c.supplierName}`}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary font-mono text-xs font-semibold text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  #{i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.supplierName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.billCount} bill{c.billCount === 1 ? "" : "s"} due
                  </span>
                </span>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    c.oldestDays > 60
                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/50 dark:text-rose-300"
                      : c.oldestDays > 30
                        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300"
                  )}
                >
                  <Clock4 className="size-3" />
                  {c.oldestDays}d
                </span>
                <span className="font-mono tnum shrink-0 text-sm font-semibold">
                  {formatCompactINR(c.total)}
                </span>
                <Truck className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
              </motion.button>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}
