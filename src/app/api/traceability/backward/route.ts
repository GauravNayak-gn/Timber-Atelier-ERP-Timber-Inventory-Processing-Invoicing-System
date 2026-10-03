import { NextResponse } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api-error";
import { traceBackward } from "@/lib/services/traceability";

// GET /api/traceability/backward?q=X — invoice number or finished lot ⇒ raw lots ⇒ POs
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("q")?.trim();
    if (!q) {
      throw new ValidationError("q query parameter is required (invoice number or finished lot).");
    }
    const trace = await traceBackward(q);
    return NextResponse.json(trace);
  } catch (e) {
    return handleApiError(e);
  }
}
