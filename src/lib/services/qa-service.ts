import { Prisma, QAStatus, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJsonByTier, isLLMAvailable } from "@/lib/ai";
import {
  QA_CRITERIA,
  calcOverallScore,
  deriveReviewRoute,
  type QAScoreBreakdown,
} from "@/lib/config/qa-criteria";

const SYSTEM_PROMPT = `你是一名 TikTok 短视频交付质检员。给你 brief + 脚本 + prompt + 成片描述（若有），请按 8 个维度 0-10 打分并列出问题和建议。只输出 JSON。

维度：hook_quality / topic_alignment / angle_alignment / format_alignment / cta_quality / duration_fitness / brief_alignment / technical_completeness

输出 JSON:
{
  "score_breakdown": { "hook_quality": 0-10, ... },
  "issues": ["问题 1", "问题 2"],
  "suggestions": ["建议 1"],
  "reasoning": "整体评价，英文，50-100 词"
}

要求：每个维度打分都必须是 0-10 的数字；分数 >= 9 表示当前水平优秀。`;

export async function runAIQA(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      contentAngle: true,
      scripts: { where: { isCurrent: true }, take: 1 },
      videoJobs: { where: { status: "SUCCEEDED" }, take: 1 },
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  const script = brief.scripts[0];

  let breakdown: QAScoreBreakdown;
  let issues: string[] = [];
  let suggestions: string[] = [];
  let reasoning = "";

  if (isLLMAvailable() && script) {
    const user = `Angle:
- title: ${brief.contentAngle.title}
- hook: ${brief.contentAngle.hook}
- narrative: ${brief.contentAngle.narrative}

Brief:
- duration_sec: ${brief.durationSec}
- on_camera_mode: ${brief.onCameraMode}

脚本:
${script.fullText}

是否已有成片: ${brief.videoJobs.length > 0 ? "是" : "否"}

请按 8 个维度打分。`;

    const { data } = await chatJsonByTier<{
      score_breakdown: QAScoreBreakdown;
      issues: string[];
      suggestions: string[];
      reasoning: string;
    }>({
      tier: "qa",
      stage: "ai_qa_review",
      system: SYSTEM_PROMPT,
      user,
      temperature: 0.3,
      maxTokens: 2000,
    });
    breakdown = data.score_breakdown;
    issues = data.issues ?? [];
    suggestions = data.suggestions ?? [];
    reasoning = data.reasoning ?? "";
  } else {
    // Mock：全部 7 分
    breakdown = Object.fromEntries(
      QA_CRITERIA.map((c) => [c.key, 7]),
    ) as QAScoreBreakdown;
    issues = ["[Mock] LLM 未配置，全维度按 7 分打分"];
    suggestions = ["接入 OPENAI_API_KEY 以获得真实打分"];
    reasoning = "[Mock] 占位分数";
  }

  const overall = calcOverallScore(breakdown);
  const route = deriveReviewRoute(overall);

  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: briefId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  const saved = existing
    ? await db.qAReview.update({
        where: { id: existing.id },
        data: {
          aiOverallScore: overall,
          aiScoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
          aiIssues: issues as unknown as Prisma.InputJsonValue,
          aiSuggestions: suggestions as unknown as Prisma.InputJsonValue,
          aiReviewRoute: route,
          reviewerComment: reasoning,
        },
      })
    : await db.qAReview.create({
        data: {
          videoBriefId: briefId,
          status: QAStatus.PENDING,
          aiOverallScore: overall,
          aiScoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
          aiIssues: issues as unknown as Prisma.InputJsonValue,
          aiSuggestions: suggestions as unknown as Prisma.InputJsonValue,
          aiReviewRoute: route,
          reviewerComment: reasoning,
        },
      });

  return saved;
}

export async function decideQA(
  id: string,
  reviewerId: string,
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
  comment?: string,
) {
  const review = await db.qAReview.findUnique({
    where: { id },
    include: { videoBrief: true },
  });
  if (!review) throw new Error("QA 记录不存在");

  const updated = await db.qAReview.update({
    where: { id },
    data: {
      status: QAStatus[decision],
      reviewerId,
      reviewerComment: comment ?? review.reviewerComment,
      reviewedAt: new Date(),
    },
  });

  if (decision === "APPROVED") {
    await db.videoBrief.update({
      where: { id: review.videoBriefId },
      data: { status: VideoBriefStatus.QA_APPROVED },
    });
    // 自动建立发布待办
    await ensurePublishPending(review.videoBriefId);
  } else if (decision === "REJECTED") {
    await db.videoBrief.update({
      where: { id: review.videoBriefId },
      data: { status: VideoBriefStatus.QA_REJECTED },
    });
  } else {
    await db.videoBrief.update({
      where: { id: review.videoBriefId },
      data: { status: VideoBriefStatus.SCRIPT_DRAFTING },
    });
  }
  return updated;
}

async function ensurePublishPending(briefId: string) {
  const existing = await db.publishRecord.findFirst({
    where: { videoBriefId: briefId, status: { in: ["PENDING", "DOWNLOADED"] } },
  });
  if (existing) return;
  await db.publishRecord.create({
    data: { videoBriefId: briefId, platform: "tiktok", status: "PENDING" },
  });
  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.PUBLISH_PENDING },
  });
}
