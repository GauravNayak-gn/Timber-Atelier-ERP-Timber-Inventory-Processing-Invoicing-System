"use client";

import * as React from "react";
import {
  Banknote,
  DatabaseZap,
  Factory,
  FileDown,
  ReceiptText,
  ScrollText,
  ShoppingCart,
  Sparkles,
  Sun,
  Keyboard,
  Truck,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV, type ViewId } from "@/components/timber/nav";
import { dispatchAppAction } from "@/components/timber/actions";
import { useApi } from "@/components/timber/hooks";
import { formatINR } from "@/lib/format";
import type { DashboardStats, Invoice, PartnerStats, ProcessingBatch } from "@/lib/types";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: ViewId) => void;
  onAskAi: () => void;
  onReseed: () => void;
  onToggleTheme: () => void;
  onExportLedger: () => void;
}

/** INV-0123 / INV 123 / pb-7 → normalised document number (or null). */
function parseDocQuery(q: string): { kind: "invoice" | "batch"; number: string } | null {
  const m = q.trim().match(/^(inv|pb)[-\s]?(\d+)$/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const number = `${prefix}-${m[2].padStart(4, "0")}`;
  return prefix === "INV" ? { kind: "invoice", number } : { kind: "batch", number };
}

/** Global ⌘K palette: navigation, live record deep-links + operational quick actions. */
export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onAskAi,
  onReseed,
  onToggleTheme,
  onExportLedger,
}: CommandPaletteProps) {
  // Records are fetched only while the palette is open (path null gates the fetch).
  const invoices = useApi<Invoice[]>(open ? "/api/invoices" : null);
  const batches = useApi<ProcessingBatch[]>(open ? "/api/processing/batches" : null);
  const partners = useApi<PartnerStats>(open ? "/api/partners" : null);
  // Payables top-creditors power the "Pay supplier bill" chain (ledger-derived).
  const stats = useApi<DashboardStats>(open ? "/api/dashboard/stats" : null);

  const [query, setQuery] = React.useState("");
  const docQuery = parseDocQuery(query);
  const recentInvoices = (invoices.data ?? []).slice(0, 5);
  const recentBatches = (batches.data ?? []).slice(0, 5);
  const topSuppliers = (partners.data?.suppliers ?? []).slice(0, 4);
  const hasRecords = recentInvoices.length > 0 || recentBatches.length > 0;

  const run = (fn: () => void) => {
    onOpenChange(false);
    // Let the dialog unmount before switching views (avoids focus restore flicker).
    window.setTimeout(fn, 60);
  };

  const openInvoice = (invoiceNumber: string) =>
    run(() => {
      onNavigate("invoicing");
      // AnimatePresence mode="wait" mounts the new view ~220ms after the old
      // one exits — wait for the mount + its action listener before dispatching.
      window.setTimeout(
        () => dispatchAppAction({ type: "open-invoice", invoiceNumber }),
        500
      );
    });

  const openBatch = (batchNumber: string) =>
    run(() => {
      onNavigate("processing");
      window.setTimeout(() => dispatchAppAction({ type: "open-batch", batchNumber }), 500);
    });

  const openSupplier = (supplierId: number, supplierName: string) =>
    run(() => {
      onNavigate("partners");
      window.setTimeout(
        () => dispatchAppAction({ type: "open-supplier", supplierId, supplierName }),
        500
      );
    });

  const paySupplierBill = (supplierId: number, supplierName: string) =>
    run(() => {
      onNavigate("partners");
      window.setTimeout(
        () => dispatchAppAction({ type: "open-supplier-pay", supplierId, supplierName }),
        500
      );
    });

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search records or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{docQuery ? "" : "No matching commands."}</CommandEmpty>

        {/* Direct document jump — type INV-0001 or PB-0001 */}
        {docQuery ? (
          <CommandGroup heading="Open document">
            <CommandItem
              value={`open ${docQuery.number}`}
              onSelect={() =>
                docQuery.kind === "invoice"
                  ? openInvoice(docQuery.number)
                  : openBatch(docQuery.number)
              }
            >
              {docQuery.kind === "invoice" ? (
                <ReceiptText className="size-4 text-muted-foreground" />
              ) : (
                <Factory className="size-4 text-muted-foreground" />
              )}
              <span>
                Open <span className="font-mono">{docQuery.number}</span>
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                {docQuery.kind === "invoice" ? "Invoice" : "Batch"}
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {hasRecords ? (
          <>
            {recentInvoices.length > 0 ? (
              <CommandGroup heading="Recent invoices">
                {recentInvoices.map((inv) => (
                  <CommandItem
                    key={inv.id}
                    value={`invoice ${inv.invoiceNumber} ${inv.customerName ?? ""}`}
                    onSelect={() => openInvoice(inv.invoiceNumber)}
                  >
                    <ReceiptText className="size-4 text-muted-foreground" />
                    <span className="font-mono">{inv.invoiceNumber}</span>
                    <span className="truncate text-muted-foreground">
                      {inv.customerName ?? "Customer"}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
                      {formatINR(inv.grandTotal)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {recentBatches.length > 0 ? (
              <CommandGroup heading="Recent batches">
                {recentBatches.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`batch ${b.batchNumber} ${b.notes ?? ""}`}
                    onSelect={() => openBatch(b.batchNumber)}
                  >
                    <Factory className="size-4 text-muted-foreground" />
                    <span className="font-mono">{b.batchNumber}</span>
                    <span className="truncate text-muted-foreground">
                      {b.status === "CANCELLED" ? "reversed" : `waste ${b.wastePercentage.toFixed(1)}%`}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
                      in {b.totalInputQty} → out {b.totalOutputQty}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {topSuppliers.length > 0 ? (
              <CommandGroup heading="Supplier payables">
                {topSuppliers.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`supplier payables ${s.companyName}`}
                    onSelect={() => openSupplier(s.id, s.companyName)}
                  >
                    <Truck className="size-4 text-muted-foreground" />
                    <span className="truncate">{s.companyName}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
                      PO bills · {formatINR(s.purchaseValue, { decimals: 0 })} sourced
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {(stats.data?.payables?.topCreditors ?? []).length > 0 ? (
              <CommandGroup heading="Pay supplier bill">
                {stats.data!.payables.topCreditors.slice(0, 4).map((c) => (
                  <CommandItem
                    key={c.supplierId}
                    value={`pay supplier bill ${c.supplierName} outstanding`}
                    onSelect={() => paySupplierBill(c.supplierId, c.supplierName)}
                  >
                    <Banknote className="size-4 text-emerald-600/80" />
                    <span className="truncate">Pay {c.supplierName}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
                      {formatINR(c.total, { decimals: 0 })} due · {c.billCount} bill
                      {c.billCount === 1 ? "" : "s"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
          </>
        ) : null}

        <CommandGroup heading="Go to">
          {NAV.map((item) => (
            <CommandItem
              key={item.id}
              value={`go ${item.label} ${item.title}`}
              onSelect={() => run(() => onNavigate(item.id))}
            >
              <item.icon className="size-4 text-muted-foreground" />
              <span>{item.label}</span>
              <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                View
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          <CommandItem
            value="record purchase raw material stock"
            onSelect={() =>
              run(() => {
                onNavigate("materials");
                // Wait for the view to mount and attach its action listener.
                window.setTimeout(() => dispatchAppAction({ type: "new-purchase" }), 200);
              })
            }
          >
            <ShoppingCart className="size-4 text-muted-foreground" />
            <span>Record Purchase</span>
            <kbd className="ml-auto font-mono text-[10px] text-muted-foreground/60">PO</kbd>
          </CommandItem>
          <CommandItem
            value="new processing batch conversion"
            onSelect={() =>
              run(() => {
                onNavigate("processing");
                window.setTimeout(() => dispatchAppAction({ type: "new-batch" }), 200);
              })
            }
          >
            <Factory className="size-4 text-muted-foreground" />
            <span>New Processing Batch</span>
            <kbd className="ml-auto font-mono text-[10px] text-muted-foreground/60">PB</kbd>
          </CommandItem>
          <CommandItem
            value="create invoice bill customer"
            onSelect={() =>
              run(() => {
                onNavigate("invoicing");
                window.setTimeout(() => dispatchAppAction({ type: "new-invoice" }), 200);
              })
            }
          >
            <ReceiptText className="size-4 text-muted-foreground" />
            <span>Create Invoice</span>
            <kbd className="ml-auto font-mono text-[10px] text-muted-foreground/60">INV</kbd>
          </CommandItem>
          <CommandItem
            value="ask ai assistant question stock trace"
            onSelect={() => run(onAskAi)}
          >
            <Sparkles className="size-4 text-muted-foreground" />
            <span>Ask the AI Assistant</span>
          </CommandItem>
          <CommandItem
            value="export audit ledger csv download"
            onSelect={() => run(onExportLedger)}
          >
            <FileDown className="size-4 text-muted-foreground" />
            <span>Export Audit Ledger CSV</span>
            <ScrollText className="ml-auto size-3.5 text-muted-foreground/50" />
          </CommandItem>
          <CommandItem value="reseed reset demo data database" onSelect={() => run(onReseed)}>
            <DatabaseZap className="size-4 text-muted-foreground" />
            <span>Reseed Demo Data</span>
          </CommandItem>
          <CommandItem value="toggle theme dark light mode" onSelect={() => run(onToggleTheme)}>
            <Sun className="size-4 text-muted-foreground" />
            <span>Toggle Dark / Light Theme</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      {/* Keyboard affordances footer */}
      <div className="flex items-center gap-4 border-t border-border/70 px-4 py-2 text-[10px] text-muted-foreground/80">
        <span className="inline-flex items-center gap-1">
          <Keyboard className="size-3" /> navigate
        </span>
        <span>
          <kbd className="rounded border border-border/80 bg-secondary/60 px-1 font-mono">↑↓</kbd>{" "}
          move
        </span>
        <span>
          <kbd className="rounded border border-border/80 bg-secondary/60 px-1 font-mono">↵</kbd>{" "}
          select
        </span>
        <span>
          <kbd className="rounded border border-border/80 bg-secondary/60 px-1 font-mono">esc</kbd>{" "}
          close
        </span>
        <span className="ml-auto hidden font-mono sm:inline" aria-hidden="true">
          try “INV-0001”
        </span>
      </div>
    </CommandDialog>
  );
}
