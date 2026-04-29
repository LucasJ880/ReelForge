import { z } from "zod";

export const timelineClipRoleSchema = z.enum([
  "hook",
  "proof",
  "demo",
  "lifestyle",
  "cta",
]);

export const timelineClipSchema = z.object({
  footageShotId: z.string().min(1, "clip.footageShotId is required"),
  rawAssetId: z.string().min(1, "clip.rawAssetId is required"),
  sourceUrl: z.string().url("clip.sourceUrl must be a valid URL"),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  role: timelineClipRoleSchema,
  rationale: z.string().min(1).max(600),
}).superRefine((clip, ctx) => {
  if (clip.endMs <= clip.startMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endMs"],
      message: "clip.endMs must be greater than clip.startMs",
    });
  }
});

export const timelineTextSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  text: z.string().min(1).max(160),
});

export const timelineOverlaySchema = timelineTextSchema.extend({
  position: z.enum(["top", "center", "bottom"]).default("center"),
});

export const adEditTimelineSchema = z.object({
  clips: z.array(timelineClipSchema).min(1, "AdEditPlan timeline must include at least one clip"),
  captions: z.array(timelineTextSchema).default([]),
  overlays: z.array(timelineOverlaySchema).default([]),
  music: z.object({
    mood: z.string().min(1).max(80),
    volume: z.number().min(0).max(1),
  }).optional(),
  render: z.object({
    strategy: z.literal("ffmpeg_concat").default("ffmpeg_concat"),
    aspectRatio: z.literal("9:16").default("9:16"),
    fallback: z.literal("manifest").default("manifest"),
    reviewerRetryThreshold: z.number().min(0).max(1).default(0.65),
  }).default({
    strategy: "ffmpeg_concat",
    aspectRatio: "9:16",
    fallback: "manifest",
    reviewerRetryThreshold: 0.65,
  }),
});

export const directorOutputSchema = z.object({
  title: z.string().min(1).max(160),
  objective: z.string().min(1).max(500),
  duration_ms: z.number().int().min(5_000).max(60_000),
  timeline: adEditTimelineSchema,
});

export const reviewerOutputSchema = z.object({
  scores: z.object({
    hook: z.number().min(0).max(1),
    pacing: z.number().min(0).max(1),
    visual_match: z.number().min(0).max(1),
    offer_clarity: z.number().min(0).max(1),
    technical_quality: z.number().min(0).max(1),
  }),
  summary: z.string().min(1).max(500),
  feedback: z.array(z.string().min(1).max(300)).default([]),
  route: z.enum(["auto_pass", "needs_review", "reject"]),
});

export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type AdEditTimeline = z.infer<typeof adEditTimelineSchema>;
export type DirectorOutput = z.infer<typeof directorOutputSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;

export function parseAdEditTimeline(value: unknown): AdEditTimeline {
  const parsed = adEditTimelineSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `AdEditPlan 校验失败：剪辑计划结构不完整，无法进入渲染。请重新生成计划或检查每个 clip 的 sourceUrl、startMs/endMs、role。具体问题：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

export function parseDirectorOutput(value: unknown): DirectorOutput {
  const parsed = directorOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `DirectorAgent 输出 JSON 无效：模型返回内容不能安全转换为 AdEditPlan。请重试生成；若持续失败，请降低素材/脚本复杂度或切换 mock fallback。具体问题：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

export function parseReviewerOutput(value: unknown): ReviewerOutput {
  const parsed = reviewerOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `ReviewerAgent 输出 JSON 无效：AI 初审结果缺少必要评分字段。请重试 ReviewerAgent。具体问题：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

function formatIssues(issues: z.ZodIssue[]) {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}
