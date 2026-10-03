import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { optStr, reqStr, parseBody } from "@/lib/validation";

// GET /api/suppliers — list all suppliers
export async function GET() {
  try {
    const suppliers = await db.supplier.findMany({ orderBy: { companyName: "asc" } });
    return NextResponse.json(suppliers);
  } catch (e) {
    return handleApiError(e);
  }
}

const supplierSchema = z.object({
  companyName: reqStr("companyName"),
  contactPerson: optStr,
  phone: optStr,
  email: optStr,
  address: optStr,
  gstNumber: optStr,
});

// POST /api/suppliers — create supplier (companyName required & unique)
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, supplierSchema);
    const supplier = await db.supplier.create({
      data: {
        companyName: body.companyName,
        contactPerson: body.contactPerson ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        address: body.address ?? null,
        gstNumber: body.gstNumber ?? null,
      },
    });
    return NextResponse.json(supplier, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
