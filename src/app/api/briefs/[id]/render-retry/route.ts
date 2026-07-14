import { NextRequest, NextResponse } from "next/server";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { requireAuth } from "@/lib/api-auth";
import { checkBriefAccess } from "@/lib/services/brief-access";
import { db } from "@/lib/db";
import {
  retryFailedVideoJob,
  reconcileBriefRenderStatus,
  toCustomerBriefRenderSummary,
} from "@/lib/services/video-service";
import {
  customerApiError,
  SubmissionReconciliationRequiredError,
} from "@/lib/api/customer-generation-error";

function canSeeRenderDebug(userType: string | null | undefined): boolean {
  return userType === "OPERATOR" || userType === "SUPER_ADMIN";
}

/**
 * 重试该 brief 下的失败环节。重试永远是「续跑」：
 *   - FAILED 的 VideoJob → 重新提交该段（retryFailedVideoJob 有防重复扣费双保险）
 *   - 段全部成功但合成失败（FinalVideo FAILED）→ retryStitch 从已付费段继续合成，
 *     **绝不重新生成**（零生成计费）
 *
 * Body:
 *   { "jobId": "videojob_id" }    // 重试单个 job
 *   { "all": true }               // 重试当前 brief 下所有失败环节（段 + 合成）
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
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message:
          access.reason === "not-found"
            ? "生成记录不存在。"
            : "无权访问该生成记录。",
        retryable: false,
        action: "contact_support",
      }),
      { status: access.reason === "not-found" ? 404 : 403 },
    );
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

      /// 合成失败续跑：段全部成功但 FinalVideo FAILED（含 sweep 超时失败化的）
      /// → retryStitch 从已付费段继续合成，零生成计费。
      /// 历史 bug：这里曾只重试 FAILED job —— 合成失败时没有任何 FAILED job，
      /// 「重试」按钮等于空操作，用户永远卡在失败态。
      if (failed.length === 0) {
        const brief = await db.videoBrief.findUnique({
          where: { id: briefId },
          select: {
            finalVideoId: true,
            finalVideo: {
              select: {
                status: true,
                segmentCount: true,
                segments: { select: { status: true } },
              },
            },
          },
        });
        const fv = brief?.finalVideo;
        const allSegmentsSucceeded =
          !!fv &&
          fv.segments.length === fv.segmentCount &&
          fv.segments.every((s) => s.status === VideoJobStatus.SUCCEEDED);
        if (
          brief?.finalVideoId &&
          fv?.status === FinalVideoStatus.FAILED &&
          allSegmentsSucceeded
        ) {
          const { retryStitch } = await import("@/lib/services/stitch-service");
          await retryStitch(brief.finalVideoId);
        }
      }
    } else if (typeof body.jobId === "string") {
      const job = await db.videoJob.findUnique({
        where: { id: body.jobId },
      });
      if (!job || job.videoBriefId !== briefId) {
        return NextResponse.json(
          customerApiError({
            code: "INTERNAL_ERROR",
            message: "待重试的生成任务不存在。",
            retryable: false,
            action: "contact_support",
          }),
          { status: 404 },
        );
      }
      await retryFailedVideoJob(body.jobId);
    } else {
      return NextResponse.json(
        customerApiError({
          code: "INTERNAL_ERROR",
          message: "请选择一个失败任务，或重试全部可恢复任务。",
          retryable: false,
          action: "contact_support",
        }),
        { status: 400 },
      );
    }

    const summary = await reconcileBriefRenderStatus(briefId);
    return NextResponse.json(
      canSeeRenderDebug(guard.session.user.userType)
        ? summary
        : toCustomerBriefRenderSummary(summary),
    );
  } catch (err) {
    if (err instanceof SubmissionReconciliationRequiredError) {
      return NextResponse.json(
        customerApiError({
          code: err.code,
          message: err.message,
          retryable: false,
          action: "contact_support",
        }),
        { status: 409 },
      );
    }
    console.error("[render-retry] retry failed", {
      briefId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法重试生成任务，请稍后再试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
