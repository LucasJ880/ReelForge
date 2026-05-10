import { z } from "zod";
import {
  CAMERA_MOVEMENTS,
  COMPOSITIONS,
  ORIENTATIONS,
  SHOT_TYPES,
} from "./shooting-guide";

/**
 * Storyboard LLM Output —— Wizard 用的 storyboard JSON。
 *
 * 与现有 src/lib/services/scene-service.ts 的 ScenesLLM 是 superset：
 * sceneIndex/durationSec/visualIntent 字段沿用，新增 shotType / composition /
 * cameraMovement / requiredFlag / humanRequired / requiredProps / commonMistakes
 * 等字段直接喂给 shooting guide builder。
 */

export const storyboardShotSchema = z.object({
  sceneIndex: z.number().int().positive(),
  durationSec: z.number().int().min(1).max(60),
  shotType: z.enum(SHOT_TYPES),
  /// director note（英文，便于剪辑团队理解）
  visualIntent: z.string().min(5).max(800),
  /// 商家友好的拍什么（中文或英文均可）
  whatToFilm: z.string().min(5).max(400),
  composition: z.enum(COMPOSITIONS),
  cameraMovement: z.enum(CAMERA_MOVEMENTS),
  orientation: z.enum(ORIENTATIONS),
  /// 必拍 vs 可选 B-roll
  requiredFlag: z.boolean().default(true),
  humanRequired: z.boolean().default(false),
  requiredProps: z.array(z.string().min(1).max(80)).max(8).default([]),
  /// 屏幕字幕
  captionText: z.string().max(160).optional(),
  /// 该镜头对应的 voiceover 段落
  voiceoverSegment: z.string().max(400).optional(),
  /// On-camera 备注（admin 用，可选）
  onCameraNote: z.string().max(280).optional(),
});

export type StoryboardShot = z.infer<typeof storyboardShotSchema>;

export const storyboardOutputSchema = z.object({
  totalDurationSec: z.number().int().positive(),
  shots: z.array(storyboardShotSchema).min(1).max(12),
  /// 模型对整段节奏的总结（中文/英文均可），便于运营/商家理解
  pacingNote: z.string().max(400).optional(),
});

export type StoryboardOutput = z.infer<typeof storyboardOutputSchema>;

export function parseStoryboardOutput(value: unknown): StoryboardOutput {
  const parsed = storyboardOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Storyboard LLM 输出无效：${formatIssues(parsed.error.issues)}。请重试或人工调整 shot 数量/字段。`,
    );
  }
  /// duration 一致性自检（不强制 throw，由调用方决定如何处理）
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

/**
 * 对 storyboard 做 duration 总和检查（可选辅助）。
 * 返回 issues 数组而不是 throw，方便 UI 渲染建议。
 */
export function checkStoryboardDurationConsistency(
  storyboard: StoryboardOutput,
  targetDurationSec: number,
) {
  const actual = storyboard.shots.reduce((sum, s) => sum + s.durationSec, 0);
  const issues: string[] = [];
  if (storyboard.totalDurationSec !== actual) {
    issues.push(
      `storyboard.totalDurationSec=${storyboard.totalDurationSec} 与各 shot 时长之和 ${actual} 不一致`,
    );
  }
  if (Math.abs(actual - targetDurationSec) > 2) {
    issues.push(
      `storyboard 总时长 ${actual}s 与目标 ${targetDurationSec}s 偏差大于 2s，建议重生成或手动调整`,
    );
  }
  return issues;
}
