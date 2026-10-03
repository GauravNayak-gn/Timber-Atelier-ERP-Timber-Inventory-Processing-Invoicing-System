import { NextResponse } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { traceForward } from "@/lib/services/traceability";

// GET /api/traceability/forward?lotNumber=X — raw lot ⇒ batches ⇒ invoices
export async function GET(request: Request) {
  try {
    const lotNumber = new URL(request.url).searchParams.get("lotNumber")?.trim();
    if (!lotNumber) {
      throw new ValidationError("lotNumber query parameter is required.");
    }
    const trace = await traceForward(lotNumber);
    return NextResponse.json(trace);
  } catch (e) {
    return handleApiError(e);
  }
}
