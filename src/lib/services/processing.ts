import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DuplicateCancellationError,
  NotFoundError,
  ValidationError,
  round2,
} from "@/lib/api-error";
import { recordMovement } from "@/lib/services/ledger";
import { deductStock, addStock } from "@/lib/services/inventory";
import { nextNumberFromList } from "@/lib/services/sequence";
import { toISO } from "@/lib/serialize";
import type {
  CreateBatchRequest,
  ProcessingBatch,
  BatchInputItem,
  BatchOutputItem,
  OutputType,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Processing service — multi-input / multi-output conversion
// batches with full ledger coverage. Everything runs inside a
// single interactive transaction: any failure rolls back ALL
// stock movements (they never happen without their ledger row).
// ─────────────────────────────────────────────────────────────

export type BatchWithRelations = Prisma.ProcessingBatchGetPayload<{
  include: {
    inputs: { include: { rawMaterial: true } };
    outputs: { include: { product: true } };
  };
}>;

/** Maps a Prisma batch (+relations) to the shared ProcessingBatch contract shape. */
export function mapBatch(batch: BatchWithRelations): ProcessingBatch {
  return {
    id: batch.id,
    batchNumber: batch.batchNumber,
    processingDate: toISO(batch.processingDate),
    notes: batch.notes,
    wastePercentage: round2(batch.wastePercentage),
    totalInputQty: round2(batch.totalInputQty),
    totalOutputQty: round2(batch.totalOutputQty),
    totalWasteQty: round2(batch.totalWasteQty),
    status: batch.status as ProcessingBatch["status"],
    cancellationReason: batch.cancellationReason,
    cancelledAt: batch.cancelledAt ? toISO(batch.cancelledAt) : null,
    inputs: batch.inputs.map(
      (i): BatchInputItem => ({
        id: i.id,
        rawMaterialId: i.rawMaterialId,
        rawMaterialName: i.rawMaterial.name,
        lotNumber: i.lotNumber,
        quantityConsumed: round2(i.quantityConsumed),
        unit: i.unit,
      })
    ),
    outputs: batch.outputs.map(
      (o): BatchOutputItem => ({
        id: o.id,
        productId: o.productId,
        productName: o.product?.name ?? (o.outputType === "WASTE" ? "Waste" : undefined),
        lotNumber: o.lotNumber,
        outputType: o.outputType as OutputType,
        quantityProduced: round2(o.quantityProduced),
        unit: o.unit,
      })
    ),
  };
}

/**
 * Generates PB-XXXX inside the transaction: first attempt is
 * count+1, then any unique collision falls back to MAX(numeric
 * suffix)+1 until a free number is found.
 */
async function nextBatchNumber(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.processingBatch.count();
  let candidate = `PB-${String(count + 1).padStart(4, "0")}`;

  for (let attempt = 0; attempt < 25; attempt++) {
    const clash = await tx.processingBatch.findUnique({ where: { batchNumber: candidate } });
    if (!clash) return candidate;
    const existing = await tx.processingBatch.findMany({
      where: { batchNumber: { startsWith: "PB-" } },
      select: { batchNumber: true },
    });
    candidate = nextNumberFromList(existing.map((b) => b.batchNumber), "PB");
  }
  throw new Error("Unable to allocate a unique batch number after 25 attempts.");
}

function parseDate(value: string | undefined, field: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ValidationError(`${field} is not a valid ISO date string.`);
  return d;
}

/**
 * Creates a COMPLETED processing batch:
 *  - inputs  → atomic deductStock + BatchInputItem + PROCESSING_INPUT ledger row
 *  - outputs → FINISHED/SECONDARY: atomic addStock + BatchOutputItem + PROCESSING_OUTPUT ledger row
 *              WASTE: BatchOutputItem only (productId null, no stock/ledger change)
 * Totals: totalOutputQty counts FINISHED+SECONDARY only; waste is tracked separately.
 */
export async function createProcessingBatch(data: CreateBatchRequest): Promise<ProcessingBatch> {
  const processingDate = parseDate(data.processingDate, "processingDate");

  return db.$transaction(async (tx) => {
    const batchNumber = await nextBatchNumber(tx);

    // ── Validate everything BEFORE mutating any stock ──
    const materialIds = new Map<number, { name: string }>();
    for (const input of data.inputs) {
      const material = await tx.rawMaterial.findUnique({ where: { id: input.rawMaterialId } });
      if (!material) {
        throw new NotFoundError(`Raw material with id ${input.rawMaterialId} not found.`);
      }
      materialIds.set(input.rawMaterialId, material);
    }

    const productIds = new Map<number, { name: string }>();
    for (const output of data.outputs) {
      if (output.outputType === "WASTE") continue;
      if (output.productId == null) {
        throw new ValidationError(
          `Output "${output.lotNumber}" of type ${output.outputType} requires a productId.`
        );
      }
      const product = await tx.finishedProduct.findUnique({ where: { id: output.productId } });
      if (!product) {
        throw new NotFoundError(`Finished product with id ${output.productId} not found.`);
      }
      productIds.set(output.productId, product);
    }

    // ── Inputs: deduct + ledger (balanceAfter from post-deduction item) ──
    const inputRows: { rawMaterialId: number; lotNumber: string; quantityConsumed: number; unit: string }[] = [];
    for (const input of data.inputs) {
      const material = materialIds.get(input.rawMaterialId)!;
      const updated = await deductStock(tx, "rawMaterial", input.rawMaterialId, input.quantity);
      await recordMovement(tx, {
        itemType: "RAW_MATERIAL",
        itemId: input.rawMaterialId,
        itemName: material.name,
        referenceType: "PROCESSING_INPUT",
        referenceNumber: batchNumber,
        lotNumber: input.lotNumber,
        stockOut: input.quantity,
        balanceAfter: updated.currentStock,
        notes: `Consumed by processing batch ${batchNumber}`,
      });
      inputRows.push({
        rawMaterialId: input.rawMaterialId,
        lotNumber: input.lotNumber,
        quantityConsumed: input.quantity,
        unit: updated.unit,
      });
    }

    // ── Outputs: add + ledger for FINISHED/SECONDARY; WASTE is bookkeeping only ──
    const outputRows: { productId: number | null; lotNumber: string; outputType: OutputType; quantityProduced: number; unit: string }[] = [];
    for (const output of data.outputs) {
      if (output.outputType === "WASTE") {
        outputRows.push({
          productId: null,
          lotNumber: output.lotNumber,
          outputType: "WASTE",
          quantityProduced: output.quantity,
          unit: "CFT",
        });
        continue;
      }
      const product = productIds.get(output.productId!)!;
      const updated = await addStock(tx, "finishedProduct", output.productId!, output.quantity);
      await recordMovement(tx, {
        itemType: "FINISHED_PRODUCT",
        itemId: output.productId!,
        itemName: product.name,
        referenceType: "PROCESSING_OUTPUT",
        referenceNumber: batchNumber,
        lotNumber: output.lotNumber,
        stockIn: output.quantity,
        balanceAfter: updated.currentStock,
        notes: `Produced by processing batch ${batchNumber}`,
      });
      outputRows.push({
        productId: output.productId!,
        lotNumber: output.lotNumber,
        outputType: output.outputType,
        quantityProduced: output.quantity,
        unit: updated.unit,
      });
    }

    // ── Totals (per contract: totalOutputQty excludes waste) ──
    const totalInputQty = round2(inputRows.reduce((s, i) => s + i.quantityConsumed, 0));
    const totalOutputQty = round2(
      outputRows
        .filter((o) => o.outputType !== "WASTE")
        .reduce((s, o) => s + o.quantityProduced, 0)
    );
    const totalWasteQty = round2(
      outputRows.filter((o) => o.outputType === "WASTE").reduce((s, o) => s + o.quantityProduced, 0)
    );
    const wastePercentage =
      totalInputQty > 0 ? round2((totalWasteQty / totalInputQty) * 100) : 0;

    const batch = await tx.processingBatch.create({
      data: {
        batchNumber,
        processingDate,
        notes: data.notes ?? null,
        wastePercentage,
        totalInputQty,
        totalOutputQty,
        totalWasteQty,
        status: "COMPLETED",
      },
    });

    await tx.batchInputItem.createMany({
      data: inputRows.map((i) => ({ ...i, batchId: batch.id })),
    });
    await tx.batchOutputItem.createMany({
      data: outputRows.map((o) => ({ ...o, batchId: batch.id })),
    });

    const full = await tx.processingBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: {
        inputs: { include: { rawMaterial: true } },
        outputs: { include: { product: true } },
      },
    });
    return mapBatch(full);
  });
}

/** Latest batches, newest first, with input/output names resolved. */
export async function listBatches(take?: number): Promise<ProcessingBatch[]> {
  const batches = await db.processingBatch.findMany({
    orderBy: [{ processingDate: "desc" }, { id: "desc" }],
    ...(take ? { take } : {}),
    include: {
      inputs: { include: { rawMaterial: true } },
      outputs: { include: { product: true } },
    },
  });
  return batches.map(mapBatch);
}

/** Single batch by id (404 if missing) with names resolved. */
export async function getBatch(id: number): Promise<ProcessingBatch> {
  const batch = await db.processingBatch.findUnique({
    where: { id },
    include: {
      inputs: { include: { rawMaterial: true } },
      outputs: { include: { product: true } },
    },
  });
  if (!batch) throw new NotFoundError(`Processing batch with id ${id} not found.`);
  return mapBatch(batch);
}

/**
 * Cancels a COMPLETED batch with full stock reversal, mirroring the
 * invoice-cancel pattern:
 *  - inputs  → addStock back to raw materials (stockIn, BATCH_CANCELLATION)
 *  - outputs → deductStock from finished products (stockOut)
 *  WASTE rows carry no stock, so nothing to reverse for them.
 *  If any produced output has already been sold (stock below the produced
 *  quantity), the whole cancellation is refused → 400, nothing mutates.
 *  Cancelling twice → 409.
 */
export async function cancelBatch(batchId: number, reason: string): Promise<ProcessingBatch> {
  return db.$transaction(async (tx) => {
    const batch = await tx.processingBatch.findUnique({
      where: { id: batchId },
      include: {
        inputs: { include: { rawMaterial: true } },
        outputs: { include: { product: true } },
      },
    });
    if (!batch) throw new NotFoundError(`Processing batch with id ${batchId} not found.`);
    if (batch.status === "CANCELLED") {
      throw new DuplicateCancellationError(`Batch ${batch.batchNumber} is already cancelled.`);
    }

    // ── Validate BEFORE mutating: every output must still be in stock ──
    const productOutputs = batch.outputs.filter(
      (o) => o.outputType !== "WASTE" && o.productId != null
    );
    for (const output of productOutputs) {
      const product = await tx.finishedProduct.findUnique({
        where: { id: output.productId! },
      });
      if (!product) {
        throw new NotFoundError(
          `Finished product with id ${output.productId} not found.`
        );
      }
      if (product.currentStock + 1e-9 < output.quantityProduced) {
        throw new ValidationError(
          `Cannot reverse batch ${batch.batchNumber}: ${product.name} stock ` +
            `(${round2(product.currentStock)} ${product.unit}) is less than the produced ` +
            `quantity (${round2(output.quantityProduced)} ${product.unit}) — some output ` +
            `has already been sold. Cancel or reverse the related invoices first.`
        );
      }
    }

    const revRef = `REV-${batch.batchNumber}`;

    // ── Inputs: return consumed raw material to stock ──
    for (const input of batch.inputs) {
      const updated = await addStock(tx, "rawMaterial", input.rawMaterialId, input.quantityConsumed);
      await recordMovement(tx, {
        itemType: "RAW_MATERIAL",
        itemId: input.rawMaterialId,
        itemName: input.rawMaterial.name,
        referenceType: "BATCH_CANCELLATION",
        referenceNumber: revRef,
        lotNumber: input.lotNumber,
        stockIn: input.quantityConsumed,
        balanceAfter: updated.currentStock,
        notes: `Reversal of batch ${batch.batchNumber}: ${reason}`,
      });
    }

    // ── Outputs: pull produced quantities back out of stock ──
    for (const output of productOutputs) {
      const updated = await deductStock(
        tx,
        "finishedProduct",
        output.productId!,
        output.quantityProduced
      );
      await recordMovement(tx, {
        itemType: "FINISHED_PRODUCT",
        itemId: output.productId!,
        itemName: output.product?.name ?? `Product #${output.productId}`,
        referenceType: "BATCH_CANCELLATION",
        referenceNumber: revRef,
        lotNumber: output.lotNumber,
        stockOut: output.quantityProduced,
        balanceAfter: updated.currentStock,
        notes: `Reversal of batch ${batch.batchNumber}: ${reason}`,
      });
    }

    await tx.processingBatch.update({
      where: { id: batch.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    const full = await tx.processingBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: {
        inputs: { include: { rawMaterial: true } },
        outputs: { include: { product: true } },
      },
    });
    return mapBatch(full);
  });
}
