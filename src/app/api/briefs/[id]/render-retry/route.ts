import { NextRequest, NextResponse } from "next/server";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { requireAuth } from "@/lib/api-auth";
import { checkBriefAccess } from "@/lib/services/brief-access";
import { db } from "@/lib/db";
import {
  commitSegmentRedo,
  prepareSegmentRedo,
  retryFailedVideoJob,
  reconcileBriefRenderStatus,
  segmentRedoInFlightWhere,
  toCustomerBriefRenderSummary,
} from "@/lib/services/video-service";
import {
  customerApiError,
  SubmissionReconciliationRequiredError,
} from "@/lib/api/customer-generation-error";
import { quotaErrorResponse } from "@/lib/api-quota";
import { demoBlockedBody, isDemoAccountEmail } from "@/lib/demo-account";
import {
  QuotaRechargeUnavailableError,
  rechargeRefundedBriefForSession,
  rechargeRefundedSegmentRedoForSession,
} from "@/lib/services/quota-refund-service";
import { assertAuthenticatedActionRateLimit } from "@/lib/services/quota-service";
import { RestitchRejectedError } from "@/lib/video-generation/restitch-patch";
import {
  isSegmentRedoCandidate,
  isSupersededSegmentJob,
  parseSegmentRedoRequest,
  SegmentRedoRejectedError,
  selectAllRetryTargets,
} from "@/lib/video-generation/segment-redo";

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
 *   { "restitch": { "captions"?, "bgm"? } }
 *                                 // P05-B 只重拼：READY 成片换字幕样式 / 配乐。零生成计费，
 *                                 // 不补扣额度；限流 action "restitch"；失败回滚到旧成片。
 *   { "redoSegment": { "segmentIndex": 1, "promptOverride"?: "这一段别出现文字" } }
 *                                 // P05-C 重做成片里的某一段：扣 1 段 SEEDANCE_SEGMENT，限流 action
 *                                 // "segment-redo"；旧成片保持 READY，新段成功后换挂并只重拼，
 *                                 // 合成失败回滚到旧成片；提交失败 / 生成失败 / 取消都退回这 1 段。
 *
 * 重做候选行（还没换挂上成片的）与被替换掉的旧行：all:true 只重试每段最新的那条失败候选行，
 * 按候选行补扣（不走 brief 的补扣）；旧行一律不重试。
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
    /// P05-D：404 / 403 用契约里的真实错误码（customer-api.ts），不再一律 INTERNAL_ERROR——
    /// 客户端按 code 分流（找不到 vs 无权），INTERNAL_ERROR 会被当成「稍后重试」。
    return NextResponse.json(
      customerApiError({
        code: access.reason === "not-found" ? "RESOURCE_NOT_FOUND" : "FORBIDDEN",
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
  /// 已返还额度的 brief 再重试要先补扣（D1）：只在真有东西要重跑时补扣一次，扣不到就拒绝。
  let rechargeChecked = false;
  const rechargeIfRefunded = async () => {
    if (rechargeChecked) return;
    rechargeChecked = true;
    await rechargeRefundedBriefForSession(guard.session, briefId);
  };
  /// 重做候选行按候选行补扣（它扣的是自己那 1 段，与 brief 的额度无关）
  const retryRedoCandidate = async (jobId: string) => {
    await rechargeRefundedSegmentRedoForSession(guard.session, jobId);
    await retryFailedVideoJob(jobId);
  };
  let redo: { jobId: string; status: VideoJobStatus } | null = null;

  try {
    if (body.restitch !== undefined) {
      /// 只重拼不是「重试失败环节」：不走 rechargeIfRefunded（没有生成费可补扣）。
      /// 顺序：解析补丁 + 只读状态预检（prepareRestitch）→ 账号限频 → CAS 写入并重拼——
      /// 不合法的补丁与明显不能重拼的状态不消耗限频名额。
      const brief = await db.videoBrief.findUnique({
        where: { id: briefId },
        select: { finalVideoId: true },
      });
      if (!brief?.finalVideoId) {
        throw new RestitchRejectedError("INVALID_STATE", "这条视频还没有成片，不能更换字幕 / 配乐。");
      }
      const { prepareRestitch, commitRestitch } = await import("@/lib/services/stitch-service");
      const prepared = await prepareRestitch(brief.finalVideoId, body.restitch);
      /// 有一段正在重做：新段成功后要换挂并重拼，这时再换设置会被它覆盖
      if ((await db.videoJob.count({ where: segmentRedoInFlightWhere(briefId) })) > 0) {
        throw new RestitchRejectedError("INVALID_STATE", "有一段正在重做，等它换上成片后再换字幕 / 配乐。");
      }
      await assertAuthenticatedActionRateLimit({
        action: "restitch",
        userId: guard.session.user.id,
      });
      const result = await commitRestitch(prepared);
      /// local 模式会在本请求内合成：没成就已经回滚到旧成片，如实告知而不是 200
      if (result.rolledBack) {
        throw new RestitchRejectedError(
          "INVALID_STATE",
          `重拼没有成功，已恢复旧成片：${result.error ?? "合成失败"}`,
        );
      }
    } else if (body.redoSegment !== undefined) {
      /// 铁律 4：演示账号不跑付费生成（middleware 也拦，这里在付费入口再守一次）
      if (isDemoAccountEmail(guard.session.user.email)) {
        return NextResponse.json(demoBlockedBody(), { status: 403 });
      }
      /// 顺序：参数 → 只读预检 → 账号限频 → 事务内建候选行 + 扣 1 段 → 提交
      const request = parseSegmentRedoRequest(body.redoSegment);
      const prepared = await prepareSegmentRedo(briefId, request.segmentIndex, {
        promptOverride: request.promptOverride,
      });
      await assertAuthenticatedActionRateLimit({
        action: "segment-redo",
        userId: guard.session.user.id,
      });
      const job = await commitSegmentRedo(prepared, { session: guard.session });
      redo = { jobId: job.id, status: job.status };
    } else if (body.all === true) {
      const rows = await db.videoJob.findMany({
        where: { videoBriefId: briefId, supersededAt: null },
        orderBy: { createdAt: "asc" },
      });
      const { current: failed, candidates } = selectAllRetryTargets(rows);
      if (failed.length > 0) await rechargeIfRefunded();
      for (const job of failed) {
        await retryFailedVideoJob(job.id);
      }
      for (const job of candidates) {
        await retryRedoCandidate(job.id);
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
          await rechargeIfRefunded();
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
            code: "RESOURCE_NOT_FOUND",
            message: "待重试的生成任务不存在。",
            retryable: false,
            action: "contact_support",
          }),
          { status: 404 },
        );
      }
      if (isSupersededSegmentJob(job)) {
        throw new SegmentRedoRejectedError("INVALID_STATE", "这一段已经换成了重做后的新版本，旧版本不能重试。");
      }
      if (isSegmentRedoCandidate(job)) {
        if (job.status === VideoJobStatus.FAILED) await retryRedoCandidate(body.jobId);
        else await retryFailedVideoJob(body.jobId);
      } else {
        if (job.status === "FAILED") await rechargeIfRefunded();
        await retryFailedVideoJob(body.jobId);
      }
    } else {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: "请选择一个失败任务，或重试全部可恢复任务。",
          retryable: false,
          action: "fix_request",
        }),
        { status: 400 },
      );
    }

    const summary = await reconcileBriefRenderStatus(briefId);
    const visible = canSeeRenderDebug(guard.session.user.userType)
      ? summary
      : toCustomerBriefRenderSummary(summary);
    return NextResponse.json(redo ? { ...visible, redo } : visible);
  } catch (err) {
    const quotaResponse = quotaErrorResponse(err);
    if (quotaResponse) return quotaResponse;
    if (err instanceof QuotaRechargeUnavailableError) {
      return NextResponse.json(
        customerApiError({
          code: "FORBIDDEN",
          message: err.message,
          retryable: false,
          action: "contact_support",
        }),
        { status: 403 },
      );
    }
    if (err instanceof RestitchRejectedError || err instanceof SegmentRedoRejectedError) {
      return NextResponse.json(
        customerApiError({
          code: err.code,
          message: err.message,
          retryable: false,
          action:
            err.code === "VALIDATION_FAILED"
              ? "fix_request"
              : err.code === "INVALID_STATE"
                ? "refresh_status"
                : "contact_support",
        }),
        {
          status:
            err.code === "VALIDATION_FAILED" ? 400 : err.code === "INVALID_STATE" ? 409 : 404,
        },
      );
    }
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
