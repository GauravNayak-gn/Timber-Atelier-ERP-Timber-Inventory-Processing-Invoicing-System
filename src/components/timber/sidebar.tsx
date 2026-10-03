"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TimberMark } from "@/components/timber/logo";
import { NAV, type ViewId } from "@/components/timber/nav";
import { cn } from "@/lib/utils";

interface SidebarProps {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidebar({ active, onNavigate, collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
    >
      {/* Brand */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="flex h-16 w-full items-center gap-3 px-4 text-left"
      >
        <TimberMark className="size-9 text-sidebar-primary" />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="min-w-0"
            >
              <span className="font-display block truncate text-[15px] font-semibold leading-tight tracking-tight">
                Timber Atelier
              </span>
              <span className="block text-[10px] uppercase tracking-[0.22em] opacity-55">
                ERP · Est. Craft
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Nav */}
      <div className="mt-2 flex flex-1 flex-col overflow-y-auto">
        <nav aria-label="Primary" className="space-y-1 px-2.5">
          {NAV.map((item) => (
            <SidebarItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={active === item.id}
              collapsed={collapsed}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </nav>
      </div>

      {/* Status footer — ledger heartbeat */}
      <div
        className={cn(
          "border-t border-sidebar-border/60 py-3.5",
          collapsed ? "px-0" : "px-3.5"
        )}
      >
        {collapsed ? (
          <div className="flex justify-center">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Ledger live
            </span>
            <span className="font-mono text-[10px] text-sidebar-foreground/40">v1.9</span>
          </div>
        )}
      </div>

      {/* Collapse control */}
      <div className="px-3 pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </Button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right" className="bg-sidebar-primary text-sidebar-primary-foreground">
              Expand
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </motion.aside>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors",
            active
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            collapsed && "justify-center px-0"
          )}
        >
          {active && (
            <motion.span
              layoutId="timber-nav-bar"
              className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          <Icon className="size-[18px] shrink-0" />
          {!collapsed && <span className="truncate">{label}</span>}
        </button>
      </TooltipTrigger>
      {collapsed && (
        <TooltipContent side="right" className="bg-sidebar-primary text-sidebar-primary-foreground">
          {label}
        </TooltipContent>
      )}
    </Tooltip>
  );
}
