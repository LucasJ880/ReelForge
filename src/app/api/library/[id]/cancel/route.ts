import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { cancelUnifiedOrderForUser } from "@/lib/services/single-video-cancel-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/library/[id]/cancel —— 客户取消一条单条视频（铁律 #7）。
 * id = 成品库详情页的订单 id。只对本人、尚未结束的任务生效；素材保留，额度立即返还。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!id || id.length > 64) {
    return NextResponse.json({ ok: false, code: "VALIDATION_FAILED", error: "参数不合法" }, { status: 400 });
  }

  const result = await cancelUnifiedOrderForUser(guard.session.user.id, id);
  if (!result.ok) {
    return NextResponse.json(
      result.reason === "not_found"
        ? { ok: false, code: "NOT_FOUND", error: "任务不存在或不属于当前账号" }
        : { ok: false, code: "ALREADY_FINISHED", error: "这条视频已经结束，无需取消" },
      { status: result.reason === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    cancelledJobs: result.cancelledJobs,
    refunded: result.refundedBriefs > 0,
    /// P05-B：只重拼中取消 = 回滚到旧成片的条数（订单未取消、无返还）
    restitchRolledBack: result.restitchRolledBack ?? 0,
    /// P05-C：只取消了重做中的片段（订单未取消，每段已退回）
    cancelledRedos: result.cancelledRedos ?? 0,
  });
}
