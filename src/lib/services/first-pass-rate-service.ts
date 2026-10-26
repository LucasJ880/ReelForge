import { db } from "@/lib/db";
import { notExperimentVideoJobWhere } from "@/lib/experiments/run-key";

/**
 * C3 · 一次通过率（PRD §6 / M7）。
 *
 * 「首次生成即被接受」是质量北极星（目标 ≥ 60%）。
 * 尺子不另造（PRD 原话）：
 * - 视频：SUCCEEDED 且没有重试（retryCount=0、submitAttempts<=1）；样本 = 成片 + 失败，取消不计
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
    /// 只统计跑出结果的：还在跑的没有「通过与否」可言；取消也不算——取消是商家自己的决定，
    /// 不是生成质量（与读数注册表「取消不算失败」同口径，之前取消排队批次会把通过率拉低）。
    status: { in: ["SUCCEEDED", "FAILED"] as ("SUCCEEDED" | "FAILED")[] },
    /// P01-F0：成片后「点名重做」产生的候选行（replacesJobId 非空）不是首次生成，不进样本；
    /// 被替换的旧行留在样本里，但按「未通过」计（见下）——商家重做它，说明首次没被接受。
    replacesJobId: null,
    /// X-SCAF-0：实验批次（exp-2611-*）不是商家的生成质量，不进北极星样本；单条任务不受影响。
    AND: [notExperimentVideoJobWhere()],
  };
  const [sample, passed] = await Promise.all([
    db.videoJob.count({ where }),
    db.videoJob.count({
      where: {
        ...where,
        status: "SUCCEEDED",
        retryCount: 0,
        submitAttempts: { lte: 1 },
        /// 被重做替换掉的旧段不算通过
        supersededAt: null,
        /// 帧质检用满免费重抽后按上限放行的（WOULD_BLOCK）也不算通过；
        /// 列可空（未质检 / MOCK），Prisma 的 not 会把 NULL 一起排掉，所以要显式放行 null。
        AND: [
          notExperimentVideoJobWhere(),
          { OR: [{ frameQaStatus: null }, { frameQaStatus: { not: "WOULD_BLOCK" } }] },
        ],
      },
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
