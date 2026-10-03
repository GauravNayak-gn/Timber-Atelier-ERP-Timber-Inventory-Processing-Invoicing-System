"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Building2,
  CalendarClock,
  IndianRupee,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, SectionHeading, SkeletonGrid } from "@/components/timber/primitives";
import { PartnerDrawer } from "@/components/timber/partner-drawer";
import { useAppAction } from "@/components/timber/actions";
import { useApi } from "@/components/timber/hooks";
import { api } from "@/lib/api-client";
import { formatDate, formatINR } from "@/lib/format";
import type { PartnerCustomer, PartnerStats, PartnerSupplier } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* Stagger helpers */
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
};

export function PartnersView({ refreshSignal, onMutate }: { refreshSignal: number; onMutate: () => void }) {
  const { toast } = useToast();
  const partners = useApi<PartnerStats>("/api/partners", [refreshSignal]);
  const [tab, setTab] = React.useState<"suppliers" | "customers">("suppliers");
  const [query, setQuery] = React.useState("");
  const [addSupplierOpen, setAddSupplierOpen] = React.useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = React.useState(false);
  const [drill, setDrill] = React.useState<{
    kind: "supplier" | "customer";
    partner: PartnerSupplier | PartnerCustomer;
  } | null>(null);
  // Set when a "pay bill" deep-link opens the drawer — auto-opens the Pay
  // dialog on the supplier's most-outstanding bill once payables load.
  const [autoPay, setAutoPay] = React.useState(false);

  const suppliers = (partners.data?.suppliers ?? []).filter((s) =>
    s.companyName.toLowerCase().includes(query.trim().toLowerCase())
  );
  const customers = (partners.data?.customers ?? []).filter((c) =>
    c.companyName.toLowerCase().includes(query.trim().toLowerCase())
  );

  // Deep-link (dashboard "Payments due" rows / command palette): open the
  // supplier payables drawer even if the partners list is still loading —
  // a minimal stub carries id+name; the drawer fetches everything else itself.
  const openSupplierDirect = React.useCallback((supplierId: number, supplierName: string) => {
    setTab("suppliers");
    const known = partners.data?.suppliers.find((s) => s.id === supplierId);
    setDrill({
      kind: "supplier",
      partner:
        known ?? {
          id: supplierId,
          companyName: supplierName,
          purchaseCount: 0,
          purchaseValue: 0,
          totalQuantity: 0,
          lastPurchaseDate: null,
          materials: [],
        },
    });
  }, [partners.data]);

  const onQuickAction = React.useCallback(
    (action: {
      type: string;
      supplierId?: number;
      supplierName?: string;
    }) => {
      if (action.type === "open-supplier" && action.supplierId) {
        openSupplierDirect(action.supplierId, action.supplierName ?? "Supplier");
      }
      if (action.type === "open-supplier-pay" && action.supplierId) {
        openSupplierDirect(action.supplierId, action.supplierName ?? "Supplier");
        setAutoPay(true);
      }
    },
    [openSupplierDirect]
  );
  useAppAction(onQuickAction);

  const totals = React.useMemo(() => {
    const s = partners.data?.suppliers ?? [];
    const c = partners.data?.customers ?? [];
    return {
      supplierCount: s.length,
      purchaseValue: s.reduce((acc, x) => acc + x.purchaseValue, 0),
      customerCount: c.length,
      billedValue: c.reduce((acc, x) => acc + x.totalBilled, 0),
    };
  }, [partners.data]);

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Partners"
        sub={`${totals.supplierCount} supplier${totals.supplierCount === 1 ? "" : "s"} · ${totals.customerCount} customer${totals.customerCount === 1 ? "" : "s"} · sourced ${formatINR(totals.purchaseValue, { decimals: 0 })} · billed ${formatINR(totals.billedValue, { decimals: 0 })}`}
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search partners…"
              aria-label="Search partners"
              className="h-9 w-44 pl-8 sm:w-56"
            />
          </div>
          <Button
            variant={tab === "suppliers" ? "default" : "outline"}
            onClick={() => setAddSupplierOpen(true)}
            className="hidden sm:inline-flex"
          >
            <Truck className="size-4" /> Add Supplier
          </Button>
          <Button
            variant={tab === "customers" ? "default" : "outline"}
            onClick={() => setAddCustomerOpen(true)}
            className="hidden sm:inline-flex"
          >
            <UserPlus className="size-4" /> Add Customer
          </Button>
          {/* Mobile: single adaptive add button */}
          <Button className="sm:hidden" onClick={() => (tab === "suppliers" ? setAddSupplierOpen(true) : setAddCustomerOpen(true))}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
      </SectionHeading>

      {partners.loading && !partners.data ? (
        <SkeletonGrid count={4} />
      ) : partners.error ? (
        <ErrorState message={partners.error} onRetry={partners.reload} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "suppliers" | "customers")}>
          <TabsList className="bg-secondary/70">
            <TabsTrigger value="suppliers" className="gap-1.5">
              <Truck className="size-3.5" /> Suppliers
              <Badge variant="outline" className="ml-1 border-border bg-background/60 font-mono text-[10px]">
                {suppliers.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="customers" className="gap-1.5">
              <Users className="size-3.5" /> Customers
              <Badge variant="outline" className="ml-1 border-border bg-background/60 font-mono text-[10px]">
                {customers.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suppliers" className="mt-4">
            {suppliers.length === 0 ? (
              <EmptyState
                icon={Truck}
                title={query ? "No suppliers match your search" : "No suppliers yet"}
                hint="Add the mills and depots you source timber from to track purchase history."
                action={
                  <Button variant="outline" size="sm" onClick={() => setAddSupplierOpen(true)}>
                    <Plus className="size-3.5" /> Add Supplier
                  </Button>
                }
              />
            ) : (
              <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              >
                {suppliers.map((s) => (
                  <SupplierCard key={s.id} supplier={s} onOpen={() => setDrill({ kind: "supplier", partner: s })} />
                ))}
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="customers" className="mt-4">
            {customers.length === 0 ? (
              <EmptyState
                icon={Users}
                title={query ? "No customers match your search" : "No customers yet"}
                hint="Customers are billed through GST invoices; add them here first."
                action={
                  <Button variant="outline" size="sm" onClick={() => setAddCustomerOpen(true)}>
                    <Plus className="size-3.5" /> Add Customer
                  </Button>
                }
              />
            ) : (
              <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              >
                {customers.map((c) => (
                  <CustomerCard key={c.id} customer={c} onOpen={() => setDrill({ kind: "customer", partner: c })} />
                ))}
              </motion.div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <AddPartnerDialog
        kind="supplier"
        open={addSupplierOpen}
        onOpenChange={setAddSupplierOpen}
        onDone={() => {
          partners.reload();
          onMutate();
        }}
        notify={toast}
      />
      <AddPartnerDialog
        kind="customer"
        open={addCustomerOpen}
        onOpenChange={setAddCustomerOpen}
        onDone={() => {
          partners.reload();
          onMutate();
        }}
        notify={toast}
      />

      <PartnerDrawer
        kind={drill?.kind ?? "supplier"}
        partner={drill?.partner ?? null}
        open={drill !== null}
        autoPay={autoPay}
        onOpenChange={(o) => {
          if (!o) {
            setDrill(null);
            setAutoPay(false);
          }
        }}
    />
    </div>
  );
}

/* ── Supplier card ── */

function SupplierCard({ supplier: s, onOpen }: { supplier: PartnerSupplier; onOpen: () => void }) {
  return (
    <motion.div variants={item}>
      <Card
        role="button"
        tabIndex={0}
        aria-label={`View purchase history for ${s.companyName}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="group h-full cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardContent className="flex h-full flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                <Truck className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-display truncate text-[15px] font-semibold leading-tight">{s.companyName}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {s.contactPerson ?? "—"}
                </p>
              </div>
            </div>
            {s.gstNumber ? (
              <Badge variant="outline" className="shrink-0 border-border bg-secondary/70 font-mono text-[9px] tracking-wide">
                GST
              </Badge>
            ) : null}
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            {s.phone ? (
              <p className="flex items-center gap-2">
                <Phone className="size-3 shrink-0" />
                <span className="truncate">{s.phone}</span>
              </p>
            ) : null}
            {s.email ? (
              <p className="flex items-center gap-2">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{s.email}</span>
              </p>
            ) : null}
            {s.gstNumber ? (
              <p className="truncate font-mono text-[10px] tracking-wide text-muted-foreground/80">{s.gstNumber}</p>
            ) : null}
          </div>

          <div className="mt-auto grid grid-cols-3 gap-2 rounded-lg border border-border/70 bg-secondary/40 p-3 text-center">
            <div>
              <p className="tnum font-mono text-sm font-semibold">{s.purchaseCount}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Purchases</p>
            </div>
            <div>
              <p className="tnum font-mono text-sm font-semibold text-primary">
                {formatINR(s.purchaseValue, { decimals: 0 })}
              </p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Sourced</p>
            </div>
            <div>
              <p className="tnum font-mono text-sm font-semibold">{formatDate(s.lastPurchaseDate)}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Last PO</p>
            </div>
          </div>

          {s.materials.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {s.materials.map((m) => (
                <Badge
                  key={m}
                  variant="outline"
                  className="border-border bg-background/60 text-[10px] text-muted-foreground"
                >
                  {m}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[11px] italic text-muted-foreground/70">No purchases recorded yet</p>
          )}

          <p className="text-center text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            Click to view purchase history →
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ── Customer card ── */

function CustomerCard({ customer: c, onOpen }: { customer: PartnerCustomer; onOpen: () => void }) {
  return (
    <motion.div variants={item}>
      <Card
        role="button"
        tabIndex={0}
        aria-label={`View invoice history for ${c.companyName}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="group h-full cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardContent className="flex h-full flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                <Building2 className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-display truncate text-[15px] font-semibold leading-tight">{c.companyName}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.contactPerson ?? "—"}</p>
              </div>
            </div>
            {c.cancelledCount > 0 ? (
              <Badge
                variant="outline"
                className="shrink-0 border-amber-200 bg-amber-50 text-[9px] uppercase tracking-wider text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
              >
                {c.cancelledCount} cancelled
              </Badge>
            ) : null}
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            {c.phone ? (
              <p className="flex items-center gap-2">
                <Phone className="size-3 shrink-0" />
                <span className="truncate">{c.phone}</span>
              </p>
            ) : null}
            {c.email ? (
              <p className="flex items-center gap-2">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{c.email}</span>
              </p>
            ) : null}
            {c.billingAddress ? (
              <p className="flex items-center gap-2">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{c.billingAddress}</span>
              </p>
            ) : null}
            {c.gstNumber ? (
              <p className="truncate font-mono text-[10px] tracking-wide text-muted-foreground/80">{c.gstNumber}</p>
            ) : null}
          </div>

          <div className="mt-auto grid grid-cols-3 gap-2 rounded-lg border border-border/70 bg-secondary/40 p-3 text-center">
            <div>
              <p className="tnum font-mono text-sm font-semibold">{c.confirmedCount}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Invoices</p>
            </div>
            <div>
              <p className="tnum font-mono text-sm font-semibold text-primary">
                {formatINR(c.totalBilled, { decimals: 0 })}
              </p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Billed</p>
            </div>
            <div>
              <p className="tnum font-mono text-sm font-semibold">{formatDate(c.lastInvoiceDate)}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Last bill</p>
            </div>
          </div>

          <p className="text-center text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            Click to view invoice history →
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ── Add partner dialog (supplier | customer) ── */

type Notify = ReturnType<typeof useToast>["toast"];

const EMPTY_FORM = {
  companyName: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  gstNumber: "",
};

function AddPartnerDialog({
  kind,
  open,
  onOpenChange,
  onDone,
  notify,
}: {
  kind: "supplier" | "customer";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  notify: Notify;
}) {
  const isSupplier = kind === "supplier";
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setForm(EMPTY_FORM);
  }, [open]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const valid = form.companyName.trim().length >= 2;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      if (isSupplier) {
        await api.createSupplier({
          companyName: form.companyName.trim(),
          contactPerson: form.contactPerson.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          gstNumber: form.gstNumber.trim().toUpperCase() || undefined,
        });
      } else {
        await api.createCustomer({
          companyName: form.companyName.trim(),
          contactPerson: form.contactPerson.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          billingAddress: form.address.trim() || undefined,
          shippingAddress: form.address.trim() || undefined,
          gstNumber: form.gstNumber.trim().toUpperCase() || undefined,
        });
      }
      notify({
        title: isSupplier ? "Supplier added" : "Customer added",
        description: `${form.companyName.trim()} is ready for ${isSupplier ? "purchase orders" : "GST invoicing"}.`,
      });
      onOpenChange(false);
      onDone();
    } catch (e) {
      notify({
        title: "Could not save partner",
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
          <DialogTitle className="font-display">{isSupplier ? "Add Supplier" : "Add Customer"}</DialogTitle>
          <DialogDescription>
            {isSupplier
              ? "Register a mill or depot to attribute purchase orders and lots."
              : "Register a buyer for GST invoicing with billing details."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor="pt-name">Company name *</Label>
            <Input
              id="pt-name"
              value={form.companyName}
              onChange={set("companyName")}
              placeholder={isSupplier ? "Greenply Timber Ltd" : "ABC Furniture Pvt Ltd"}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pt-contact">Contact person</Label>
              <Input id="pt-contact" value={form.contactPerson} onChange={set("contactPerson")} placeholder="Priya Sharma" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-phone">Phone</Label>
              <Input id="pt-phone" value={form.phone} onChange={set("phone")} placeholder="+91 98xxx xxxxx" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pt-email">Email</Label>
            <Input id="pt-email" type="email" value={form.email} onChange={set("email")} placeholder="orders@company.in" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pt-addr">{isSupplier ? "Address" : "Billing address"}</Label>
            <Input id="pt-addr" value={form.address} onChange={set("address")} placeholder="Street, city, state, PIN" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pt-gst">GST number</Label>
            <Input
              id="pt-gst"
              value={form.gstNumber}
              onChange={set("gstNumber")}
              placeholder="27AABCA1234A1Z5"
              className="font-mono uppercase"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <IndianRupee className="size-4" />}
            {isSupplier ? "Add supplier" : "Add customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
