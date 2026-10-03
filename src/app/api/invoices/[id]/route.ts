import { NextResponse } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { getInvoice } from "@/lib/services/invoice";

// GET /api/invoices/[id] — invoice detail (print/PDF view)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new ValidationError(`Invalid invoice id "${id}".`);
    }
    const invoice = await getInvoice(invoiceId);
    return NextResponse.json(invoice);
  } catch (e) {
    return handleApiError(e);
  }
}
