import { NextRequest, NextResponse } from "next/server";
import { AngleType, DeliveryOrderStatus, RoundStatus, VideoBriefStatus } from "@prisma/client";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import {
  toCustomerVideoDispatchError,
  toCustomerVideoDispatchResponse,
  type CustomerVideoDispatchErrorInput,
} from "@/lib/api/customer-video-dispatch";
import {
  assertQuotaBatchForSession,
  compensateDirectDispatchQuota,
  currentUsagePeriodKey,
} from "@/lib/services/quota-service";
import {
  BREAKER_USER_MESSAGE,
  evaluateDispatchBreaker,
} from "@/lib/services/dispatch-breaker";
import { db } from "@/lib/db";
import { buildPlan } from "@/lib/video-generation/generation-supervisor";
import { mapPlanToDirectorPlan } from "@/lib/video-generation/plan-to-director";
import { dispatchVideoForBrief } from "@/lib/services/video-service";
import {
  claimVideoDispatchRequest,
  completeVideoDispatchRequest,
  hashVideoDispatchRequest,
  markVideoDispatchQuotaConsumed,
  validateIdempotencyKey,
} from "@/lib/services/video-dispatch-idempotency";
import { deriveBusinessStatus } from "@/lib/video-generation/business-status";
import { deriveBusinessOrderTitle } from "@/lib/video-generation/business-display-title";
import {
  unifiedVideoGenerationRequestSchema,
  videoGenerationPlanSchema,
} from "@/lib/schemas/unified-input";
import { z } from "zod";
import { videoGenerationRuntimeReadiness } from "@/lib/config/env";
import {
  canVideoRouteOverrideDefaultRuntimeFailure,
  getVideoRouteSnapshotRuntimeAvailability,
  selectVideoRouteSnapshot,
  VideoRouteSelectionError,
} from "@/lib/video-generation/video-route-selection";
import type { VideoRouteSnapshot } from "@/lib/video-generation/video-route-registry";
import { SHUYU_VIDEO_POINTS_PER_GENERATION } from "@/lib/providers/shuyu";

/**
 * 用户在创作页「确认脚本」时编辑过的分镜 prompt 覆盖。
 * 服务端仍然 buildPlan 防 tamper，但会把用户确认的 prompt 文本
 * 应用到对应 segmentOrder 的 AI 段（这是同行工作流的关键一步：
 * 脚本先给用户看 → 用户可改 → 再出片）。
 */
const confirmedPromptsSchema = z
  .array(
    z.object({
      segmentOrder: z.number().int().min(0),
      prompt: z.string().min(1).max(4000),
    }),
  )
  .max(20);

const batchCountSchema = z.number().int().min(1).max(3);

function dispatchErrorResponse(
  status: number,
  error: CustomerVideoDispatchErrorInput,
) {
  return NextResponse.json(toCustomerVideoDispatchError(error), { status });
}

/**
 * POST /api/video-generation/dispatch
 *
 * 两种 body 形态（择一）：
 *
 *  A) { request: UnifiedVideoGenerationRequest }
 *     —— 服务端重新 buildPlan，再持久化 + 调 Seedance
 *     （推荐路径：避免 UI tamper 后送 Seedance 错误 prompt）
 *
 *  B) { request, plan: VideoGenerationPlan }
 *     —— UI 已经 preview 过；服务端会重新校验 plan 与 request 是否匹配
 *     （Phase 1 直接采用 server 端 buildPlan 二次生成，以保证 quality-reviewer 是最新规则）
 *
 * Response:
 *   { ok: true, deliveryOrderId, briefId, videoJobs: VideoJob[] }
 *
 * 失败时：HTTP 400 + 详细错误（不静默回退）。
 */
export async function POST(req: NextRequest) {
  const guard = await requireUserOfTypeForGeneration();
  if (!guard.ok) {
    return guard.response.status === 401
      ? dispatchErrorResponse(401, {
          code: "AUTH_REQUIRED",
          message: "请先登录后再生成视频。",
          retryable: false,
          action: "sign_in",
        })
      : dispatchErrorResponse(403, {
          code: "FORBIDDEN",
          message: "当前账号暂时无法使用视频生成，请联系支持。",
          retryable: false,
          action: "contact_support",
        });
  }
  const session = guard.session;

  const body = await req.json().catch(() => null);
  const idempotencyKey = validateIdempotencyKey(
    req.headers.get("idempotency-key"),
  );
  if (!idempotencyKey) {
    return dispatchErrorResponse(400, {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "提交标识缺失，请刷新页面后重新提交。",
      retryable: false,
      action: "fix_request",
    });
  }
  const reqParsed = unifiedVideoGenerationRequestSchema.safeParse(body?.request);
  if (!reqParsed.success) {
    return dispatchErrorResponse(400, {
      code: "VALIDATION_FAILED",
      message: "视频描述或生成设置不合法，请检查后重试。",
      retryable: false,
      action: "fix_request",
    });
  }

  /// 多批量出片：一次确认可同时出 1-3 支（同 plan 不同种子，提升可用率）。
  /// 必须在供应商余额预检前解析，避免只按一支视频检查合作方余额。
  let batchCount = 1;
  if (body?.batchCount != null) {
    const bcParse = batchCountSchema.safeParse(body.batchCount);
    if (!bcParse.success) {
      return dispatchErrorResponse(400, {
        code: "VALIDATION_FAILED",
        message: "一次可生成 1–3 支视频，请调整生成数量。",
        retryable: false,
        action: "fix_request",
      });
    }
    batchCount = bcParse.data;
  }

  /// Phase 5 — persona consistency 校验：
  /// 客户用户（非内部 staff）只能以自己的 persona 调度。
  /// 内部 staff（OPERATOR/SUPER_ADMIN）可代任意 persona 调用，便于客服 / debug。
  const sessionPersona = session.user.userType;
  const isInternalStaff =
    sessionPersona === "OPERATOR" || sessionPersona === "SUPER_ADMIN";
  if (!isInternalStaff && reqParsed.data.userType !== "platform") {
    const expected =
      sessionPersona === "BUSINESS"
        ? "business"
        : sessionPersona === "PERSONAL"
          ? "personal"
          : null;
    if (!expected || expected !== reqParsed.data.userType) {
      return dispatchErrorResponse(403, {
        code: "FORBIDDEN",
        message: "当前账号无权以所选身份提交生成请求。",
        retryable: false,
        action: "contact_support",
      });
    }
  }

  const mayOverrideVideoRoute =
    session.user.role === "OPERATOR" || session.user.role === "SUPER_ADMIN";
  let videoRouteSnapshot: VideoRouteSnapshot;
  try {
    videoRouteSnapshot = selectVideoRouteSnapshot({
      requestedRouteId: body?.videoRouteId,
      isInternalStaff: mayOverrideVideoRoute,
    });
  } catch (error) {
    if (error instanceof VideoRouteSelectionError) {
      return dispatchErrorResponse(error.code === "FORBIDDEN" ? 403 : 400, {
        code: error.code === "FORBIDDEN" ? "FORBIDDEN" : "VALIDATION_FAILED",
        message:
          error.code === "FORBIDDEN"
            ? "当前账号无权选择视频生成线路。"
            : "所选视频生成线路不可用，请刷新后重试。",
        retryable: false,
        action: error.code === "FORBIDDEN" ? "contact_support" : "fix_request",
      });
    }
    throw error;
  }
  const requestHash = hashVideoDispatchRequest(body, videoRouteSnapshot);

  const runtimeReadiness = videoGenerationRuntimeReadiness();
  const overrideMayIgnoreGlobalRouteFailure =
    !runtimeReadiness.ok &&
    canVideoRouteOverrideDefaultRuntimeFailure(
      videoRouteSnapshot,
      runtimeReadiness.reason,
    );
  if (!runtimeReadiness.ok && !overrideMayIgnoreGlobalRouteFailure) {
    console.error("[dispatch] video runtime unavailable", {
      reason: runtimeReadiness.reason,
    });
    return dispatchErrorResponse(503, {
      code: "SERVICE_UNAVAILABLE",
      message: "视频生成服务正在配置中，请稍后再试。",
      retryable: true,
      action: "wait",
    });
  }

  /// Phase 1：始终服务端重建 plan 防 UI tamper
  let plan: Awaited<ReturnType<typeof buildPlan>>;
  try {
    plan = await buildPlan(reqParsed.data);
  } catch (err) {
    /// 客户可见 error 走友好文案；详细 message 仅写日志 / dev 调试
    console.error("[/api/video-generation/dispatch] buildPlan failed", err);
    return dispatchErrorResponse(500, {
      code: "INTERNAL_ERROR",
      message: "暂时无法准备视频方案，请稍后重试。",
      retryable: true,
      action: "retry",
    });
  }

  /// 如果 body.plan 存在，校验它是个合法 plan（仅作 sanity check；最终用 server plan）
  if (body?.plan) {
    const optParse = videoGenerationPlanSchema.safeParse(body.plan);
    if (!optParse.success) {
      return dispatchErrorResponse(400, {
        code: "VALIDATION_FAILED",
        message: "提交的视频方案不合法，请刷新页面后重试。",
        retryable: false,
        action: "fix_request",
      });
    }
  }

  /// 用户确认过的脚本覆盖：只替换对应 AI 段的 prompt 文本，其余结构保持 server plan
  if (body?.confirmedPrompts != null) {
    const cpParse = confirmedPromptsSchema.safeParse(body.confirmedPrompts);
    if (!cpParse.success) {
      return dispatchErrorResponse(400, {
        code: "VALIDATION_FAILED",
        message: "确认的脚本内容不合法，请修改后重试。",
        retryable: false,
        action: "fix_request",
      });
    }
    const byOrder = new Map(
      cpParse.data.map((c) => [c.segmentOrder, c.prompt.trim()]),
    );
    for (const seg of plan.segments) {
      const override = byOrder.get(seg.order);
      if (override && seg.type === "ai_generated_clip") {
        seg.prompt = override;
      }
    }
    for (const sp of plan.seedancePrompts) {
      const override = byOrder.get(sp.segmentOrder);
      if (override) {
        sp.prompt = override;
      }
    }
  }

  /// quality blocker 守门：blocker > 0 → 拒绝
  if (!plan.qualityReview.canDispatch) {
    return dispatchErrorResponse(422, {
      code: "QUALITY_BLOCKED",
      message: "您的描述还需要更多细节才能生成视频，请补充后重试。",
      retryable: false,
      action: "fix_request",
      blockers: plan.qualityReview.blockers.map((blocker) => blocker.message),
    });
  }

  /// 入口熔断（2026-07 事故加固）：最近窗口内已提交任务僵死率超阈值时，
  /// 不再把用户额度/等待时间浪费在必死任务上。半开探测自动恢复。
  /// 熔断检查放在扣配额之前 —— 被拒绝的请求不消耗任何额度。
  const breaker = await evaluateDispatchBreaker().catch((err) => {
    /// 熔断器自身故障不阻塞主流程（fail-open）
    console.warn("[dispatch] breaker evaluation failed:", (err as Error).message);
    return null;
  });
  if (breaker && !breaker.allowed) {
    return dispatchErrorResponse(503, {
      code: "SERVICE_UNAVAILABLE",
      message: BREAKER_USER_MESSAGE,
      retryable: true,
      action: "wait",
    });
  }

  let dispatchClaim: Awaited<ReturnType<typeof claimVideoDispatchRequest>>;
  try {
    dispatchClaim = await claimVideoDispatchRequest({
      userId: session.user.id,
      idempotencyKey,
      requestHash,
      videoRouteSnapshot,
    });
  } catch (error) {
    console.error("[dispatch] idempotency claim failed", {
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return dispatchErrorResponse(500, {
      code: "INTERNAL_ERROR",
      message: "暂时无法登记生成请求，请稍后重试。",
      retryable: true,
      action: "retry",
    });
  }
  if (dispatchClaim.outcome === "replay") {
    return NextResponse.json(toCustomerVideoDispatchResponse(dispatchClaim.body), {
      status: dispatchClaim.status,
    });
  }
  if (dispatchClaim.outcome === "conflict") {
    return dispatchErrorResponse(409, {
      code: "IDEMPOTENCY_CONFLICT",
      message: "该提交标识已用于另一份内容，请刷新页面后重试。",
      retryable: false,
      action: "fix_request",
    });
  }
  if (dispatchClaim.outcome === "in_progress") {
    return dispatchErrorResponse(409, {
      code: "REQUEST_IN_PROGRESS",
      message: "该视频请求正在处理中，请勿重复提交。",
      retryable: false,
      action: "refresh_status",
    });
  }
  const dispatchRequestId = dispatchClaim.request.id;
  async function finalResponse(body: unknown, status: number) {
    const safeBody = toCustomerVideoDispatchResponse(body);
    try {
      await completeVideoDispatchRequest({
        requestId: dispatchRequestId,
        status,
        body: safeBody,
      });
    } catch (error) {
      console.error("[dispatch] response persistence failed", {
        requestId: dispatchRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return dispatchErrorResponse(500, {
        code: "SUBMISSION_ACK_UNKNOWN",
        message:
          "生成请求的处理状态尚未完成登记。为避免重复计费，请联系支持核对。",
        retryable: false,
        action: "contact_support",
      });
    }
    return NextResponse.json(safeBody, { status });
  }

  function uncompensatedProviderFailureResponse() {
    return finalResponse(
      toCustomerVideoDispatchError({
        code: "PROVIDER_ERROR",
        message:
          "生成任务未能完成。为核对 provider 接收状态与已扣额度，请联系支持后再重试。",
        retryable: false,
        action: "contact_support",
      }),
      503,
    );
  }

  // The idempotency claim/replay decision intentionally precedes the live
  // provider check: a completed request must replay its persisted response even
  // if the provider later runs out of points or becomes unavailable.
  const selectedRouteAvailability =
    await getVideoRouteSnapshotRuntimeAvailability({
      snapshot: videoRouteSnapshot,
      shuyuRequiredPoints:
        videoRouteSnapshot.videoRouteSnapshot === "buddy"
          ? batchCount * SHUYU_VIDEO_POINTS_PER_GENERATION
          : undefined,
    });
  if (!selectedRouteAvailability.available) {
    console.error("[dispatch] selected video route unavailable", {
      videoRouteId: videoRouteSnapshot.videoRouteSnapshot,
      reason: selectedRouteAvailability.reason,
    });
    return finalResponse(
      toCustomerVideoDispatchError({
        code: "SERVICE_UNAVAILABLE",
        message:
          selectedRouteAvailability.reason === "insufficient_balance"
            ? "合作方视频线路暂时余额不足，请稍后重试；若持续发生，请联系支持。"
            : "合作方视频生成服务暂时不可用，请稍后重试；若持续发生，请联系支持。",
        retryable: true,
        action: "retry",
      }),
      503,
    );
  }

  const request = reqParsed.data;
  const persona =
    request.userType === "business"
      ? "BUSINESS"
      : request.userType === "personal"
        ? "PERSONAL"
        : "PLATFORM";
  let directorPlanJson: ReturnType<typeof mapPlanToDirectorPlan>;
  try {
    directorPlanJson = mapPlanToDirectorPlan({
      plan,
      language: request.language ?? "en",
    });
  } catch (error) {
    console.error("[dispatch] director plan mapping failed", {
      requestId: dispatchRequestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return finalResponse(
      toCustomerVideoDispatchError({
        code: "INTERNAL_ERROR",
        message: "暂时无法准备视频方案，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      500,
    );
  }

  if (videoRouteSnapshot.videoRouteSnapshot === "buddy") {
    const hasInvalidReferenceUrl = plan.classifiedAssets
      .filter((asset) => asset.type === "IMAGE")
      .some((asset) => {
        try {
          return new URL(asset.url).protocol !== "https:";
        } catch {
          return true;
        }
      });
    const hasInvalidSegment = directorPlanJson.segmentPlan.some((segment) => {
      const mergedPrompt = segment.negativePrompt?.trim()
        ? `${segment.seedancePrompt}\nNegative constraints: ${segment.negativePrompt.trim()}`
        : segment.seedancePrompt;
      return (
        !Number.isInteger(segment.durationSec) ||
        segment.durationSec < 5 ||
        segment.durationSec > 15 ||
        !mergedPrompt.trim() ||
        mergedPrompt.length > 5_000
      );
    });
    if (hasInvalidReferenceUrl || hasInvalidSegment) {
      return finalResponse(
        toCustomerVideoDispatchError({
          code: "VALIDATION_FAILED",
          message: hasInvalidReferenceUrl
            ? "合作方线路只接受 HTTPS 图片地址，请更换素材后重试。"
            : "当前方案不符合合作方线路的时长或提示词限制，请修改后重试。",
          retryable: false,
          action: "fix_request",
        }),
        422,
      );
    }
  }

  const seedanceSegmentCount = plan.segments.filter(
    (s) => s.type === "ai_generated_clip",
  ).length;
  const videoDispatchQuotaAmount = batchCount;
  const seedanceSegmentQuotaAmount =
    Math.max(1, seedanceSegmentCount) * batchCount;
  let quotaReceipt: Awaited<
    ReturnType<typeof assertQuotaBatchForSession>
  >;
  try {
    const receipt = await assertQuotaBatchForSession(session, [
      {
        resource: "VIDEO_DISPATCH",
        amount: videoDispatchQuotaAmount,
        metadata: {
          requestId: dispatchRequestId,
          phase: "direct_dispatch_authorization",
        },
      },
      {
        resource: "SEEDANCE_SEGMENT",
        amount: seedanceSegmentQuotaAmount,
        metadata: {
          requestId: dispatchRequestId,
          phase: "direct_dispatch_authorization",
        },
      },
    ]);
    // A few isolated route tests still stub the pre-receipt void contract.
    // Treat that legacy stub as unmetered; production always returns a receipt.
    quotaReceipt = receipt ?? {
      consumed: false,
      periodKey: currentUsagePeriodKey(),
    };
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) {
      const quotaBody = (await quotaRes.clone().json()) as {
        code?: unknown;
        error?: unknown;
        resource?: unknown;
        used?: unknown;
        limit?: unknown;
        periodKey?: unknown;
      };
      const metadata = {
        ...(typeof quotaBody.resource === "string"
          ? { resource: quotaBody.resource }
          : {}),
        ...(typeof quotaBody.used === "number" ? { used: quotaBody.used } : {}),
        ...(typeof quotaBody.limit === "number"
          ? { limit: quotaBody.limit }
          : {}),
        ...(typeof quotaBody.periodKey === "string"
          ? { periodKey: quotaBody.periodKey }
          : {}),
      };
      if (quotaBody.code === "QUOTA_EXCEEDED") {
        return finalResponse(
          toCustomerVideoDispatchError({
            code: "QUOTA_EXCEEDED",
            message:
              typeof quotaBody.error === "string"
                ? quotaBody.error
                : "当前视频生成额度已用尽。",
            retryable: false,
            action: "view_usage",
            ...metadata,
          }),
          quotaRes.status,
        );
      }
      return finalResponse(
        toCustomerVideoDispatchError({
          code: "RATE_LIMITED",
          message:
            typeof quotaBody.error === "string"
              ? quotaBody.error
              : "操作过于频繁，请稍后重试。",
          retryable: true,
          action: "retry",
          ...metadata,
        }),
        quotaRes.status,
      );
    }
    console.error("[/api/video-generation/dispatch] quota check failed", err);
    return finalResponse(
      toCustomerVideoDispatchError({
        code: "QUOTA_CHECK_UNAVAILABLE",
        message: "暂时无法确认剩余额度，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      503,
    );
  }
  try {
    await markVideoDispatchQuotaConsumed(dispatchRequestId);
  } catch (error) {
    console.error("[dispatch] quota ownership marker failed", {
      requestId: dispatchRequestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return finalResponse(
      toCustomerVideoDispatchError({
        code: "INTERNAL_ERROR",
        message:
          "额度记录状态尚未确认。为避免重复计费，请联系支持核对。",
        retryable: false,
        action: "contact_support",
      }),
      500,
    );
  }

  /// 单次「事务：创建 DeliveryOrder + Round + ContentAngle + VideoBrief」，
  /// 供 batch 循环复用。batchIndex > 0 时永远新建 order（多支成片各自独立）。
  async function createBriefTransaction(batchIndex: number) {
    return db.$transaction(async (tx) => {
      let orderId =
        batchIndex === 0 ? (request.deliveryOrderId ?? null) : null;

      if (!orderId) {
        const baseTitle =
          request.userType !== "personal"
            ? deriveBusinessOrderTitle({
                rawPrompt: request.rawPrompt,
                language: request.language,
                brandKit: request.brandKit,
                durationSec: request.selectedDuration,
                platform: request.platform,
              })
            : firstLine(request.rawPrompt) || "Untitled video";
        const orderTitle =
          batchCount > 1 ? `${baseTitle}（第 ${batchIndex + 1} 支）` : baseTitle;

        const order = await tx.deliveryOrder.create({
          data: {
            title: orderTitle,
            status: DeliveryOrderStatus.ROUND_ACTIVE,
            productCategory: "unified_input",
            targetPlatform: plan.inputClassification.targetPlatform,
            targetCountry: countryFromLanguage(request.language ?? "en"),
            targetLanguage: simpleLanguageCode(request.language ?? "en"),
            productInput: {
              source: "unified_input",
              // S5 provenance：与历史脚本写入的 unified_input 区分，供迁移/审计只读识别。
              requestOrigin: "web_app",
              userType: request.userType,
              rawPrompt: request.rawPrompt,
              brandKit: request.brandKit ?? null,
            },
            // Phase 3: every new customer project can flow through three
            // measured racing rounds; the first render still creates only R1.
            maxRounds: 3,
            createdById: session.user.id,
          },
        });
        orderId = order.id;
      }

      /// 找最大 roundIndex，新建下一轮（unified-input 永远新建一轮，便于后续 retry / 二次 dispatch）
      const lastRound = await tx.round.findFirst({
        where: { deliveryOrderId: orderId },
        orderBy: { roundIndex: "desc" },
      });
      const round = await tx.round.create({
        data: {
          deliveryOrderId: orderId,
          roundIndex: (lastRound?.roundIndex ?? 0) + 1,
          status: RoundStatus.ANGLES_READY,
          optimizationSlots: 1,
          explorationSlots: 0,
          startedAt: new Date(),
        },
      });

      const angle = await tx.contentAngle.create({
        data: {
          roundId: round.id,
          sortOrder: 0,
          type: AngleType.OPTIMIZATION,
          title: plan.creativeBrief.hook.slice(0, 200) || "Unified input angle",
          hook: plan.creativeBrief.hook,
          narrative: plan.creativeBrief.narrative,
          localeNotes: {
            unifiedInputUserType: request.userType,
            cta: plan.creativeBrief.cta ?? null,
          },
        },
      });

      const brief = await tx.videoBrief.create({
        data: {
          contentAngleId: angle.id,
          status: VideoBriefStatus.SCENE_PROMPT_READY,
          durationSec: request.selectedDuration,
          targetDurationSec: request.selectedDuration,
          aspectRatio: request.selectedAspectRatio,
          tone: plan.creativeBrief.emotionalAngle,
          referenceImageUrls: plan.classifiedAssets
            .filter((a) => a.type === "IMAGE")
            .map((a) => a.url),
          directorPlan: directorPlanJson as unknown as object,
          videoGenerationPlan: plan as unknown as object,
          persona,
          ...videoRouteSnapshot,
        },
      });

      return { briefId: brief.id, deliveryOrderId: orderId! };
    });
  }

  let providerSubmissionStarted = false;
  try {
    /// batch 循环：逐支创建 + 调度（Seedance 侧仍是每段一个 job）。
    /// 单支失败即中断并向用户报错 —— 已成功的支保留（用户可在成片库看到）。
    const batchResults: Array<{
      briefId: string;
      deliveryOrderId: string;
      videoJobs: unknown[];
    }> = [];
    for (let i = 0; i < batchCount; i++) {
      const { briefId, deliveryOrderId } = await createBriefTransaction(i);
      /// 调 Seedance（multi-segment 或 single-segment 自动选）
      providerSubmissionStarted = true;
      const dispatched = await dispatchVideoForBrief(briefId);
      batchResults.push({
        briefId,
        deliveryOrderId,
        videoJobs: Array.isArray(dispatched) ? dispatched : [dispatched],
      });
    }

    const submittedJobs = batchResults.flatMap((result) => result.videoJobs) as Array<{
      id?: string;
      videoBriefId?: string | null;
      status?: string;
      submissionState?: string;
      submissionErrorClass?: string | null;
      externalJobId?: string | null;
    }>;
    if (
      submittedJobs.length > 0 &&
      submittedJobs.every((job) => job?.status === "FAILED")
    ) {
      const acknowledgementUnknown = submittedJobs.some(
        (job) => job?.submissionState === "ACK_UNKNOWN",
      );
      if (acknowledgementUnknown) {
        return finalResponse(
          toCustomerVideoDispatchError({
            code: "SUBMISSION_ACK_UNKNOWN",
            message:
              "生成服务可能已接收任务。系统已停止重复提交以避免重复计费，请联系支持核对。",
            retryable: false,
            action: "contact_support",
          }),
          409,
        );
      }
      const briefIds = batchResults.map((result) => result.briefId);
      const briefIdSet = new Set(briefIds);
      const safelyRejectedBeforeCreation =
        batchResults.length === videoDispatchQuotaAmount &&
        submittedJobs.length === seedanceSegmentQuotaAmount &&
        submittedJobs.every(
          (job) =>
            typeof job.id === "string" &&
            typeof job.videoBriefId === "string" &&
            briefIdSet.has(job.videoBriefId) &&
            job.submissionState === "REJECTED" &&
            job.externalJobId == null &&
            /^definitely_not_created:(?:preflight|transport|provider_response)$/.test(
              job.submissionErrorClass ?? "",
            ),
        );
      if (!safelyRejectedBeforeCreation) {
        return uncompensatedProviderFailureResponse();
      }

      try {
        const compensation = await compensateDirectDispatchQuota({
          requestId: dispatchRequestId,
          userId: session.user.id,
          briefIds,
          videoDispatchAmount: videoDispatchQuotaAmount,
          seedanceSegmentAmount: seedanceSegmentQuotaAmount,
          periodKey: quotaReceipt.periodKey,
          quotaWasMetered: quotaReceipt.consumed,
          reason: "all_jobs_rejected_definitely_not_created",
          responseStatus: 503,
        });
        console.info("[dispatch] quota compensation completed", {
          requestId: dispatchRequestId,
          compensated: compensation.compensated,
          replayed: compensation.replayed,
          metered: quotaReceipt.consumed,
        });
      } catch (error) {
        console.error("[dispatch] quota compensation failed closed", {
          requestId: dispatchRequestId,
          error: error instanceof Error ? error.message : String(error),
        });
        return uncompensatedProviderFailureResponse();
      }

      return finalResponse(
        toCustomerVideoDispatchError({
          code: "PROVIDER_ERROR",
          message: quotaReceipt.consumed
            ? "生成服务明确未创建任务，额度已自动返还。请联系支持处理服务配置后再试。"
            : "生成服务明确未创建任务。请联系支持处理服务配置后再试。",
          retryable: false,
          action: "contact_support",
        }),
        503,
      );
    }

    const first = batchResults[0];
    /// 给前端一个明确「下一步去哪」+ user-facing status，避免 hardcode 路径
    const nextUrl =
      request.userType === "platform"
        ? `/app/library?highlight=${first.deliveryOrderId}`
        : request.userType === "business"
          ? `/business/products?highlight=${first.deliveryOrderId}`
          : `/personal/videos?highlight=${first.deliveryOrderId}`;
    const userStatus = deriveBusinessStatus({
      briefStatus: VideoBriefStatus.RENDER_QUEUED,
      segmentsTotal: first.videoJobs.length,
      segmentsSucceeded: 0,
    });

    const responseBody = {
      ok: true,
      deliveryOrderId: first.deliveryOrderId,
      briefId: first.briefId,
      videoJobs: first.videoJobs,
      batch: batchResults.map((b) => ({
        briefId: b.briefId,
        deliveryOrderId: b.deliveryOrderId,
      })),
      planPreview: plan.planPreview,
      nextUrl,
      userStatus,
    };
    return finalResponse(responseBody, 200);
  } catch (err) {
    console.error("[/api/video-generation/dispatch]", err);
    return finalResponse(
      toCustomerVideoDispatchError({
        code: providerSubmissionStarted
          ? "SUBMISSION_ACK_UNKNOWN"
          : "INTERNAL_ERROR",
        message: providerSubmissionStarted
          ? "生成服务的接收状态尚未确认。为避免重复计费，请联系支持核对。"
          : "任务未能完成登记。为避免重复扣减额度，请联系支持核对。",
        retryable: false,
        action: "contact_support",
      }),
      500,
    );
  }
}

function firstLine(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return t.split("\n")[0].slice(0, 200);
}

function simpleLanguageCode(lang: string): string {
  return lang.split("-")[0].toLowerCase();
}

function countryFromLanguage(lang: string): string {
  const parts = lang.split("-");
  if (parts.length === 2) return parts[1].toUpperCase();
  switch (parts[0].toLowerCase()) {
    case "zh":
      return "CN";
    case "en":
      return "US";
    case "fr":
      return "FR";
    case "de":
      return "DE";
    case "ja":
      return "JP";
    case "es":
      return "ES";
    default:
      return "US";
  }
}
