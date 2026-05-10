import { z } from "zod";

/**
 * Shooting Guide —— 把 storyboard 转成商家能直接对照拍的清单。
 *
 * 与 ScenePlan 的关系：
 * - ScenePlan.shootingGuide JSON 字段存储一条 ShootingGuideItem；
 * - listShootingGuide() 把整个 brief 的所有 scene 拼接成 ShootingGuideDoc。
 */

export const SHOT_TYPES = [
  "wide",
  "medium",
  "close_up",
  "extreme_close_up",
  "over_the_shoulder",
  "pov",
  "establishing",
  "detail",
  "talking_head",
  "b_roll",
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const COMPOSITIONS = [
  "rule_of_thirds",
  "centered",
  "symmetrical",
  "leading_lines",
  "frame_within_frame",
  "negative_space",
] as const;
export type Composition = (typeof COMPOSITIONS)[number];

export const CAMERA_MOVEMENTS = [
  "static",
  "pan",
  "tilt",
  "push_in",
  "pull_out",
  "tracking",
  "handheld",
  "gimbal",
] as const;
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];

export const ORIENTATIONS = ["portrait", "landscape", "square"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const shootingGuideItemSchema = z.object({
  sceneIndex: z.number().int().positive(),
  durationSec: z.number().int().min(1).max(60),
  shotType: z.enum(SHOT_TYPES),
  whatToFilm: z.string().min(5).max(400),
  composition: z.enum(COMPOSITIONS),
  cameraMovement: z.enum(CAMERA_MOVEMENTS),
  orientation: z.enum(ORIENTATIONS),
  /// 必拍 vs 可选 B-roll
  requiredFlag: z.boolean(),
  /// 真人是否需要出镜
  humanRequired: z.boolean().default(false),
  /// 商家可直接对照的拍摄要素
  requiredProps: z.array(z.string().min(1).max(80)).max(8).default([]),
  lightingNote: z.string().min(3).max(280).optional(),
  audioNote: z.string().min(3).max(280).optional(),
  /// 这条镜头对应的字幕（来自 storyboard caption）
  captionText: z.string().max(160).optional(),
  /// 这条镜头对应的口播（来自 script segment）
  voiceoverSegment: z.string().max(400).optional(),
  /// 商家容易踩的坑
  commonMistakes: z.array(z.string().min(3).max(280)).max(5).default([]),
  /// 上传前 self-check
  uploadHints: z.array(z.string().min(3).max(200)).max(5).default([]),
});

export type ShootingGuideItem = z.infer<typeof shootingGuideItemSchema>;

export const shootingGuideDocSchema = z.object({
  totalDurationSec: z.number().int().positive(),
  totalShots: z.number().int().nonnegative(),
  requiredShots: z.number().int().nonnegative(),
  optionalShots: z.number().int().nonnegative(),
  /// 整组 storyboard 共享的「拍摄前自检」
  preflightChecklist: z.array(z.string().min(3).max(200)).default([]),
  items: z.array(shootingGuideItemSchema).default([]),
  /// 一段简单的中文总结，可直接给商家看
  summary: z.string().min(10).max(800).optional(),
});

export type ShootingGuideDoc = z.infer<typeof shootingGuideDocSchema>;

export function parseShootingGuideItem(value: unknown): ShootingGuideItem {
  const parsed = shootingGuideItemSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `ShootingGuideItem 校验失败：${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

export function parseShootingGuideDoc(value: unknown): ShootingGuideDoc {
  const parsed = shootingGuideDocSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `ShootingGuideDoc 校验失败：${formatIssues(parsed.error.issues)}`,
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
