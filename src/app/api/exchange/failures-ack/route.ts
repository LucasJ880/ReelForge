import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { acknowledgeFailures } from "@/lib/services/exchange-readings";

export const dynamic = "force-dynamic";

/**
 * POST /api/exchange/failures-ack —— 成品库「需要处理」的「看过了」。
 * 只写本人工作区的 Workspace.failuresAckedAt = 现在；失败记录本身不动（只归档不删除）。
 * 之后导轨徽标与「需要处理」只数这一刻之后的失败。
 */
export async function POST() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  try {
    const acknowledgedAt = await acknowledgeFailures(guard.session.user.id);
    return NextResponse.json({ ok: true, acknowledgedAt: acknowledgedAt.toISOString() });
  } catch (error) {
    console.error("[POST /api/exchange/failures-ack]", error);
    return NextResponse.json({ ok: false, error: "没能清除提醒，请重试" }, { status: 500 });
  }
}
