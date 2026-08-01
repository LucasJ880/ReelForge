import { db } from "@/lib/db";

/**
 * C3 · 一次通过率（PRD §6 / M7）。
 *
 * 「首次生成即被接受」是质量北极星（目标 ≥ 60%）。
 * 尺子不另造（PRD 原话）：
 * - 视频：SUCCEEDED 且没有重试（retryCount=0、submitAttempts<=1）
 * - 图文帖：出图一次成功（renderedAt 有值且 renderError 为空）
 * - Gate（B5）上线后，视频侧的判据自动收紧为「过 Gate 且无重试」
 *
 * 按 generatedBy 分开统计：启发式兜底的计划质量不同，
 * 混在一起会把 LLM 的真实通过率稀释掉。
 */

export type FirstPassRate = {
  /// 样本量。低于 MIN_SAMPLE 时 rate 为 null —— 三条样本算不出北极星。
  sample: number;
  passed: number;
  rate: number | null;
};

export const MIN_SAMPLE = 10;

function toRate(passed: number, sample: number): FirstPassRate {
  return {
    sample,
    passed,
    rate: sample >= MIN_SAMPLE ? passed / sample : null,
  };
}

export async function videoFirstPassRate(args: {
  userId?: string | null;
  since?: Date;
}): Promise<FirstPassRate> {
  const where = {
    ...(args.userId ? { batchJob: { is: { userId: args.userId } } } : {}),
    ...(args.since ? { createdAt: { gte: args.since } } : {}),
    /// 只统计已终态的：还在跑的没有「通过与否」可言。
    status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] as ("SUCCEEDED" | "FAILED" | "CANCELLED")[] },
  };
  const [sample, passed] = await Promise.all([
    db.videoJob.count({ where }),
    db.videoJob.count({
      where: { ...where, status: "SUCCEEDED", retryCount: 0, submitAttempts: { lte: 1 } },
    }),
  ]);
  return toRate(passed, sample);
}

export async function postFirstPassRate(args: {
  userId?: string | null;
  since?: Date;
}): Promise<FirstPassRate> {
  const where = {
    ...(args.userId ? { plan: { userId: args.userId } } : {}),
    ...(args.since ? { createdAt: { gte: args.since } } : {}),
    /// 只统计需要出图的形态：纯文案帖没有「生成失败」的概念。
    format: { in: ["SINGLE_IMAGE", "CAROUSEL"] as ("SINGLE_IMAGE" | "CAROUSEL")[] },
    /// 弃用的不算：商家不要这条 ≠ 生成质量差。
    status: { not: "DISCARDED" as const },
    /// 已尝试过出图的才有通过与否。
    OR: [{ renderedAt: { not: null } }, { renderError: { not: null } }],
  };
  const [sample, passed] = await Promise.all([
    db.contentPost.count({ where }),
    db.contentPost.count({
      where: { ...where, renderedAt: { not: null }, renderError: null },
    }),
  ]);
  return toRate(passed, sample);
}
