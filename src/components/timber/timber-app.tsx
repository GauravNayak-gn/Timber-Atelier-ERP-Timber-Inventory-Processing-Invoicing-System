"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { exportLedgerCsv } from "@/lib/ledger-export";
import { TimberMark } from "@/components/timber/logo";
import { Sidebar } from "@/components/timber/sidebar";
import { AppHeader } from "@/components/timber/header";
import { AiAssistant } from "@/components/timber/ai-assistant";
import { CommandPalette } from "@/components/timber/command-palette";
import { DashboardView } from "@/components/timber/dashboard";
import { RawMaterialsView } from "@/components/timber/raw-materials";
import { ProcessingView } from "@/components/timber/processing";
import { ProductsView } from "@/components/timber/products";
import { PartnersView } from "@/components/timber/partners";
import { InvoicingView } from "@/components/timber/invoicing";
import { TraceabilityView } from "@/components/timber/traceability";
import { AuditLedgerView } from "@/components/timber/audit-ledger";
import { NAV, type ViewId } from "@/components/timber/nav";

const COLLAPSE_KEY = "timber:sidebar-collapsed";

export function TimberApp() {
  const [view, setView] = React.useState<ViewId>("dashboard");
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [refreshSignal, setRefreshSignal] = React.useState(0);
  const [reseeding, setReseeding] = React.useState(false);
  // Command palette mounts client-side only: Radix useId sequences inside the
  // closed dialog skew SSR hydration ids for earlier tooltips/dialogs.
  const [paletteMounted, setPaletteMounted] = React.useState(false);
  const { toast } = useToast();
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => setPaletteMounted(true), []);

  // Restore sidebar preference.
  React.useEffect(() => {
    const saved = window.localStorage.getItem(COLLAPSE_KEY);
    if (saved === "1") setCollapsed(true);
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((c) => {
      window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  const bump = React.useCallback(() => setRefreshSignal((s) => s + 1), []);

  const reseed = React.useCallback(async () => {
    setReseeding(true);
    try {
      await api.seed();
      toast({
        title: "Demo data reseeded",
        description: "Suppliers, stock, batch PB-0001 and invoice INV-0001 restored.",
      });
      bump();
    } catch (e) {
      toast({
        title: "Reseed failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setReseeding(false);
    }
  }, [toast, bump]);

  const navigate = React.useCallback((v: ViewId) => {
    setView(v);
    setMobileOpen(false);
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const exportLedger = React.useCallback(async () => {
    try {
      const count = await exportLedgerCsv();
      toast({
        title: "Ledger exported",
        description: `${count} entr${count === 1 ? "y" : "ies"} downloaded as CSV.`,
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Global ⌘K / Ctrl+K opens the command palette.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const meta = NAV.find((n) => n.id === view) ?? NAV[0];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Desktop sidebar */}
      <Sidebar
        active={view}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />

      {/* Mobile navigation sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-[268px] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="p-4 pb-2 text-left">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex items-center gap-2.5">
              <TimberMark className="size-9 text-sidebar-primary" />
              <div>
                <p className="font-display text-[15px] font-semibold leading-tight tracking-tight">
                  Timber Atelier
                </p>
                <p className="text-[10px] uppercase tracking-[0.22em] opacity-55">ERP · Est. Craft</p>
              </div>
            </div>
          </SheetHeader>
          <nav aria-label="Mobile" className="flex flex-col gap-1 px-3 pb-4">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                  view === item.id
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                {view === item.id && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                )}
                <item.icon className="size-[18px] shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding-left] duration-300 ease-out",
          "md:pl-[72px]",
          !collapsed && "md:pl-[240px]"
        )}
      >
        <AppHeader
          title={meta.title}
          subtitle={meta.subtitle}
          onMenu={() => setMobileOpen(true)}
          onAskAi={() => setAiOpen(true)}
          onReseed={reseed}
          reseeding={reseeding}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {view === "dashboard" && <DashboardView refreshSignal={refreshSignal} onNavigate={navigate} />}
              {view === "materials" && <RawMaterialsView refreshSignal={refreshSignal} onMutate={bump} />}
              {view === "processing" && <ProcessingView refreshSignal={refreshSignal} onMutate={bump} />}
              {view === "products" && <ProductsView refreshSignal={refreshSignal} onMutate={bump} />}
              {view === "partners" && <PartnersView refreshSignal={refreshSignal} onMutate={bump} />}
              {view === "invoicing" && <InvoicingView refreshSignal={refreshSignal} onMutate={bump} />}
              {view === "traceability" && <TraceabilityView />}
              {view === "ledger" && <AuditLedgerView />}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="mt-auto border-t border-border/60 py-4">
          <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 px-4 text-xs text-muted-foreground md:px-8">
            <span>© {new Date().getFullYear()} Timber Atelier ERP</span>
            <span className="inline-flex items-center gap-1.5">
              <TimberMark className="size-4" />
              Timber ERP · Crafted with precision
            </span>
          </div>
        </footer>
      </div>

      {/* Command palette (⌘K) — client-only mount */}
      {paletteMounted && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onNavigate={navigate}
          onAskAi={() => setAiOpen(true)}
          onReseed={reseed}
          onToggleTheme={toggleTheme}
          onExportLedger={() => void exportLedger()}
        />
      )}

      {/* AI assistant drawer */}
      <AiAssistant open={aiOpen} onOpenChange={setAiOpen} />
    </div>
  );
}
