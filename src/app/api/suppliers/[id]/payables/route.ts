import { NextResponse } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { getSupplierPayables } from "@/lib/services/supplier-payment";

// GET /api/suppliers/[id]/payables — full payables position for one supplier:
// per-PO bills (derived from PURCHASE ledger rows) with paid/outstanding/age,
// payment receipts, and outstanding aging buckets. 404 on unknown supplier.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supplierId = Number(id);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      throw new ValidationError(`Invalid supplier id "${id}".`);
    }
    const summary = await getSupplierPayables(supplierId);
    return NextResponse.json(summary);
  } catch (e) {
    return handleApiError(e);
  }
}
