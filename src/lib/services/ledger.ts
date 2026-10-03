import type { Prisma } from "@prisma/client";
import { InsufficientStockError, round2 } from "@/lib/api-error";

// ─────────────────────────────────────────────────────────────
// Ledger service — append-only InventoryTransaction writer.
// Stock is NEVER mutated without a matching ledger entry in the
// same transaction; balanceAfter is computed by the caller from
// the item state AFTER its mutation was applied.
// ─────────────────────────────────────────────────────────────

export interface MovementInput {
  itemType: string; // RAW_MATERIAL | FINISHED_PRODUCT
  itemId: number;
  itemName: string;
  referenceType: string; // PURCHASE | PROCESSING_INPUT | PROCESSING_OUTPUT | SALE | INVOICE_CANCELLATION | ADJUSTMENT
  referenceNumber: string;
  lotNumber: string;
  stockIn?: number;
  stockOut?: number;
  /** Item's current stock AFTER the caller applied its mutation. */
  balanceAfter: number;
  unitRate?: number;
  supplierId?: number | null;
  notes?: string | null;
}

/**
 * Records an immutable ledger row for a stock movement.
 * Throws InsufficientStockError if the resulting balance is negative —
 * this is a last-resort guard; callers are expected to enforce the
 * atomic conditional-update pattern (see inventory.ts).
 */
export async function recordMovement(tx: Prisma.TransactionClient, m: MovementInput) {
  const balanceAfter = round2(m.balanceAfter);
  if (balanceAfter < 0) {
    throw new InsufficientStockError(
      `Insufficient stock for ${m.itemName}. Balance after movement would be ${balanceAfter}.`
    );
  }

  return tx.inventoryTransaction.create({
    data: {
      itemType: m.itemType,
      itemId: m.itemId,
      itemName: m.itemName,
      referenceType: m.referenceType,
      referenceNumber: m.referenceNumber,
      lotNumber: m.lotNumber,
      stockIn: round2(m.stockIn ?? 0),
      stockOut: round2(m.stockOut ?? 0),
      balanceAfter,
      unitRate: round2(m.unitRate ?? 0),
      supplierId: m.supplierId ?? null,
      notes: m.notes ?? null,
    },
  });
}
