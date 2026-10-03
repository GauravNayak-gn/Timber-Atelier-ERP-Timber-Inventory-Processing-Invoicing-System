import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getDashboardStats } from "@/lib/services/dashboard";

// GET /api/dashboard/stats — KPIs, low stock, recents, 6-month sales, waste trend
export async function GET() {
  try {
    const stats = await getDashboardStats();
    return NextResponse.json(stats);
  } catch (e) {
    return handleApiError(e);
  }
}
