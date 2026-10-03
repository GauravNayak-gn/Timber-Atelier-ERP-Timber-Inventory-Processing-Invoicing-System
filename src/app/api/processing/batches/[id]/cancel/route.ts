import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { cancelBatch } from "@/lib/services/processing";
import { parseBody } from "@/lib/validation";

const cancelSchema = z.object({
  reason: z
    .string({ message: "reason is required" })
    .trim()
    .min(3, "reason must be at least 3 characters"),
});

// POST /api/processing/batches/[id]/cancel — reverse stock + mark CANCELLED (409 on double-cancel)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const batchId = Number(id);
    if (!Number.isInteger(batchId) || batchId <= 0) {
      throw new ValidationError(`Invalid batch id "${id}".`);
    }
    const body = await parseBody(request, cancelSchema);
    const batch = await cancelBatch(batchId, body.reason);
    return NextResponse.json(batch);
  } catch (e) {
    return handleApiError(e);
  }
}
