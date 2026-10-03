import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError, ValidationError } from "@/lib/api-error";

// GET /api/audit/ledger — filterable, paginated append-only ledger.
// Filters: itemType, referenceType, lotNumber, itemId, startDate, endDate, limit, offset
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  itemType: z.enum(["RAW_MATERIAL", "FINISHED_PRODUCT"]).optional(),
  referenceType: z
    .enum(["PURCHASE", "PROCESSING_INPUT", "PROCESSING_OUTPUT", "SALE", "INVOICE_CANCELLATION", "BATCH_CANCELLATION", "ADJUSTMENT"])
    .optional(),
  lotNumber: z.string().trim().min(1).optional(),
  itemId: z.coerce.number().int().positive().optional(),
  startDate: z
    .string()
    .trim()
    .refine((v) => !isNaN(Date.parse(v)), "startDate must be a valid ISO date")
    .optional(),
  endDate: z
    .string()
    .trim()
    .refine((v) => !isNaN(Date.parse(v)), "endDate must be a valid ISO date")
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query parameters.");
    }
    const q = parsed.data;

    // Date-only end dates are inclusive of the whole day.
    const endDate = q.endDate
      ? DATE_ONLY.test(q.endDate)
        ? new Date(`${q.endDate}T23:59:59.999Z`)
        : new Date(q.endDate)
      : undefined;

    const where = {
      ...(q.itemType ? { itemType: q.itemType } : {}),
      ...(q.referenceType ? { referenceType: q.referenceType } : {}),
      ...(q.lotNumber ? { lotNumber: q.lotNumber } : {}),
      ...(q.itemId !== undefined ? { itemId: q.itemId } : {}),
      ...(q.startDate || endDate
        ? {
            timestamp: {
              ...(q.startDate ? { gte: new Date(q.startDate) } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    };

    const [entries, total] = await Promise.all([
      db.inventoryTransaction.findMany({
        where,
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: q.limit,
        skip: q.offset,
      }),
      db.inventoryTransaction.count({ where }),
    ]);

    return NextResponse.json({ entries, total });
  } catch (e) {
    return handleApiError(e);
  }
}
