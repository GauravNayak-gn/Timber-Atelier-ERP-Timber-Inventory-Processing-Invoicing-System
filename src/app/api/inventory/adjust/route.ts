import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api-error";
import { adjustStock } from "@/lib/services/adjustment";
import { parseBody, reqStr } from "@/lib/validation";

const adjustSchema = z.object({
  itemType: z.enum(["RAW_MATERIAL", "FINISHED_PRODUCT"], {
    message: "itemType must be RAW_MATERIAL or FINISHED_PRODUCT",
  }),
  itemId: z.number({ message: "itemId must be a number" }).int().positive(),
  direction: z.enum(["IN", "OUT"], { message: "direction must be IN or OUT" }),
  quantity: z
    .number({ message: "quantity must be a number" })
    .positive("quantity must be greater than 0"),
  reason: reqStr("reason").pipe(z.string().min(3, "reason must be at least 3 characters")),
});

// POST /api/inventory/adjust — manual stock correction (ADJUSTMENT ledger row)
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, adjustSchema);
    const result = await adjustStock(body);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
