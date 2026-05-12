import { NextRequest, NextResponse } from "next/server";
import { AngleType, DeliveryOrderStatus, RoundStatus, VideoBriefStatus } from "@prisma/client";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { buildPlan } from "@/lib/video-generation/generation-supervisor";
import { mapPlanToDirectorPlan } from "@/lib/video-generation/plan-to-director";
import { dispatchVideoForBrief } from "@/lib/services/video-service";
import {
  unifiedVideoGenerationRequestSchema,
  videoGenerationPlanSchema,
} from "@/lib/schemas/unified-input";

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
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const body = await req.json().catch(() => null);

  const reqParsed = unifiedVideoGenerationRequestSchema.safeParse(body?.request);
  if (!reqParsed.success) {
    return NextResponse.json(
      { ok: false, error: "request 参数不合法", issues: reqParsed.error.flatten() },
      { status: 400 },
    );
  }

  /// Phase 1：始终服务端重建 plan 防 UI tamper
  let plan;
  try {
    plan = await buildPlan(reqParsed.data);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Plan 重建失败", message: (err as Error).message },
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
          error: "传入 plan 不合法（你可以省略该字段，让服务端自动重建）",
          issues: optParse.error.flatten(),
        },
        { status: 400 },
      );
    }
  }

  /// quality blocker 守门：blocker > 0 → 拒绝
  if (!plan.qualityReview.canDispatch) {
    return NextResponse.json(
      {
        ok: false,
        error: "Plan 未通过质量审核，请修改 prompt 或资产后重试",
        blockers: plan.qualityReview.blockers,
      },
      { status: 422 },
    );
  }

  const request = reqParsed.data;
  const persona =
    request.userType === "business" ? "BUSINESS" : "PERSONAL";
  const directorPlanJson = mapPlanToDirectorPlan({ plan, language: request.language ?? "en" });

  try {
    /// 事务：创建 DeliveryOrder + Round + ContentAngle + VideoBrief
    const { briefId, deliveryOrderId } = await db.$transaction(async (tx) => {
      let orderId = request.deliveryOrderId ?? null;

      if (!orderId) {
        const order = await tx.deliveryOrder.create({
          data: {
            title:
              firstLine(request.rawPrompt) ||
              (request.userType === "business" ? "Untitled ad" : "Untitled video"),
            status: DeliveryOrderStatus.ROUND_ACTIVE,
            productCategory: "unified_input",
            targetPlatform: plan.inputClassification.targetPlatform,
            targetCountry: countryFromLanguage(request.language ?? "en"),
            targetLanguage: simpleLanguageCode(request.language ?? "en"),
            productInput: {
              source: "unified_input",
              userType: request.userType,
              rawPrompt: request.rawPrompt,
              brandKit: request.brandKit ?? null,
            },
            maxRounds: 1,
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

    /// 调 Seedance（multi-segment 或 single-segment 自动选）
    const dispatched = await dispatchVideoForBrief(briefId);

    return NextResponse.json({
      ok: true,
      deliveryOrderId,
      briefId,
      videoJobs: Array.isArray(dispatched) ? dispatched : [dispatched],
      planPreview: plan.planPreview,
    });
  } catch (err) {
    console.error("[/api/video-generation/dispatch]", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Dispatch 失败",
        message: (err as Error).message,
      },
      { status: 500 },
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
