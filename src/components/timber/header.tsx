"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Command, DatabaseZap, Loader2, Menu, Moon, Sparkles, Sun } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  title: string;
  subtitle: string;
  onMenu: () => void;
  onAskAi: () => void;
  onReseed: () => Promise<void>;
  reseeding: boolean;
  onOpenPalette: () => void;
}

export function AppHeader({ title, subtitle, onMenu, onAskAi, onReseed, reseeding, onOpenPalette }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-4 md:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenu}
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>

        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-lg font-semibold tracking-tight md:text-[22px]">
            {title}
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Command palette trigger (⌘K) */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenPalette}
            aria-label="Open command palette"
            className="hidden h-9 gap-2 rounded-lg border-border/80 bg-card/50 pr-1.5 text-muted-foreground shadow-none md:inline-flex"
          >
            <Command className="size-3.5" />
            <span className="text-xs">Commands</span>
            <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[9px] text-muted-foreground">
              ⌘K
            </kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenPalette}
            aria-label="Open command palette"
            className="md:hidden"
          >
            <Command className="size-4" />
          </Button>

          {/* Seed / reset demo data — native title hint avoids the
              Tooltip×AlertDialogTrigger sandwich that skews Radix
              aria-controls ids during React 19 hydration. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reseed demo data"
                title="Reset & reseed demo data"
                disabled={reseeding}
              >
                {reseeding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <DatabaseZap className="size-4" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reseed demo data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This wipes all current suppliers, stock, batches and invoices, then restores the
                  assessment sample dataset (Teak/Pine/Plywood, batch PB-0001, invoice INV-0001).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep current data</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void onReseed();
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {reseeding ? <Loader2 className="size-4 animate-spin" /> : "Reseed database"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <ThemeToggle />

          <Button onClick={onAskAi} className="shadow-sm" aria-label="Open AI assistant">
            <Sparkles className="size-4" />
            <span className="hidden sm:inline">Ask AI</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          <Sun className={cn("size-4", !isDark && "hidden")} />
          <Moon className={cn("size-4", isDark && "hidden")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  );
}
