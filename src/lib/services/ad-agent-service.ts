import { AdEditPlanStatus, Prisma, QAStatus, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import {
  parseAdEditTimeline,
  parseDirectorOutput,
  parseReviewerOutput,
  type DirectorOutput,
  type ReviewerOutput,
  type TimelineClip,
} from "@/lib/schemas/ad-edit-plan";
import { ensureBriefForAngle } from "@/lib/services/brief-service";

const DIRECTOR_SYSTEM = `你是 Aivora 的真实素材广告 Director Agent。你要基于客户真实素材镜头、广告 angle、脚本与本地化要求，输出一条可执行广告剪辑计划。只输出 JSON。

输出 JSON:
{
  "title": "广告版本标题",
  "objective": "该版本验证什么广告假设",
  "duration_ms": 15000-35000,
  "timeline": {
    "clips": [
      {
        "footageShotId": "必须来自输入",
        "rawAssetId": "必须来自输入",
        "sourceUrl": "必须来自输入",
        "startMs": 0,
        "endMs": 3000,
        "durationMs": 3000,
        "role": "hook | proof | demo | lifestyle | cta",
        "rationale": "为什么选这个镜头"
      }
    ],
    "captions": [{ "startMs": 0, "endMs": 2500, "text": "短字幕" }],
    "overlays": [{ "startMs": 0, "endMs": 2500, "text": "屏幕文案", "position": "center" }],
    "music": { "mood": "clean_pop", "volume": 0.18 },
    "render": {
      "strategy": "ffmpeg_concat",
      "aspectRatio": "9:16",
      "fallback": "manifest",
      "reviewerRetryThreshold": 0.65
    }
  }
}

要求：
- 只能选择输入中存在的 footageShotId。
- 前 3 秒必须有 hook。
- 结尾必须有 CTA。
- 不要假装素材里有不存在的画面。`;

const REVIEWER_SYSTEM = `你是 Aivora 的广告 Reviewer Agent。请评估 EditPlan 是否适合真实素材 TikTok 广告。只输出 JSON。

输出 JSON:
{
  "scores": {
    "hook": 0-1,
    "pacing": 0-1,
    "visual_match": 0-1,
    "offer_clarity": 0-1,
    "technical_quality": 0-1
  },
  "summary": "中文 50-120 字总结",
  "feedback": ["具体可执行修改建议"],
  "route": "auto_pass | needs_review | reject"
}`;

export async function generateAdEditPlansForRound(roundId: string, count = 5) {
  const round = await db.round.findUnique({
    where: { id: roundId },
    include: {
      angles: {
        orderBy: { sortOrder: "asc" },
        include: { videoBrief: true },
      },
    },
  });
  if (!round) throw new Error("轮次不存在");
  if (round.angles.length === 0) throw new Error("请先生成 angle");

  const selectedAngles = round.angles.slice(0, count);
  const plans = [];
  for (const angle of selectedAngles) {
    const brief = angle.videoBrief ?? (await ensureBriefForAngle(angle.id));
    plans.push(await generateAdEditPlanForBrief(brief.id));
  }

  await db.round.update({
    where: { id: roundId },
    data: { status: "VIDEOS_IN_FLIGHT" },
  });
  return plans;
}

export async function generateAdEditPlanForBrief(briefId: string) {
  const ctx = await loadDirectorContext(briefId);
  if (!ctx.brief) throw new Error("Brief 不存在");
  if (ctx.shots.length === 0) {
    throw new Error(
      "没有可用 FootageShot：该交付单还没有素材镜头索引。请先上传至少 3 个真实视频素材，在订单页点击「预处理并打标签」，确认每个 RawAsset 至少生成 1 个 shot 后再生成广告。",
    );
  }

  const output = parseDirectorOutput(
    isLLMAvailable() && ctx.shots.length > 0
      ? await llmDirector(ctx)
      : mockDirector(ctx),
  );

  const version = await nextPlanVersion(briefId);
  const plan = await db.adEditPlan.create({
    data: {
      videoBriefId: briefId,
      version,
      status: AdEditPlanStatus.READY,
      title: output.title,
      objective: output.objective,
      durationMs: output.duration_ms,
      aspectRatio: ctx.brief.aspectRatio,
      timeline: normalizeTimeline(output.timeline) as unknown as Prisma.InputJsonValue,
    },
  });

  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.RENDER_QUEUED },
  });

  return runAdPlanReviewer(plan.id);
}

export async function runAdPlanReviewer(planId: string) {
  const plan = await db.adEditPlan.findUnique({
    where: { id: planId },
    include: {
      videoBrief: {
        include: {
          contentAngle: {
            include: { round: { include: { deliveryOrder: true } } },
          },
          scripts: { where: { isCurrent: true }, take: 1 },
        },
      },
    },
  });
  if (!plan) throw new Error("剪辑计划不存在");

  const result = parseReviewerOutput(
    isLLMAvailable()
      ? await llmReview(plan)
      : mockReview(plan.timeline),
  );

  const overall = average(Object.values(result.scores));
  const updated = await db.adEditPlan.update({
    where: { id: planId },
    data: {
      status: AdEditPlanStatus.REVIEWED,
      reviewScores: result.scores as unknown as Prisma.InputJsonValue,
      reviewSummary: result.summary,
      reviewerFeedback: result.feedback as unknown as Prisma.InputJsonValue,
    },
  });

  await upsertPendingQAFromPlan({
    briefId: plan.videoBriefId,
    overall,
    result,
  });

  return updated;
}

async function loadDirectorContext(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      contentAngle: {
        include: {
          round: {
            include: {
              deliveryOrder: {
                include: {
                  marketResearch: true,
                  sellingPoints: { orderBy: { rank: "asc" } },
                  rawAssets: {
                    include: {
                      shots: {
                        where: { status: { not: "REJECTED" } },
                        orderBy: [{ qualityScore: "desc" }, { shotIndex: "asc" }],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      scripts: { where: { isCurrent: true }, take: 1 },
    },
  });

  const shots =
    brief?.contentAngle.round.deliveryOrder.rawAssets.flatMap((asset) =>
      asset.shots.map((shot) => ({
        footageShotId: shot.id,
        rawAssetId: asset.id,
        assetName: asset.name,
        sourceUrl: asset.url,
        startMs: shot.startMs,
        endMs: shot.endMs,
        durationMs: shot.durationMs,
        transcript: shot.transcript,
        visualSummary: shot.visualSummary,
        tags: shot.tags,
        qualityScore: shot.qualityScore,
      })),
    ) ?? [];

  return { brief, shots };
}

async function llmDirector(ctx: Awaited<ReturnType<typeof loadDirectorContext>>) {
  const brief = ctx.brief;
  if (!brief) throw new Error("Brief 不存在");
  const order = brief.contentAngle.round.deliveryOrder;
  const user = JSON.stringify(
    {
      product_input: order.productInput,
      market_research: order.marketResearch?.structured,
      selling_points: order.sellingPoints.map((sp) => ({
        title: sp.title,
        body: sp.body,
        kind: sp.kind,
      })),
      target: {
        country: order.targetCountry,
        language: order.targetLanguage,
        region: order.targetRegionVariant,
      },
      angle: {
        title: brief.contentAngle.title,
        hook: brief.contentAngle.hook,
        narrative: brief.contentAngle.narrative,
        locale_notes: brief.contentAngle.localeNotes,
      },
      script: brief.scripts[0]?.fullText,
      aspect_ratio: brief.aspectRatio,
      target_duration_sec: brief.durationSec,
      footage_shots: ctx.shots,
    },
    null,
    2,
  );
  const { data } = await chatJson<DirectorOutput>({
    system: DIRECTOR_SYSTEM,
    user,
    temperature: 0.55,
    maxTokens: 3500,
  });
  return data;
}

async function llmReview(
  plan: NonNullable<Awaited<ReturnType<typeof db.adEditPlan.findUnique>>>,
) {
  const { data } = await chatJson<ReviewerOutput>({
    system: REVIEWER_SYSTEM,
    user: JSON.stringify(
      {
        title: plan.title,
        objective: plan.objective,
        durationMs: plan.durationMs,
        timeline: plan.timeline,
      },
      null,
      2,
    ),
    temperature: 0.25,
    maxTokens: 1600,
  });
  return data;
}

function mockDirector(
  ctx: Awaited<ReturnType<typeof loadDirectorContext>>,
): DirectorOutput {
  const brief = ctx.brief;
  if (!brief) throw new Error("Brief 不存在");
  const picked = ctx.shots.slice(0, 5);
  const clips = picked.map((shot, index) => ({
    footageShotId: shot.footageShotId,
    rawAssetId: shot.rawAssetId,
    sourceUrl: shot.sourceUrl,
    startMs: shot.startMs,
    endMs: shot.endMs,
    durationMs: shot.durationMs,
    role: (index === 0
      ? "hook"
      : index === picked.length - 1
        ? "cta"
        : index % 2 === 0
          ? "demo"
          : "proof") as TimelineClip["role"],
    rationale:
      shot.visualSummary ??
      `用 ${shot.assetName} 的第 ${index + 1} 个镜头承接 ${brief.contentAngle.title}`,
  }));
  const duration = clips.reduce((sum, clip) => sum + clip.durationMs, 0);
  return {
    title: `${brief.contentAngle.title} · real footage cut`,
    objective: "验证真实素材的前 3 秒 hook、产品证明和 CTA 是否能形成完整广告闭环。",
    duration_ms: duration,
    timeline: {
      clips,
      captions: buildCaptions(brief, duration),
      overlays: buildOverlays(brief, duration),
      music: { mood: "clean_pop", volume: 0.18 },
      render: {
        strategy: "ffmpeg_concat",
        aspectRatio: "9:16",
        fallback: "manifest",
        reviewerRetryThreshold: 0.65,
      },
    },
  };
}

function mockReview(timeline: Prisma.JsonValue): ReviewerOutput {
  const clips = jsonObject(timeline).clips;
  const clipCount = Array.isArray(clips) ? clips.length : 0;
  const base = clipCount >= 3 ? 0.76 : 0.58;
  return {
    scores: {
      hook: base,
      pacing: Math.min(0.88, base + 0.04),
      visual_match: base,
      offer_clarity: Math.min(0.86, base + 0.03),
      technical_quality: clipCount > 0 ? 0.72 : 0.42,
    },
    summary:
      clipCount >= 3
        ? "[Mock] 剪辑计划具备 hook、证明与 CTA 基本结构，可进入人工审核。"
        : "[Mock] 可用镜头不足，建议补充更多真实素材后再渲染。",
    feedback:
      clipCount >= 3
        ? ["渲染后重点检查字幕节奏与前 3 秒画面冲击力。"]
        : ["至少补充 3 个不同场景镜头，避免广告画面单薄。"],
    route: clipCount >= 3 ? "needs_review" : "reject",
  };
}

function normalizeTimeline(timeline: unknown) {
  return parseAdEditTimeline(timeline);
}

function buildCaptions(
  brief: NonNullable<Awaited<ReturnType<typeof loadDirectorContext>>["brief"]>,
  durationMs: number,
) {
  const hook = brief.contentAngle.hook ?? brief.contentAngle.title;
  const script = brief.scripts[0]?.fullText;
  return [
    { startMs: 0, endMs: Math.min(3000, durationMs), text: hook },
    {
      startMs: Math.max(3000, Math.floor(durationMs * 0.55)),
      endMs: durationMs,
      text: script ? script.slice(0, 80) : "See why customers keep watching.",
    },
  ];
}

function buildOverlays(
  brief: NonNullable<Awaited<ReturnType<typeof loadDirectorContext>>["brief"]>,
  durationMs: number,
) {
  return [
    {
      startMs: 0,
      endMs: Math.min(2500, durationMs),
      text: brief.contentAngle.title,
      position: "center" as const,
    },
    {
      startMs: Math.max(0, durationMs - 3000),
      endMs: durationMs,
      text: "Tap to learn more",
      position: "bottom" as const,
    },
  ];
}

async function nextPlanVersion(briefId: string) {
  const last = await db.adEditPlan.findFirst({
    where: { videoBriefId: briefId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

async function upsertPendingQAFromPlan(params: {
  briefId: string;
  overall: number;
  result: ReviewerOutput;
}) {
  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: params.briefId, status: QAStatus.PENDING },
    orderBy: { createdAt: "desc" },
  });
  const data = {
    aiOverallScore: Number((params.overall * 10).toFixed(1)),
    aiScoreBreakdown: params.result.scores as unknown as Prisma.InputJsonValue,
    aiIssues: params.result.feedback as unknown as Prisma.InputJsonValue,
    aiSuggestions: params.result.feedback as unknown as Prisma.InputJsonValue,
    aiReviewRoute: params.result.route,
    reviewerComment: params.result.summary,
  };

  if (existing) {
    await db.qAReview.update({ where: { id: existing.id }, data });
  } else {
    await db.qAReview.create({
      data: {
        videoBriefId: params.briefId,
        status: QAStatus.PENDING,
        ...data,
      },
    });
  }
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
