"use client";

import * as React from "react";
import { Loader2, PackagePlus, Plus, Scale, ShoppingCart, TreePine } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  SectionHeading,
  SkeletonGrid,
  StockBar,
} from "@/components/timber/primitives";
import { useApi } from "@/components/timber/hooks";
import { useAppAction } from "@/components/timber/actions";
import { AdjustStockDialog } from "@/components/timber/stock-adjust";
import { api, type CreateMaterialInput } from "@/lib/api-client";
import { formatINR, formatQty, parseNumber } from "@/lib/format";
import type { RawMaterial, Supplier } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PO_STORAGE_KEY = "timber:next-po";

export function RawMaterialsView({ refreshSignal, onMutate }: { refreshSignal: number; onMutate: () => void }) {
  const { toast } = useToast();
  const materials = useApi<RawMaterial[]>("/api/materials", [refreshSignal]);
  const suppliers = useApi<Supplier[]>("/api/suppliers", [refreshSignal]);

  const [purchaseOpen, setPurchaseOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);

  // Command palette quick action: open the purchase dialog directly.
  const onQuickAction = React.useCallback((action: { type: string }) => {
    if (action.type === "new-purchase") setPurchaseOpen(true);
  }, []);
  useAppAction(onQuickAction);

  const list = materials.data ?? [];

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Material Inventory"
        sub={`${list.length} raw material${list.length === 1 ? "" : "s"} tracked with lot-level lineage`}
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add Material
          </Button>
          <Button onClick={() => setPurchaseOpen(true)}>
            <ShoppingCart className="size-4" /> Record Purchase
          </Button>
        </div>
      </SectionHeading>

      {materials.loading && !materials.data ? (
        <SkeletonGrid count={6} />
      ) : materials.error ? (
        <ErrorState message={materials.error} onRetry={materials.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={TreePine}
          title="No raw materials yet"
          hint="Add your first material — teak, pine or plywood — then record an opening purchase."
          action={
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" /> Add Material
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m, i) => (
            <MaterialCard key={m.id} material={m} index={i} onChanged={onMutate} />
          ))}
        </div>
      )}

      <PurchaseDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        materials={list}
        suppliers={suppliers.data ?? []}
        onDone={() => {
          materials.reload();
          onMutate();
        }}
        notify={toast}
      />

      <AddMaterialDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={() => {
          materials.reload();
          onMutate();
        }}
        notify={toast}
      />
    </div>
  );
}

function MaterialCard({
  material: m,
  index,
  onChanged,
}: {
  material: RawMaterial;
  index: number;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const low = m.currentStock <= m.reorderThreshold;
  const out = m.currentStock <= 0;
  const max = Math.max(m.reorderThreshold * 1.5, m.currentStock, 1);
  const [adjustOpen, setAdjustOpen] = React.useState(false);
  return (
    <Card
      className="group transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display truncate text-lg font-semibold leading-tight">{m.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{m.category}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge
              variant="outline"
              className="border-border bg-secondary/70 font-mono text-[10px] tracking-wide text-muted-foreground"
            >
              {m.skuCode}
            </Badge>
            {low && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] uppercase tracking-wider",
                  out
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/50 dark:text-rose-300"
                    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/50 dark:text-amber-300"
                )}
              >
                {out ? "Out of stock" : "Low stock"}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono tnum text-3xl font-semibold leading-none tracking-tight">
              {formatQty(m.currentStock)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{m.unit} in stock</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Purchase rate</p>
            <p className="font-mono tnum text-sm font-medium">
              {formatINR(m.unitPurchaseRate)} <span className="text-muted-foreground">/ {m.unit}</span>
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Stock level</span>
            <span className="font-mono tnum">
              Reorder @ {formatQty(m.reorderThreshold)} {m.unit}
            </span>
          </div>
          <StockBar value={m.currentStock} max={max} tone={out ? "rose" : low ? "amber" : "emerald"} />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full text-xs"
          onClick={() => setAdjustOpen(true)}
        >
          <Scale className="size-3.5" /> Adjust stock
        </Button>
      </CardContent>

      <AdjustStockDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        itemType="RAW_MATERIAL"
        item={m}
        onDone={onChanged}
        notify={toast}
      />
    </Card>
  );
}

/* ── Record Purchase dialog ── */

interface Notify {
  (opts: { title: string; description?: string; variant?: "destructive" | undefined }): void;
}

function PurchaseDialog({
  open,
  onOpenChange,
  materials,
  suppliers,
  onDone,
  notify,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  materials: RawMaterial[];
  suppliers: Supplier[];
  onDone: () => void;
  notify: Notify;
}) {
  const [materialId, setMaterialId] = React.useState("");
  const [supplierId, setSupplierId] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [unitRate, setUnitRate] = React.useState("");
  const [lotNumber, setLotNumber] = React.useState("");
  const [poNumber, setPoNumber] = React.useState("");
  const [purchaseCount, setPurchaseCount] = React.useState<Record<number, number>>({});
  const [submitting, setSubmitting] = React.useState(false);

  // Reset form each time the dialog opens; prefill PO from localStorage.
  React.useEffect(() => {
    if (!open) return;
    setMaterialId("");
    setSupplierId("");
    setQuantity("");
    setUnitRate("");
    setLotNumber("");
    const saved = window.localStorage.getItem(PO_STORAGE_KEY);
    setPoNumber(saved ?? "PO-0001");
  }, [open]);

  const material = materials.find((m) => String(m.id) === materialId) ?? null;

  // Prefill rate + lot suggestion when material changes.
  React.useEffect(() => {
    if (!material) return;
    setUnitRate(String(material.unitPurchaseRate));
    const seg = material.skuCode.split("-").slice(1).join("-") || material.skuCode;
    const n = (purchaseCount[material.id] ?? 0) + 1;
    setLotNumber(`LOT-RAW-${seg}-${String(n).padStart(3, "0")}`);
  }, [materialId]);

  const qty = parseNumber(quantity);
  const rate = parseNumber(unitRate);
  const valid =
    materialId !== "" &&
    supplierId !== "" &&
    material != null &&
    Number.isFinite(qty) &&
    qty > 0 &&
    Number.isFinite(rate) &&
    rate >= 0 &&
    lotNumber.trim() !== "" &&
    poNumber.trim() !== "";

  const submit = async () => {
    if (!valid || !material) return;
    setSubmitting(true);
    try {
      await api.recordPurchase({
        materialId: material.id,
        supplierId: Number(supplierId),
        quantity: qty,
        unitRate: rate,
        lotNumber: lotNumber.trim(),
        poNumber: poNumber.trim(),
      });
      const nextN = (purchaseCount[material.id] ?? 0) + 1;
      setPurchaseCount((prev) => ({ ...prev, [material.id]: nextN }));

      // Bump PO number for the next purchase.
      const digits = Number(poNumber.replace(/\D/g, "")) || 0;
      const nextPo = `PO-${String(digits + 1).padStart(4, "0")}`;
      setPoNumber(nextPo);
      window.localStorage.setItem(PO_STORAGE_KEY, nextPo);

      notify({
        title: "Purchase recorded",
        description: `${formatQty(qty)} ${material.unit} of ${material.name} (${lotNumber.trim()}) added to stock.`,
      });
      onOpenChange(false);
      onDone();
    } catch (e) {
      notify({
        title: "Could not record purchase",
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
          <DialogTitle className="font-display">Record Purchase</DialogTitle>
          <DialogDescription>
            Receive raw material stock against a supplier PO — a ledger entry is created automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="p-material">Material</Label>
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger id="p-material" aria-label="Raw material">
                <SelectValue placeholder="Select material" />
              </SelectTrigger>
              <SelectContent>
                {materials.length === 0 && (
                  <SelectItem value="none" disabled>
                    No materials yet — add one first
                  </SelectItem>
                )}
                {materials.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name} · {formatQty(m.currentStock)} {m.unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="p-supplier">Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="p-supplier" aria-label="Supplier">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-qty">Quantity ({material?.unit ?? "unit"})</Label>
              <Input
                id="p-qty"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-rate">Unit rate (₹)</Label>
              <Input
                id="p-rate"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={unitRate}
                onChange={(e) => setUnitRate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-lot">Lot number</Label>
              <Input
                id="p-lot"
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
                placeholder="LOT-RAW-XXX-001"
                className="font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-po">PO number</Label>
              <Input
                id="p-po"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="PO-0001"
                className="font-mono"
              />
            </div>
          </div>

          {material && Number.isFinite(qty) && qty > 0 && (
            <p className="font-mono tnum text-xs text-muted-foreground">
              Line value: {formatINR(qty * (Number.isFinite(rate) ? rate : 0))} · new stock{" "}
              {formatQty(material.currentStock + qty)} {material.unit}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
            Record purchase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Add Material dialog ── */

function AddMaterialDialog({
  open,
  onOpenChange,
  onDone,
  notify,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  notify: Notify;
}) {
  const [form, setForm] = React.useState({
    name: "",
    skuCode: "",
    category: "",
    unit: "CFT",
    unitPurchaseRate: "",
    reorderThreshold: "100",
  });
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open)
      setForm({ name: "", skuCode: "", category: "", unit: "CFT", unitPurchaseRate: "", reorderThreshold: "100" });
  }, [open]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const rate = parseNumber(form.unitPurchaseRate);
  const threshold = parseNumber(form.reorderThreshold);
  const valid =
    form.name.trim() !== "" &&
    form.skuCode.trim() !== "" &&
    form.category.trim() !== "" &&
    form.unit.trim() !== "" &&
    Number.isFinite(rate) &&
    rate >= 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const body: CreateMaterialInput = {
        name: form.name.trim(),
        skuCode: form.skuCode.trim().toUpperCase(),
        category: form.category.trim(),
        unit: form.unit.trim(),
        unitPurchaseRate: rate,
        ...(Number.isFinite(threshold) ? { reorderThreshold: threshold } : {}),
      };
      await api.createMaterial(body);
      notify({ title: "Material added", description: `${body.name} is ready to receive stock.` });
      onOpenChange(false);
      onDone();
    } catch (e) {
      notify({
        title: "Could not add material",
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
          <DialogTitle className="font-display">Add Raw Material</DialogTitle>
          <DialogDescription>Create a new material master record.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="m-name">Name</Label>
              <Input id="m-name" value={form.name} onChange={set("name")} placeholder="Teak Timber" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="m-sku">SKU code</Label>
              <Input id="m-sku" value={form.skuCode} onChange={set("skuCode")} placeholder="RM-TEAK-002" className="font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="m-cat">Category</Label>
              <Input id="m-cat" value={form.category} onChange={set("category")} placeholder="Hardwood" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="m-unit">Unit</Label>
              <Input id="m-unit" value={form.unit} onChange={set("unit")} placeholder="CFT" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="m-rate">Unit purchase rate (₹)</Label>
              <Input id="m-rate" type="number" min="0" step="any" value={form.unitPurchaseRate} onChange={set("unitPurchaseRate")} placeholder="2000" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="m-threshold">Reorder threshold (optional)</Label>
              <Input id="m-threshold" type="number" min="0" step="any" value={form.reorderThreshold} onChange={set("reorderThreshold")} placeholder="100" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add material
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
