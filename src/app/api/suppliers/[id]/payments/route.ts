import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { paySupplierBill } from "@/lib/services/supplier-payment";
import { parseBody } from "@/lib/validation";

const bodySchema = z.object({
  poNumber: z
    .string({ message: "poNumber is required" })
    .trim()
    .min(1, "poNumber is required")
    .max(60),
  amount: z.coerce.number().positive("Payment amount must be positive").optional(),
  method: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  notes: z.string().trim().max(300).optional(),
});

// POST /api/suppliers/[id]/payments — record a payment to a supplier against
// one PO bill. Body: { poNumber, amount?, method?, notes? } — omitting the
// amount settles the PO's remaining balance. The bill itself derives from the
// immutable PURCHASE ledger rows, so payments can never exceed what was billed.
// 400 on unknown PO / invalid amount / overpay, 409 on already-settled, 404 missing.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supplierId = Number(id);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      throw new ValidationError(`Invalid supplier id "${id}".`);
    }
    const body = await parseBody(request, bodySchema);
    const result = await paySupplierBill(supplierId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
