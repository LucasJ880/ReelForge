import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { loadUsagePayloadForSession } from "@/lib/services/usage-payload";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/usage — 当前用户本月用量 vs 免费档限额
 */
export async function GET() {
  try {
    const guard = await requireAuth();
    if (!guard.ok) return guard.response;

    const payload = await loadUsagePayloadForSession(guard.session);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[GET /api/me/usage]", err);
    return NextResponse.json(
      { ok: false, error: "无法加载用量，请稍后重试" },
      { status: 500 },
    );
  }
}
