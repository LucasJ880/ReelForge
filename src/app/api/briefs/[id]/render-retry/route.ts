import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkBriefAccess } from "@/lib/services/brief-access";
import { db } from "@/lib/db";
import {
  retryFailedVideoJob,
  reconcileBriefRenderStatus,
} from "@/lib/services/video-service";

/**
 * 仅允许重试该 brief 下的失败 job（FAILED）。
 * Body:
 *   { "jobId": "videojob_id" }    // 重试单个 job
 *   { "all": true }               // 重试当前 brief 下所有 FAILED job
 *
 * 安全门禁（与 Seedance 计费安全相关）：
 * 1. 调用方必须是该 brief 的 owner（unified-input 流程：DeliveryOrder.createdById），
 *    或内部 staff（OPERATOR/SUPER_ADMIN）—— Phase 6 收紧，不再允许任意 OPERATOR
 *    因为 PERSONAL 用户也是 role=OPERATOR + userType=PERSONAL，
 *    必须用 brief 归属权而不是单纯 role 来判断
 * 2. retryFailedVideoJob 内部会先 GET Provider 状态，确认确实失败 / 不存在再扣费重交
 *    —— 防止用户在已完成 job 上误点重试再次扣费
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id: briefId } = await params;

  const access = await checkBriefAccess(briefId, guard.session);
  if (!access.allowed) {
    if (access.reason === "not-found") {
      return NextResponse.json({ error: "Brief 不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  try {
    if (body.all === true) {
      const failed = await db.videoJob.findMany({
        where: { videoBriefId: briefId, status: "FAILED" },
      });
      for (const job of failed) {
        await retryFailedVideoJob(job.id);
      }
    } else if (typeof body.jobId === "string") {
      const job = await db.videoJob.findUnique({
        where: { id: body.jobId },
      });
      if (!job || job.videoBriefId !== briefId) {
        return NextResponse.json(
          { error: "VideoJob 不存在或不属于该 Brief" },
          { status: 404 },
        );
      }
      await retryFailedVideoJob(body.jobId);
    } else {
      return NextResponse.json(
        { error: "请传 jobId 或 all=true" },
        { status: 400 },
      );
    }

    const summary = await reconcileBriefRenderStatus(briefId);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
