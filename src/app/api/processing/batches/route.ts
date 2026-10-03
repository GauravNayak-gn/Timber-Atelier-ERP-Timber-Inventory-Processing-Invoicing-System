import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api-error";
import { createProcessingBatch, listBatches } from "@/lib/services/processing";
import { isoDate, optStr, parseBody, positiveQty, reqStr } from "@/lib/validation";

// GET /api/processing/batches — all batches (newest first) with names resolved
export async function GET() {
  try {
    const batches = await listBatches();
    return NextResponse.json(batches);
  } catch (e) {
    return handleApiError(e);
  }
}

const batchSchema = z.object({
  processingDate: isoDate.optional(),
  notes: optStr,
  inputs: z
    .array(
      z.object({
        rawMaterialId: z.number({ message: "rawMaterialId must be a number" }).int().positive(),
        lotNumber: reqStr("lotNumber"),
        quantity: positiveQty("quantity"),
      })
    )
    .min(1, "At least one input item is required"),
  outputs: z
    .array(
      z.object({
        productId: z.number().int().positive().nullable().optional(),
        lotNumber: reqStr("lotNumber"),
        outputType: z.enum(["FINISHED", "SECONDARY", "WASTE"]),
        quantity: positiveQty("quantity"),
      })
    )
    .min(1, "At least one output item is required"),
});

// POST /api/processing/batches — create + complete a batch atomically
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, batchSchema);
    const batch = await createProcessingBatch({ ...body, notes: body.notes ?? undefined });
    return NextResponse.json(batch, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
