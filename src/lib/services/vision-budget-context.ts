import { AsyncLocalStorage } from "node:async_hooks";

/**
 * cron 一次调用的看图预算上下文：故事板 AI 审帧（P01-D，STORYBOARD_AI_REVIEW）在这里预约时长。
 * 只有 AsyncLocalStorage 与纯计数，不引 ffmpeg / db。
 *
 * 2026-11-16 之前成片画面质检也用这份预算（条数 + 时长上限），随质检整套删除；
 * 留下的两个数（总窗口 200 秒、审帧最多 60 秒）与当时一致，审帧的行为没变。
 */
export interface VisionBudgetOptions {
  /** 哪条 cron 开的上下文（只用于排查） */
  label: string;
  /** 从进入上下文起，看图调用必须在这个窗口内跑完（毫秒） */
  totalBudgetMs: number;
  /** 故事板审帧本轮最多占用的时长；省略 = 0（这个上下文不跑审帧） */
  storyboardReviewBudgetMs?: number;
}

interface VisionBudgetState extends VisionBudgetOptions {
  totalDeadline: number;
  /// 故事板审帧已占用（预约中 + 已花掉）的毫秒数
  reviewSpentMs: number;
}

const budgetStore = new AsyncLocalStorage<VisionBudgetState>();

/**
 * cron 默认预算：poll-videos / process-batches 都设 maxDuration=300。
 * 总窗口 200 秒，给轮询 / 清扫留余量；审帧自己最多 60 秒。
 */
export const CRON_VISION_BUDGET = {
  totalBudgetMs: 200_000,
  storyboardReviewBudgetMs: 60_000,
} as const;

export function runWithVisionBudget<T>(
  options: VisionBudgetOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return budgetStore.run(
    {
      ...options,
      totalDeadline: Date.now() + options.totalBudgetMs,
      reviewSpentMs: 0,
    },
    fn,
  );
}

/** 当前是否在 cron 的看图预算上下文里（返回它的 label；不在 = null）。 */
export function visionBudgetLabel(): string | null {
  return budgetStore.getStore()?.label ?? null;
}

/// 不在 cron 预算上下文里（用户面轮询）：不是「预算不足的一个 tick」，调用方不该为它计数。
export const STORYBOARD_REVIEW_OUTSIDE_BUDGET = "storyboard_review_outside_cron_budget";

export type StoryboardReviewReservation =
  | { ok: true; settle: (elapsedMs: number) => void }
  | { ok: false; reason: string };

/**
 * 故事板审帧（P01-D）向本轮预算预约 reserveMs：审帧自己的上限与总窗口都要放得下。
 * 预算上下文之外（用户面轮询、脚本）一律不给——审帧只在 cron 里跑。
 * 同步占位（任何 await 之前），settle 按实际耗时把多占的还回去。
 */
export function reserveStoryboardReviewBudget(
  reserveMs: number,
  now = Date.now(),
): StoryboardReviewReservation {
  const budget = budgetStore.getStore();
  if (!budget) return { ok: false, reason: STORYBOARD_REVIEW_OUTSIDE_BUDGET };
  const cap = budget.storyboardReviewBudgetMs ?? 0;
  if (budget.reviewSpentMs + reserveMs > cap) {
    return { ok: false, reason: "storyboard_review_budget_exhausted" };
  }
  if (budget.totalDeadline - now < reserveMs) {
    return { ok: false, reason: "storyboard_review_total_budget_exhausted" };
  }
  budget.reviewSpentMs += reserveMs;
  let settled = false;
  return {
    ok: true,
    settle: (elapsedMs: number) => {
      if (settled) return;
      settled = true;
      budget.reviewSpentMs -= Math.max(0, reserveMs - Math.max(0, elapsedMs));
    },
  };
}

