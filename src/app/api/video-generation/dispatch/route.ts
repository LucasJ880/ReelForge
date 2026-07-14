import { NextRequest, NextResponse } from "next/server";
import { AngleType, DeliveryOrderStatus, RoundStatus, VideoBriefStatus } from "@prisma/client";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import { assertQuotaBatchForSession } from "@/lib/services/quota-service";
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
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const body = await req.json().catch(() => null);
  const idempotencyKey = validateIdempotencyKey(
    req.headers.get("idempotency-key"),
  );
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        ok: false,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        error: "请刷新页面后重新提交",
        retryable: false,
      },
      { status: 400 },
    );
  }
  const requestHash = hashVideoDispatchRequest(body);

  const reqParsed = unifiedVideoGenerationRequestSchema.safeParse(body?.request);
  if (!reqParsed.success) {
    return NextResponse.json(
      { ok: false, error: "request 参数不合法", issues: reqParsed.error.flatten() },
      { status: 400 },
    );
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
      return NextResponse.json(
        { ok: false, error: "权限不足：persona 与 request.userType 不一致" },
        { status: 403 },
      );
    }
  }

  /// Phase 1：始终服务端重建 plan 防 UI tamper
  let plan: Awaited<ReturnType<typeof buildPlan>>;
  try {
    plan = await buildPlan(reqParsed.data);
  } catch (err) {
    /// 客户可见 error 走友好文案；详细 message 仅写日志 / dev 调试
    console.error("[/api/video-generation/dispatch] buildPlan failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "无法生成视频方案，请稍后重试",
        debugMessage:
          process.env.NODE_ENV !== "production"
            ? (err as Error).message
            : undefined,
      },
      { status: 500 },
    );
  }

  /// 如果 body.plan 存在，校验它是个合法 plan（仅作 sanity check；最终用 server plan）
  if (body?.plan) {
    const optParse = videoGenerationPlanSchema.safeParse(body.plan);
    if (!optParse.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "提交内容有误，请刷新页面后重试",
          debugIssues:
            process.env.NODE_ENV !== "production"
              ? optParse.error.flatten()
              : undefined,
        },
        { status: 400 },
      );
    }
  }

  /// 用户确认过的脚本覆盖：只替换对应 AI 段的 prompt 文本，其余结构保持 server plan
  if (body?.confirmedPrompts != null) {
    const cpParse = confirmedPromptsSchema.safeParse(body.confirmedPrompts);
    if (!cpParse.success) {
      return NextResponse.json(
        { ok: false, error: "确认的脚本内容不合法，请刷新后重试" },
        { status: 400 },
      );
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

  /// 多批量出片：一次确认可同时出 1-3 支（同 plan 不同种子，提升可用率）
  let batchCount = 1;
  if (body?.batchCount != null) {
    const bcParse = batchCountSchema.safeParse(body.batchCount);
    if (!bcParse.success) {
      return NextResponse.json(
        { ok: false, error: "batchCount 参数不合法（1-3）" },
        { status: 400 },
      );
    }
    batchCount = bcParse.data;
  }

  /// quality blocker 守门：blocker > 0 → 拒绝
  if (!plan.qualityReview.canDispatch) {
    return NextResponse.json(
      {
        ok: false,
        error: "您的描述还需要更多细节才能生成视频，请补充后重试",
        blockers: plan.qualityReview.blockers,
      },
      { status: 422 },
    );
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
    return NextResponse.json(
      { ok: false, error: BREAKER_USER_MESSAGE, retryable: true },
      { status: 503 },
    );
  }

  const dispatchClaim = await claimVideoDispatchRequest({
    userId: session.user.id,
    idempotencyKey,
    requestHash,
  });
  if (dispatchClaim.outcome === "replay") {
    return NextResponse.json(dispatchClaim.body, {
      status: dispatchClaim.status,
    });
  }
  if (dispatchClaim.outcome === "conflict") {
    return NextResponse.json(
      {
        ok: false,
        code: "IDEMPOTENCY_KEY_CONFLICT",
        error: "该提交标识已用于另一份内容，请刷新页面后重试",
        retryable: false,
      },
      { status: 409 },
    );
  }
  if (dispatchClaim.outcome === "in_progress") {
    return NextResponse.json(
      {
        ok: false,
        code: "REQUEST_IN_PROGRESS",
        error: "该视频请求正在处理中，请勿重复提交",
        retryable: false,
        action: "refresh_status",
      },
      { status: 409 },
    );
  }
  const dispatchRequestId = dispatchClaim.request.id;
  async function finalResponse(body: unknown, status: number) {
    await completeVideoDispatchRequest({
      requestId: dispatchRequestId,
      status,
      body,
    });
    return NextResponse.json(body, { status });
  }

  const seedanceSegmentCount = plan.segments.filter(
    (s) => s.type === "ai_generated_clip",
  ).length;
  try {
    await assertQuotaBatchForSession(session, [
      { resource: "VIDEO_DISPATCH", amount: batchCount },
      {
        resource: "SEEDANCE_SEGMENT",
        amount: Math.max(1, seedanceSegmentCount) * batchCount,
      },
    ]);
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) {
      const quotaBody = await quotaRes.clone().json();
      await completeVideoDispatchRequest({
        requestId: dispatchRequestId,
        status: quotaRes.status,
        body: quotaBody,
      });
      return quotaRes;
    }
    console.error("[/api/video-generation/dispatch] quota check failed", err);
    return finalResponse(
      {
        ok: false,
        code: "QUOTA_CHECK_UNAVAILABLE",
        error: "暂时无法确认剩余额度，请稍后重试",
        retryable: true,
      },
      503,
    );
  }
  await markVideoDispatchQuotaConsumed(dispatchRequestId);

  const request = reqParsed.data;
  const persona =
    request.userType === "business"
      ? "BUSINESS"
      : request.userType === "personal"
        ? "PERSONAL"
        : "PLATFORM";
  const directorPlanJson = mapPlanToDirectorPlan({ plan, language: request.language ?? "en" });

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
        },
      });

      return { briefId: brief.id, deliveryOrderId: orderId! };
    });
  }

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
      const dispatched = await dispatchVideoForBrief(briefId);
      batchResults.push({
        briefId,
        deliveryOrderId,
        videoJobs: Array.isArray(dispatched) ? dispatched : [dispatched],
      });
    }

    const submittedJobs = batchResults.flatMap((result) => result.videoJobs) as Array<{
      status?: string;
      submissionState?: string;
    }>;
    if (
      submittedJobs.length > 0 &&
      submittedJobs.every((job) => job?.status === "FAILED")
    ) {
      const acknowledgementUnknown = submittedJobs.some(
        (job) => job?.submissionState === "ACK_UNKNOWN",
      );
      return finalResponse(
        {
          ok: false,
          code: acknowledgementUnknown
            ? "SUBMISSION_ACK_UNKNOWN"
            : "PROVIDER_UNAVAILABLE",
          error: acknowledgementUnknown
            ? "生成服务可能已接收任务。系统已停止重复提交以避免重复计费，请联系支持核对。"
            : "暂时无法开始生成，请检查素材后稍后重试",
          retryable: !acknowledgementUnknown,
          action: acknowledgementUnknown ? "contact_support" : "retry",
        },
        acknowledgementUnknown ? 409 : 503,
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
      {
        ok: false,
        code: "DISPATCH_FAILED",
        error: "无法开始生成视频，请稍后重试",
        retryable: true,
        debugMessage:
          process.env.NODE_ENV !== "production"
            ? (err as Error).message
            : undefined,
      },
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
