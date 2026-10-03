import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { optStr, reqStr, parseBody } from "@/lib/validation";

// GET /api/customers — list all customers
export async function GET() {
  try {
    const customers = await db.customer.findMany({ orderBy: { companyName: "asc" } });
    return NextResponse.json(customers);
  } catch (e) {
    return handleApiError(e);
  }
}

const customerSchema = z.object({
  companyName: reqStr("companyName"),
  contactPerson: optStr,
  phone: optStr,
  email: optStr,
  billingAddress: optStr,
  shippingAddress: optStr,
  gstNumber: optStr,
});

// POST /api/customers — create customer (companyName required & unique)
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, customerSchema);
    const customer = await db.customer.create({
      data: {
        companyName: body.companyName,
        contactPerson: body.contactPerson ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        billingAddress: body.billingAddress ?? null,
        shippingAddress: body.shippingAddress ?? null,
        gstNumber: body.gstNumber ?? null,
      },
    });
    return NextResponse.json(customer, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
