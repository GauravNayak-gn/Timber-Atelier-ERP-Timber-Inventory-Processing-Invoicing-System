"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, FileDown, FilterX, ScrollText, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, RefChip, SectionHeading, SkeletonRows } from "@/components/timber/primitives";
import { useApi } from "@/components/timber/hooks";
import { api } from "@/lib/api-client";
import { exportLedgerCsv } from "@/lib/ledger-export";
import { formatDateTime, formatQty } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const LIMIT = 50;

const ITEM_TYPES = [
  { value: "ALL", label: "All item types" },
  { value: "RAW_MATERIAL", label: "Raw materials" },
  { value: "FINISHED_PRODUCT", label: "Finished products" },
];

const REFERENCE_TYPES = [
  { value: "ALL", label: "All references" },
  { value: "PURCHASE", label: "Purchase" },
  { value: "PROCESSING_INPUT", label: "Processing input" },
  { value: "PROCESSING_OUTPUT", label: "Processing output" },
  { value: "SALE", label: "Sale" },
  { value: "INVOICE_CANCELLATION", label: "Invoice cancellation" },
  { value: "BATCH_CANCELLATION", label: "Batch cancellation" },
  { value: "ADJUSTMENT", label: "Adjustment" },
];

export function AuditLedgerView() {
  const { toast } = useToast();
  const [itemType, setItemType] = React.useState("ALL");
  const [referenceType, setReferenceType] = React.useState("ALL");
  const [draftLot, setDraftLot] = React.useState("");
  const [lotNumber, setLotNumber] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [offset, setOffset] = React.useState(0);

  // Debounce the lot-number text filter.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setLotNumber(draftLot.trim());
      setOffset(0);
    }, 400);
    return () => clearTimeout(t);
  }, [draftLot]);

  const onFilterChange = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  const path = React.useMemo(() => {
    const p = new URLSearchParams();
    if (itemType !== "ALL") p.set("itemType", itemType);
    if (referenceType !== "ALL") p.set("referenceType", referenceType);
    if (lotNumber) p.set("lotNumber", lotNumber);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    p.set("limit", String(LIMIT));
    p.set("offset", String(offset));
    return `/api/audit/ledger?${p.toString()}`;
  }, [itemType, referenceType, lotNumber, startDate, endDate, offset]);

  const { data, loading, error, reload } = useApi<{ entries: LedgerEntry[]; total: number }>(path);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = offset + entries.length;
  const hasPrev = offset > 0;
  const hasNext = offset + entries.length < total;

  const clearFilters = () => {
    setItemType("ALL");
    setReferenceType("ALL");
    setDraftLot("");
    setStartDate("");
    setEndDate("");
    setOffset(0);
  };

  const filtersActive =
    itemType !== "ALL" || referenceType !== "ALL" || lotNumber !== "" || startDate !== "" || endDate !== "";

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Movement History"
        sub="Every stock mutation is recorded here — immutable and traceable"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            exportLedgerCsv({ itemType, referenceType, lotNumber, startDate, endDate })
              .then((n) =>
                toast({
                  title: "Ledger exported",
                  description: `${n} entr${n === 1 ? "y" : "ies"} downloaded as CSV.`,
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

      {/* Filter bar */}
      <Card>
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-[160px_190px_minmax(0,1fr)_150px_150px_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="f-item">Item type</Label>
            <Select
              value={itemType}
              onValueChange={(v) =>
                onFilterChange(() => setItemType(v))
              }
            >
              <SelectTrigger id="f-item" aria-label="Filter by item type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="f-ref">Reference type</Label>
            <Select
              value={referenceType}
              onValueChange={(v) => onFilterChange(() => setReferenceType(v))}
            >
              <SelectTrigger id="f-ref" aria-label="Filter by reference type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFERENCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="f-lot">Lot number</Label>
            <Input
              id="f-lot"
              value={draftLot}
              onChange={(e) => setDraftLot(e.target.value)}
              placeholder="e.g. LOT-RAW-TEAK-001"
              className="font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="f-start">From</Label>
            <Input
              id="f-start"
              type="date"
              value={startDate}
              onChange={(e) => onFilterChange(() => setStartDate(e.target.value))}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="f-end">To</Label>
            <Input
              id="f-end"
              type="date"
              value={endDate}
              onChange={(e) => onFilterChange(() => setEndDate(e.target.value))}
            />
          </div>

          <div className="flex items-end">
            <Button variant="outline" onClick={clearFilters} disabled={!filtersActive} className="w-full lg:w-auto">
              <FilterX className="size-4" /> Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && !data ? (
        <SkeletonRows rows={8} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/90 bg-card/60 px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground">
            <ScrollText className="size-5" />
          </span>
          <p className="font-display text-base">No ledger entries match</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {filtersActive
              ? "Try widening the filters or clearing them to see the full movement history."
              : "The ledger is empty — stock movements will appear here as they happen."}
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="tbl-scroll">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Timestamp</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Lot #</TableHead>
                  <TableHead className="text-right">Stock In</TableHead>
                  <TableHead className="text-right">Stock Out</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="pr-5">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => (
                  <motion.tr
                    key={e.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.25 }}
                    className="border-b transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="pl-5 text-xs text-muted-foreground">
                      {formatDateTime(e.timestamp)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="max-w-[180px] truncate font-medium" title={e.itemName}>
                          {e.itemName}
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-border bg-secondary/70 text-[10px] uppercase tracking-wider text-muted-foreground"
                        >
                          {e.itemType === "RAW_MATERIAL" ? "Raw" : "Finished"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <RefChip type={e.referenceType} />
                        <span className="font-mono text-[11px] text-muted-foreground">{e.referenceNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.lotNumber || "—"}</TableCell>
                    <TableCell className="text-right">
                      {e.stockIn > 0 ? (
                        <span className="font-mono tnum font-medium text-emerald-700 dark:text-emerald-400">
                          +{formatQty(e.stockIn)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.stockOut > 0 ? (
                        <span className="font-mono tnum font-medium text-rose-700 dark:text-rose-400">
                          −{formatQty(e.stockOut)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono tnum font-semibold">{formatQty(e.balanceAfter)}</span>
                    </TableCell>
                    <TableCell className="pr-5">
                      <span
                        className={cn("block max-w-[260px] truncate text-xs text-muted-foreground")}
                        title={e.notes ?? undefined}
                      >
                        {e.notes ?? "—"}
                      </span>
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-5 py-3 text-sm">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Search className="size-3.5" />
              Showing{" "}
              <span className="font-mono tnum">
                {pageStart}–{pageEnd}
              </span>{" "}
              of <span className="font-mono tnum">{total}</span> entries
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setOffset((o) => o + LIMIT)}
                aria-label="Next page"
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
