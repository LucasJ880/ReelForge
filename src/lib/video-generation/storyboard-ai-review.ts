import { STORYBOARD_FRAME_DIRECTION_MAX } from "@/lib/video-generation/storyboard-frame-inputs";
import { STORYBOARD_REVIEW_TIMEOUT_MS } from "@/lib/video-generation/storyboard-gacha";

/**
 * 批量故事板 AI 审帧（P01-D，D-1）的开关、落库形状与纯判定。不引 db，可单测。
 *
 * 三档 STORYBOARD_AI_REVIEW=off|shadow|block，默认 off：
 * - off：不审。AUTO run 全部出图即 APPROVED（与改动前一致）。
 * - shadow：状态机不变（AUTO 仍直接 APPROVED），批量 tick 在预算内旁路审一次，结论写 aiReview。
 * - block：AUTO run 全部出图后停在 AWAITING_APPROVAL，由 cron 审帧；不过的帧按 issues 重抽，
 *   全过 / 重抽用满 / 兜底条件触发后才 CAS 到 APPROVED。
 *
 * 重抽次数记在帧行的 aiReview.regenCount（新行从旧行继承），不占 attempt 的供应商重试名额。
 */

export type StoryboardAiReviewMode = "off" | "shadow" | "block";

export function storyboardAiReviewMode(
  value: string | undefined = process.env.STORYBOARD_AI_REVIEW,
): StoryboardAiReviewMode {
  const mode = value?.trim().toLowerCase();
  return mode === "shadow" || mode === "block" ? mode : "off";
}

/// 每帧最多因审帧重抽几次（之后再不过就带 warning 放行）。阈值校准等 E13。
export const STORYBOARD_AI_REVIEW_MAX_REGENS_PER_FRAME = 2;
/// block 档兜底：在 AWAITING_APPROVAL 停留超过这个时长，不管本 tick 有没有预算都直接批准。
export const STORYBOARD_AI_REVIEW_FALLBACK_MS = 20 * 60_000;
/// block 档兜底：连续这么多个 tick 预算不足也直接批准。
export const STORYBOARD_AI_REVIEW_BUDGET_SHORT_TICKS = 3;
/// 一次审帧向 tick 预算占位的时长（审帧超时 + 余量）。
export const STORYBOARD_AI_REVIEW_RESERVE_MS = STORYBOARD_REVIEW_TIMEOUT_MS + 5_000;
/// 审帧占位租期：并发的 cron 看到未过期的占位就跳过这条 run，不重复调 vision。
export const STORYBOARD_AI_REVIEW_LEASE_MS = 2 * STORYBOARD_AI_REVIEW_RESERVE_MS;

export interface StoryboardFrameAiVerdict {
  pass: boolean;
  score: number;
  issues: string;
  mode: "shadow" | "block";
  reviewedAt: string;
}

/** StoryboardFrame.aiReview */
export interface StoryboardFrameAiReview {
  /// 走到这一行一共因审帧重抽过几次（新行从旧行继承，审帧重抽 +1）。
  regenCount: number;
  /// 这一行的审帧结论；没有 = 还没审。
  verdict?: StoryboardFrameAiVerdict;
  /// 审帧重抽用满（含 FRAME_REGENERATION_LIMIT）后放行。
  exhausted?: boolean;
}

export type StoryboardAiReviewState =
  | "reviewing"
  | "regenerating"
  | "passed"
  | "approved_with_warning"
  | "skipped"
  | "shadow_done";

/** StoryboardRun.aiReviewSummary */
export interface StoryboardAiReviewSummary {
  mode: "shadow" | "block";
  state: StoryboardAiReviewState;
  /// 这一轮累计因审帧重抽的帧次。
  regenRound: number;
  /// 最近一次进入 AWAITING_APPROVAL 的时刻（block 兜底按它算停留时长）。
  awaitingSince?: string;
  /// 连续预算不足的 tick 数（审成一次即清零）。
  budgetShortTicks: number;
  reviewLeaseUntil?: string;
  warning?: string;
  note?: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function readFrameAiReview(value: unknown): StoryboardFrameAiReview {
  if (!isRecord(value)) return { regenCount: 0 };
  const verdict = isRecord(value.verdict) && typeof value.verdict.pass === "boolean"
    ? {
        pass: value.verdict.pass,
        score: Number(value.verdict.score) || 0,
        issues: typeof value.verdict.issues === "string" ? value.verdict.issues : "",
        mode: value.verdict.mode === "shadow" ? ("shadow" as const) : ("block" as const),
        reviewedAt: typeof value.verdict.reviewedAt === "string" ? value.verdict.reviewedAt : "",
      }
    : undefined;
  return {
    regenCount: nonNegativeInt(value.regenCount),
    ...(verdict ? { verdict } : {}),
    ...(value.exhausted === true ? { exhausted: true } : {}),
  };
}

export function frameAiRegenCount(aiReview: unknown): number {
  return readFrameAiReview(aiReview).regenCount;
}

/**
 * 供应商侧尝试次数：attempt 去掉审帧重抽。批量自动重投上限（BATCH_FRAME_MAX_ATTEMPTS）
 * 与单帧重做上限（FRAME_REGENERATION_LIMIT）都按它算——审帧用满后供应商再失败，仍有重投名额。
 */
export function storyboardProviderAttempts(frame: { attempt: number; aiReview?: unknown }): number {
  return Math.max(1, frame.attempt - frameAiRegenCount(frame.aiReview));
}

export function readAiReviewSummary(value: unknown): StoryboardAiReviewSummary | null {
  if (!isRecord(value)) return null;
  const mode = value.mode === "shadow" ? "shadow" : value.mode === "block" ? "block" : null;
  if (!mode) return null;
  const states: StoryboardAiReviewState[] = [
    "reviewing",
    "regenerating",
    "passed",
    "approved_with_warning",
    "skipped",
    "shadow_done",
  ];
  const state = states.includes(value.state as StoryboardAiReviewState)
    ? (value.state as StoryboardAiReviewState)
    : "reviewing";
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : undefined);
  return {
    mode,
    state,
    regenRound: nonNegativeInt(value.regenRound),
    budgetShortTicks: nonNegativeInt(value.budgetShortTicks),
    ...(text("awaitingSince") ? { awaitingSince: text("awaitingSince") } : {}),
    ...(text("reviewLeaseUntil") ? { reviewLeaseUntil: text("reviewLeaseUntil") } : {}),
    ...(text("warning") ? { warning: text("warning") } : {}),
    ...(text("note") ? { note: text("note") } : {}),
    updatedAt: text("updatedAt") ?? "",
  };
}

/** block 档：run 刚全部出图、进入 AWAITING_APPROVAL 时写的汇总（重抽回来再次进入也走这里）。 */
export function enterBlockReviewSummary(previous: unknown, now: Date): StoryboardAiReviewSummary {
  const prior = readAiReviewSummary(previous);
  return {
    mode: "block",
    state: "reviewing",
    regenRound: prior?.regenRound ?? 0,
    awaitingSince: now.toISOString(),
    budgetShortTicks: 0,
    updatedAt: now.toISOString(),
  };
}

/** 兜底批准的判定（纯函数）：停留时长优先，不依赖本 tick 有没有预算。 */
export function blockReviewFallbackReason(input: {
  summary: StoryboardAiReviewSummary | null;
  runUpdatedAt: Date;
  now: Date;
  /// 本 tick 预算也不足时传 true：连续不足的 tick 数按 +1 判。
  budgetShortThisTick?: boolean;
}): "timeout" | "budget" | null {
  const since = input.summary?.awaitingSince
    ? Date.parse(input.summary.awaitingSince)
    : input.runUpdatedAt.getTime();
  const sinceMs = Number.isFinite(since) ? since : input.runUpdatedAt.getTime();
  if (input.now.getTime() - sinceMs > STORYBOARD_AI_REVIEW_FALLBACK_MS) return "timeout";
  const shortTicks = (input.summary?.budgetShortTicks ?? 0) + (input.budgetShortThisTick ? 1 : 0);
  if (shortTicks >= STORYBOARD_AI_REVIEW_BUDGET_SHORT_TICKS) return "budget";
  return null;
}

export const STORYBOARD_AI_REVIEW_WARNINGS = {
  timeout: "AI 审帧超过 20 分钟未完成，已按原画面放行。",
  budget: "AI 审帧连续 3 轮排不上预算，已按原画面放行。",
  exhausted: "部分分镜重抽用满仍未通过 AI 审帧，已按最后一版放行。",
  reviewFailed: "AI 审帧调用失败，已按原画面放行。",
} as const;

/** 审帧 issues → 重抽这一帧的 promptOverride（一行、≤1000 字；USER DIRECTION 只保留最新一条）。 */
export function aiReviewRegenerationDirection(issues: string): string {
  const text = `AI frame review — fix this frame: ${issues.replace(/\s+/gu, " ").trim() || "match the product reference photos exactly"}`;
  return text.slice(0, STORYBOARD_FRAME_DIRECTION_MAX);
}

/** 批量监控页只要两件事：审帧中 / 重抽第 N 次；其余状态不露出。 */
export function storyboardAiReviewProgress(
  summary: unknown,
): { state: "reviewing" | "regenerating"; regenRound: number } | null {
  const parsed = readAiReviewSummary(summary);
  if (!parsed || parsed.mode !== "block") return null;
  if (parsed.state !== "reviewing" && parsed.state !== "regenerating") return null;
  return { state: parsed.state, regenRound: parsed.regenRound };
}
