"use client";

import * as React from "react";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { formatINR, formatQty, parseNumber } from "@/lib/format";
import type { FinishedProduct, ItemType, RawMaterial } from "@/lib/types";
import { cn } from "@/lib/utils";

type Notify = (opts: { title: string; description?: string; variant?: "destructive" }) => void;

/**
 * Manual stock correction dialog (damage, shrinkage, recount).
 * Writes an ADJUSTMENT ledger row — never mutates stock silently.
 */
export function AdjustStockDialog({
  open,
  onOpenChange,
  itemType,
  item,
  onDone,
  notify,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  itemType: ItemType;
  item: RawMaterial | FinishedProduct | null;
  onDone: () => void;
  notify: Notify;
}) {
  const [direction, setDirection] = React.useState<"IN" | "OUT">("IN");
  const [quantity, setQuantity] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setDirection("IN");
      setQuantity("");
      setReason("");
    }
  }, [open]);

  if (!item) return null;

  const qty = parseNumber(quantity);
  const outOfRange = direction === "OUT" && Number.isFinite(qty) && qty > item.currentStock;
  const valid =
    Number.isFinite(qty) && qty > 0 && !outOfRange && reason.trim().length >= 3 && !submitting;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const res = await api.adjustStock({
        itemType,
        itemId: item.id,
        direction,
        quantity: qty,
        reason: reason.trim(),
      });
      notify({
        title: `Stock ${direction === "IN" ? "added" : "reduced"} — ${item.name}`,
        description: `${direction === "IN" ? "+" : "−"}${formatQty(qty)} ${item.unit} recorded as ${res.entry.referenceNumber} in the audit ledger.`,
      });
      onOpenChange(false);
      onDone();
    } catch (e) {
      notify({
        title: "Could not adjust stock",
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
          <DialogTitle className="font-display">Adjust Stock — {item.name}</DialogTitle>
          <DialogDescription>
            Manual corrections (damage, shrinkage, recount) are written to the append-only audit ledger
            with reference ADJ-NNNN.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: "IN", label: "Add stock", icon: ArrowDownToLine },
                { key: "OUT", label: "Remove stock", icon: ArrowUpFromLine },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                aria-pressed={direction === opt.key}
                onClick={() => setDirection(opt.key)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all",
                  direction === opt.key
                    ? opt.key === "IN"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-300"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                )}
              >
                <opt.icon className="size-4" />
                {opt.label}
              </button>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="adj-qty">Quantity ({item.unit})</Label>
            <Input
              id="adj-qty"
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={direction === "OUT" ? `Max ${formatQty(item.currentStock)}` : "0"}
              aria-invalid={outOfRange}
              className={cn(outOfRange && "border-destructive ring-destructive/30")}
            />
            <p className="min-h-[16px] text-xs text-muted-foreground">
              Current stock:{" "}
              <span className="font-mono tnum font-medium text-foreground">
                {formatQty(item.currentStock)} {item.unit}
              </span>
              {Number.isFinite(qty) && qty > 0 && !outOfRange ? (
                <span className="ml-2">
                  → after adjust:{" "}
                  <span className="font-mono tnum font-medium text-foreground">
                    {formatQty(direction === "IN" ? item.currentStock + qty : item.currentStock - qty)} {item.unit}
                  </span>
                </span>
              ) : outOfRange ? (
                <span className="ml-2 font-medium text-destructive">
                  Cannot remove more than available
                </span>
              ) : null}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="adj-reason">Reason (min 3 characters)</Label>
            <Textarea
              id="adj-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Termite damage found during warehouse audit"
            />
          </div>

          {"unitPurchaseRate" in item ? (
            <p className="text-xs text-muted-foreground">
              Valued at cost {formatINR(item.unitPurchaseRate)}/{item.unit} ·{" "}
              <span className="font-mono tnum">
                {formatINR((direction === "IN" ? 1 : -1) * (Number.isFinite(qty) ? qty : 0) * item.unitPurchaseRate, { decimals: 0 })}
              </span>{" "}
              inventory impact
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}
            Record adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
