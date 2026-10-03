import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { voidSupplierPayment } from "@/lib/services/supplier-payment";
import { parseBody } from "@/lib/validation";

const voidSchema = z.object({
  reason: z
    .string({ message: "reason is required" })
    .trim()
    .min(3, "reason must be at least 3 characters")
    .max(300),
});

// POST /api/suppliers/[id]/payments/[paymentId]/void — void a mis-recorded
// supplier payment (append-only: the row is stamped with voidedAt/voidReason,
// never deleted; PO outstanding is recomputed from the remaining active
// receipts). 404 missing supplier/receipt, 409 already voided.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { id, paymentId } = await params;
    const supplierId = Number(id);
    const payId = Number(paymentId);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      throw new ValidationError(`Invalid supplier id "${id}".`);
    }
    if (!Number.isInteger(payId) || payId <= 0) {
      throw new ValidationError(`Invalid payment id "${paymentId}".`);
    }
    const body = await parseBody(request, voidSchema);
    const result = await voidSupplierPayment(supplierId, payId, body.reason);
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e);
  }
}
