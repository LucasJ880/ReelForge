import { AsyncLocalStorage } from "node:async_hooks";

/**
 * cron 一次调用的 vision 预算上下文（帧质检 + 故事板审帧共用）。只有 AsyncLocalStorage 与纯计数，
 * 不引 ffmpeg / db：storyboard-service 也要预约审帧预算，不能为此把帧质检的媒体依赖带进故事板路由。
 * 帧质检的预约逻辑仍在 frame-qa-gate；这里只放状态与审帧预约。
 */
export interface FrameQaBudgetOptions {
  /** 记进 frameQaDetail.budget，便于在库里区分是哪条 cron 跑的 */
  label: string;
  /** 本次调用最多真跑几次质检 */
  maxChecks: number;
  /** 从进入上下文起，质检必须在这个窗口内跑完（毫秒） */
  timeBudgetMs: number;
  /** 帧质检 + 故事板审帧（P01-D）共用的总窗口；省略 = 与 timeBudgetMs 相同 */
  totalBudgetMs?: number;
  /** 故事板审帧本轮最多占用的时长；省略 = 0（这个上下文不跑审帧） */
  storyboardReviewBudgetMs?: number;
}

export interface FrameQaBudgetState extends FrameQaBudgetOptions {
  deadline: number;
  totalDeadline: number;
  used: number;
  deferred: number;
  /// 本轮段级门禁里 vision / 下载 / 抽帧出错或超时的次数（成片级复检据此让路，#16 item 7）
  visionFailures: number;
  /// 故事板审帧已占用（预约中 + 已花掉）的毫秒数
  reviewSpentMs: number;
}

export const budgetStore = new AsyncLocalStorage<FrameQaBudgetState>();

export function runWithFrameQaBudget<T>(
  options: FrameQaBudgetOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  return budgetStore.run(
    {
      ...options,
      deadline: startedAt + options.timeBudgetMs,
      totalDeadline: startedAt + (options.totalBudgetMs ?? options.timeBudgetMs),
      used: 0,
      deferred: 0,
      visionFailures: 0,
      reviewSpentMs: 0,
    },
    fn,
  );
}

/// 不在 cron 预算上下文里（用户面轮询）：不是「预算不足的一个 tick」，调用方不该为它计数。
export const STORYBOARD_REVIEW_OUTSIDE_BUDGET = "storyboard_review_outside_cron_budget";

export type StoryboardReviewReservation =
  | { ok: true; settle: (elapsedMs: number) => void }
  | { ok: false; reason: string };

/**
 * 故事板审帧（P01-D）向本轮预算预约 reserveMs：审帧自己的上限与「帧质检 + 审帧」总窗口都要放得下。
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

