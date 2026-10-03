import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api-error";
import { createAndConfirmInvoice, listInvoices } from "@/lib/services/invoice";
import { isoDate, parseBody, positiveQty, reqStr } from "@/lib/validation";

// GET /api/invoices — all invoices (newest first) with items + customer
export async function GET() {
  try {
    const invoices = await listInvoices();
    return NextResponse.json(invoices);
  } catch (e) {
    return handleApiError(e);
  }
}

const invoiceSchema = z.object({
  customerId: z.number({ message: "customerId must be a number" }).int().positive(),
  invoiceDate: isoDate.optional(),
  items: z
    .array(
      z.object({
        productId: z.number({ message: "productId must be a number" }).int().positive(),
        lotNumber: reqStr("lotNumber"),
        quantity: positiveQty("quantity"),
      })
    )
    .min(1, "At least one invoice line is required"),
});

// POST /api/invoices — create + confirm invoice (stock deducted, SALE ledger rows)
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, invoiceSchema);
    const invoice = await createAndConfirmInvoice(body);
    return NextResponse.json(invoice, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
