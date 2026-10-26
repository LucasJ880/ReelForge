import type { Prisma } from "@prisma/client";

/**
 * 实验批次的运行键（X-SCAF-0）。
 *
 * 供应商 bake-off、1080P 排队、切片对照这类付费实验走生产批量管线、写生产库，
 * 批次的 `BatchJob.idempotencyKey` 一律以这个前缀开头。平台级读数（创始人汇总的失败视频、
 * 一次通过率、线路健康）据此把实验批次排除在外：实验不是商家的生成质量，也不是平台的故障。
 *
 * 只排除批次维度；没有批次的单条任务不受影响。
 */
export const EXPERIMENT_BATCH_KEY_PREFIX = "exp-2611-";

export function isExperimentBatchKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith(EXPERIMENT_BATCH_KEY_PREFIX);
}

/** BatchJob 维度：不是实验批次。 */
export function notExperimentBatchWhere(): Prisma.BatchJobWhereInput {
  return { idempotencyKey: { not: { startsWith: EXPERIMENT_BATCH_KEY_PREFIX } } };
}

/**
 * VideoJob 维度：排除实验批次里的任务；没有批次的单条任务（batchJobId 为空）照常计入。
 * 自带 OR，调用方放进 AND 里用，别和自己的 OR 撞键。
 */
export function notExperimentVideoJobWhere(): Prisma.VideoJobWhereInput {
  return { OR: [{ batchJobId: null }, { batchJob: { is: notExperimentBatchWhere() } }] };
}
