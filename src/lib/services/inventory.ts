import type { Prisma, RawMaterial, FinishedProduct } from "@prisma/client";
import { InsufficientStockError, NotFoundError, round2 } from "@/lib/api-error";

// ─────────────────────────────────────────────────────────────
// Atomic stock helpers.
// Deducts use the conditional-update pattern:
//   UPDATE … SET stock = stock - qty WHERE id = ? AND stock >= qty
// and inspect `count` so concurrent transactions can never drive
// stock negative. Always call these INSIDE a db.$transaction and
// pair them with a ledger entry (recordMovement).
// ─────────────────────────────────────────────────────────────

export type StockModel = "rawMaterial" | "finishedProduct";

/**
 * Atomically decrements stock. Throws:
 *  - NotFoundError (404) when the item does not exist
 *  - InsufficientStockError (400) when available < requested
 * Returns the item AFTER the decrement.
 */
export async function deductStock(
  tx: Prisma.TransactionClient,
  model: StockModel,
  id: number,
  qty: number
): Promise<RawMaterial | FinishedProduct> {
  if (model === "rawMaterial") {
    const result = await tx.rawMaterial.updateMany({
      where: { id, currentStock: { gte: qty } },
      data: { currentStock: { decrement: qty } },
    });
    if (result.count === 0) {
      const item = await tx.rawMaterial.findUnique({ where: { id } });
      if (!item) throw new NotFoundError(`Raw material with id ${id} not found.`);
      throw new InsufficientStockError(
        `Insufficient stock for ${item.name}. Available: ${item.currentStock}, Requested: ${qty}`
      );
    }
    const item = await tx.rawMaterial.findUniqueOrThrow({ where: { id } });
    return { ...item, currentStock: round2(item.currentStock) };
  }

  const result = await tx.finishedProduct.updateMany({
    where: { id, currentStock: { gte: qty } },
    data: { currentStock: { decrement: qty } },
  });
  if (result.count === 0) {
    const item = await tx.finishedProduct.findUnique({ where: { id } });
    if (!item) throw new NotFoundError(`Finished product with id ${id} not found.`);
    throw new InsufficientStockError(
      `Insufficient stock for ${item.name}. Available: ${item.currentStock}, Requested: ${qty}`
    );
  }
  const item = await tx.finishedProduct.findUniqueOrThrow({ where: { id } });
  return { ...item, currentStock: round2(item.currentStock) };
}

/**
 * Atomically increments stock. Throws NotFoundError when missing.
 * Returns the item AFTER the increment.
 */
export async function addStock(
  tx: Prisma.TransactionClient,
  model: StockModel,
  id: number,
  qty: number
): Promise<RawMaterial | FinishedProduct> {
  if (model === "rawMaterial") {
    const result = await tx.rawMaterial.updateMany({
      where: { id },
      data: { currentStock: { increment: qty } },
    });
    if (result.count === 0) {
      throw new NotFoundError(`Raw material with id ${id} not found.`);
    }
    const item = await tx.rawMaterial.findUniqueOrThrow({ where: { id } });
    return { ...item, currentStock: round2(item.currentStock) };
  }

  const result = await tx.finishedProduct.updateMany({
    where: { id },
    data: { currentStock: { increment: qty } },
  });
  if (result.count === 0) {
    throw new NotFoundError(`Finished product with id ${id} not found.`);
  }
  const item = await tx.finishedProduct.findUniqueOrThrow({ where: { id } });
  return { ...item, currentStock: round2(item.currentStock) };
}
