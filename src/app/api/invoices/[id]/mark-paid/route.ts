import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { markInvoicePaid } from "@/lib/services/invoice";

// POST /api/invoices/[id]/mark-paid — record a customer payment (receivables tracking).
// Body optional: { amount?, method?, notes? } — omit for full settlement.
// 400 on cancelled invoice / invalid amount / overpay, 409 on already-settled, 404 missing.
const bodySchema = z.object({
  amount: z.coerce.number().positive("Payment amount must be positive").optional(),
  method: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  notes: z.string().trim().max(300).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new ValidationError(`Invalid invoice id "${id}".`);
    }

    let payment: z.infer<typeof bodySchema> | undefined;
    const text = await request.text();
    if (text) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ValidationError("Request body must be valid JSON.");
      }
      const parsed = bodySchema.safeParse(json);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid payment payload.");
      }
      payment = parsed.data;
    }

    const invoice = await markInvoicePaid(invoiceId, payment);
    return NextResponse.json(invoice);
  } catch (e) {
    return handleApiError(e);
  }
}
