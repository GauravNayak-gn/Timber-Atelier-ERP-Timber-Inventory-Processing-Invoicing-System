import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError, round2 } from "@/lib/api-error";
import { recordMovement } from "@/lib/services/ledger";
import { nonNegative, optStr, parseBody, reqStr } from "@/lib/validation";

// GET /api/materials — list raw materials
export async function GET() {
  try {
    const materials = await db.rawMaterial.findMany({ orderBy: { id: "asc" } });
    return NextResponse.json(materials);
  } catch (e) {
    return handleApiError(e);
  }
}

const materialSchema = z.object({
  name: reqStr("name"),
  skuCode: reqStr("skuCode"),
  category: optStr,
  unit: reqStr("unit"),
  unitPurchaseRate: nonNegative("unitPurchaseRate"),
  reorderThreshold: nonNegative("reorderThreshold").optional(),
  currentStock: nonNegative("currentStock").optional(),
});

// POST /api/materials — create raw material.
// Opening stock (if any) is always paired with an ADJUSTMENT ledger row.
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, materialSchema);

    const material = await db.$transaction(async (tx) => {
      const created = await tx.rawMaterial.create({
        data: {
          name: body.name,
          skuCode: body.skuCode,
          category: body.category ?? undefined,
          unit: body.unit,
          unitPurchaseRate: body.unitPurchaseRate,
          reorderThreshold: body.reorderThreshold ?? undefined,
          currentStock: round2(body.currentStock ?? 0),
        },
      });

      if (created.currentStock > 0) {
        await recordMovement(tx, {
          itemType: "RAW_MATERIAL",
          itemId: created.id,
          itemName: created.name,
          referenceType: "ADJUSTMENT",
          referenceNumber: "ADJ-OPENING",
          lotNumber: `OPENING-${created.skuCode}`,
          stockIn: created.currentStock,
          balanceAfter: created.currentStock,
          unitRate: created.unitPurchaseRate,
          notes: `Opening stock recorded at material creation (${created.currentStock} ${created.unit})`,
        });
      }

      return created;
    });

    return NextResponse.json(material, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
