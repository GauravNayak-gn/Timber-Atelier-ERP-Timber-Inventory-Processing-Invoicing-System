import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { nonNegative, optStr, parseBody, reqStr } from "@/lib/validation";

// GET /api/products — list finished products
export async function GET() {
  try {
    const products = await db.finishedProduct.findMany({ orderBy: { id: "asc" } });
    return NextResponse.json(products);
  } catch (e) {
    return handleApiError(e);
  }
}

const productSchema = z.object({
  name: reqStr("name"),
  skuCode: reqStr("skuCode"),
  category: optStr,
  unit: reqStr("unit"),
  sellingPrice: nonNegative("sellingPrice"),
  taxRatePercent: nonNegative("taxRatePercent").optional(),
});

// POST /api/products — create finished product (taxRatePercent defaults to 18)
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, productSchema);
    const product = await db.finishedProduct.create({
      data: {
        name: body.name,
        skuCode: body.skuCode,
        category: body.category ?? undefined,
        unit: body.unit,
        sellingPrice: body.sellingPrice,
        taxRatePercent: body.taxRatePercent ?? 18,
      },
    });
    return NextResponse.json(product, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
