import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError, NotFoundError, round2 } from "@/lib/api-error";
import { recordMovement } from "@/lib/services/ledger";
import { addStock } from "@/lib/services/inventory";
import { nonNegative, parseBody, positiveQty, reqStr } from "@/lib/validation";

const purchaseSchema = z.object({
  materialId: z.number({ message: "materialId must be a number" }).int().positive(),
  supplierId: z.number({ message: "supplierId must be a number" }).int().positive(),
  quantity: positiveQty("quantity"),
  unitRate: nonNegative("unitRate"),
  lotNumber: reqStr("lotNumber"),
  poNumber: reqStr("poNumber"),
});

// POST /api/materials/purchase — receive stock against a PO.
// Atomic addStock + PURCHASE ledger row in one transaction.
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, purchaseSchema);

    const material = await db.$transaction(async (tx) => {
      const existing = await tx.rawMaterial.findUnique({ where: { id: body.materialId } });
      if (!existing) {
        throw new NotFoundError(`Raw material with id ${body.materialId} not found.`);
      }
      const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
      if (!supplier) {
        throw new NotFoundError(`Supplier with id ${body.supplierId} not found.`);
      }

      const updated = await addStock(tx, "rawMaterial", body.materialId, body.quantity);

      await recordMovement(tx, {
        itemType: "RAW_MATERIAL",
        itemId: updated.id,
        itemName: updated.name,
        referenceType: "PURCHASE",
        referenceNumber: body.poNumber,
        lotNumber: body.lotNumber,
        stockIn: body.quantity,
        balanceAfter: updated.currentStock,
        unitRate: body.unitRate,
        supplierId: supplier.id,
        notes: `Purchase of ${round2(body.quantity)} ${updated.unit} @ ₹${round2(body.unitRate)}/${updated.unit} from ${supplier.companyName}`,
      });

      return updated;
    });

    return NextResponse.json(material, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
