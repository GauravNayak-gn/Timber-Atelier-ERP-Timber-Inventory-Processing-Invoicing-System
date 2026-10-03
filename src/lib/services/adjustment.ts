import { db } from "@/lib/db";
import { NotFoundError, ValidationError, round2 } from "@/lib/api-error";
import { addStock, deductStock } from "@/lib/services/inventory";
import { recordMovement } from "@/lib/services/ledger";
import type { AdjustStockRequest, AdjustStockResponse, LedgerEntry, ItemType } from "@/lib/types";
import type { RawMaterial, FinishedProduct, InventoryTransaction } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Manual inventory adjustments — damage, shrinkage, recount
// corrections. Stock is never mutated without an ADJUSTMENT
// ledger row; the whole correction runs inside one transaction.
// ─────────────────────────────────────────────────────────────

/** ADJ-NNNN = count of existing adjustments + 1 (collision-safe retry). */
async function nextAdjustmentNumber(tx: {
  inventoryTransaction: {
    count: (args: { where: { referenceType: string } }) => Promise<number>;
    findFirst: (args: {
      where: { referenceType: string };
      select: { id: boolean };
    }) => Promise<{ id: number } | null>;
  };
}): Promise<string> {
  const count = await tx.inventoryTransaction.count({ where: { referenceType: "ADJUSTMENT" } });
  let candidate = `ADJ-${String(count + 1).padStart(4, "0")}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const clash = await tx.inventoryTransaction.findFirst({
      where: { referenceType: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `ADJ-${Date.now().toString(36).toUpperCase()}-${attempt + 1}`;
  }
  return `ADJ-${Date.now().toString(36).toUpperCase()}`;
}

function toLedgerEntry(row: InventoryTransaction): LedgerEntry {
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    itemType: row.itemType as ItemType,
    itemId: row.itemId,
    itemName: row.itemName,
    referenceType: row.referenceType as LedgerEntry["referenceType"],
    referenceNumber: row.referenceNumber,
    lotNumber: row.lotNumber,
    stockIn: round2(row.stockIn),
    stockOut: round2(row.stockOut),
    balanceAfter: round2(row.balanceAfter),
    unitRate: round2(row.unitRate),
    supplierId: row.supplierId,
    notes: row.notes,
  };
}

export async function adjustStock(req: AdjustStockRequest): Promise<AdjustStockResponse> {
  if (!Number.isInteger(req.itemId) || req.itemId <= 0) {
    throw new ValidationError("itemId must be a positive integer.");
  }
  if (!(req.quantity > 0)) {
    throw new ValidationError("quantity must be greater than 0.");
  }
  const reason = req.reason.trim();
  if (reason.length < 3) {
    throw new ValidationError("reason must be at least 3 characters.");
  }

  return db.$transaction(async (tx) => {
    let itemName: string;
    let unitRate: number;
    let updated: { currentStock: number } & (Partial<RawMaterial> | Partial<FinishedProduct>);

    if (req.itemType === "RAW_MATERIAL") {
      const material = await tx.rawMaterial.findUnique({ where: { id: req.itemId } });
      if (!material) throw new NotFoundError(`Raw material with id ${req.itemId} not found.`);
      itemName = material.name;
      unitRate = material.unitPurchaseRate;
      updated = req.direction === "IN"
        ? await addStock(tx, "rawMaterial", req.itemId, req.quantity)
        : await deductStock(tx, "rawMaterial", req.itemId, req.quantity);
    } else {
      const product = await tx.finishedProduct.findUnique({ where: { id: req.itemId } });
      if (!product) throw new NotFoundError(`Finished product with id ${req.itemId} not found.`);
      itemName = product.name;
      unitRate = product.sellingPrice;
      updated = req.direction === "IN"
        ? await addStock(tx, "finishedProduct", req.itemId, req.quantity)
        : await deductStock(tx, "finishedProduct", req.itemId, req.quantity);
    }

    const referenceNumber = await nextAdjustmentNumber(tx);
    const lotNumber = `ADJ-${new Date().toISOString().slice(0, 10)}`;

    const row = await recordMovement(tx, {
      itemType: req.itemType,
      itemId: req.itemId,
      itemName,
      referenceType: "ADJUSTMENT",
      referenceNumber,
      lotNumber,
      stockIn: req.direction === "IN" ? req.quantity : 0,
      stockOut: req.direction === "OUT" ? req.quantity : 0,
      balanceAfter: updated.currentStock,
      unitRate,
      notes: reason,
    });

    const item =
      req.itemType === "RAW_MATERIAL"
        ? await tx.rawMaterial.findUniqueOrThrow({ where: { id: req.itemId } })
        : await tx.finishedProduct.findUniqueOrThrow({ where: { id: req.itemId } });

    return {
      item: { ...item, currentStock: round2(item.currentStock) } as unknown as AdjustStockResponse["item"],
      entry: toLedgerEntry(row),
    };
  });
}
