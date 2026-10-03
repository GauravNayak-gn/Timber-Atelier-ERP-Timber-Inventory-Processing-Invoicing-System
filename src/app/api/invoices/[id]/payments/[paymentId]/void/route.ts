import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { voidInvoicePayment } from "@/lib/services/invoice";
import { parseBody } from "@/lib/validation";

const voidSchema = z.object({
  reason: z
    .string({ message: "reason is required" })
    .trim()
    .min(3, "reason must be at least 3 characters")
    .max(300),
});

// POST /api/invoices/[id]/payments/[paymentId]/void — void a mis-recorded
// receipt (append-only: the row is stamped, never deleted; paidAmount and
// settlement are recomputed from the remaining active receipts).
// 400 on cancelled invoice, 404 missing invoice/receipt, 409 already voided.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { id, paymentId } = await params;
    const invoiceId = Number(id);
    const payId = Number(paymentId);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new ValidationError(`Invalid invoice id "${id}".`);
    }
    if (!Number.isInteger(payId) || payId <= 0) {
      throw new ValidationError(`Invalid payment id "${paymentId}".`);
    }
    const body = await parseBody(request, voidSchema);
    const invoice = await voidInvoicePayment(invoiceId, payId, body.reason);
    return NextResponse.json(invoice);
  } catch (e) {
    return handleApiError(e);
  }
}
