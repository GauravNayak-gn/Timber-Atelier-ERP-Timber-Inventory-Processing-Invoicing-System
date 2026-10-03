"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CircleDollarSign, RefreshCw, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ViewProps {
  refreshSignal: number;
  onMutate: () => void;
}

/* ── Status badges (CONFIRMED / COMPLETED / CANCELLED …) ── */

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300",
  COMPLETED:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300",
  CANCELLED:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/50 dark:text-rose-300",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium tracking-wide",
        STATUS_STYLES[status] ??
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300",
        className
      )}
    >
      {status}
    </Badge>
  );
}

/* ── Payment badge (receivables) ── */

export function PaidBadge({
  paidAt,
  status,
  paidAmount,
  grandTotal,
  className,
}: {
  paidAt?: string | null;
  status?: string;
  /** Cumulative payments received — shows PARTIAL when some money is in but not settled. */
  paidAmount?: number;
  grandTotal?: number;
  className?: string;
}) {
  if (status === "CANCELLED") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-stone-300 bg-stone-100 text-[10px] uppercase tracking-wider text-stone-500 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-400",
          className
        )}
      >
        void
      </Badge>
    );
  }
  if (paidAt) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-emerald-200 bg-emerald-50 text-[10px] uppercase tracking-wider text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300",
          className
        )}
      >
        <CheckCircle2 className="size-3" /> paid
      </Badge>
    );
  }
  const partiallyPaid =
    typeof paidAmount === "number" &&
    typeof grandTotal === "number" &&
    paidAmount > 0.005 &&
    paidAmount < grandTotal - 0.005;
  if (partiallyPaid) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-amber-200 bg-amber-50 text-[10px] uppercase tracking-wider text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300",
          className
        )}
      >
        <CircleDollarSign className="size-3" /> partial
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-amber-200 bg-amber-50 text-[10px] uppercase tracking-wider text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300",
        className
      )}
    >
      due
    </Badge>
  );
}

/* ── Batch output type badge ── */

export function OutputTypeBadge({ type }: { type: "FINISHED" | "SECONDARY" | "WASTE" }) {
  const styles =
    type === "FINISHED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300"
      : type === "SECONDARY"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
        : "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-400";
  return (
    <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider", styles)}>
      {type}
    </Badge>
  );
}

/* ── Ledger reference chip ── */

const REF_STYLES: Record<string, string> = {
  PURCHASE:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300",
  SALE:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/50 dark:text-emerald-300",
  INVOICE_CANCELLATION:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/50 dark:text-rose-300",
  BATCH_CANCELLATION:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/50 dark:text-rose-300",
};

const REF_LABELS: Record<string, string> = {
  PURCHASE: "PURCHASE",
  PROCESSING_INPUT: "PROCESSING IN",
  PROCESSING_OUTPUT: "PROCESSING OUT",
  SALE: "SALE",
  INVOICE_CANCELLATION: "CANCELLATION",
  BATCH_CANCELLATION: "BATCH REVERSAL",
  ADJUSTMENT: "ADJUSTMENT",
};

export function RefChip({ type }: { type: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] tracking-wide",
        REF_STYLES[type] ??
          "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-400"
      )}
    >
      {REF_LABELS[type] ?? type}
    </Badge>
  );
}

/* ── Empty / error states ── */

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/90 bg-card/60 px-6 py-14 text-center",
        className
      )}
    >
      <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="font-display text-base text-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 px-6 py-12 text-center dark:border-rose-900/60 dark:bg-rose-950/20">
      <span className="grid size-12 place-items-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
        <AlertTriangle className="size-5" />
      </span>
      <p className="font-display text-base">Something went wrong</p>
      <p className="max-w-md text-sm text-muted-foreground">{message ?? "Unable to reach the server."}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/* ── Stock bar ── */

export function StockBar({
  value,
  max,
  tone = "emerald",
  className,
}: {
  value: number;
  max: number;
  tone?: "emerald" | "amber" | "rose";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <motion.div
        className={cn(
          "h-full rounded-full",
          tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500"
        )}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
    </div>
  );
}

/* ── Skeletons ── */

export function SkeletonGrid({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-2 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

/* ── Section heading ── */

export function SectionHeading({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}
