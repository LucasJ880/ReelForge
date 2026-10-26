/**
 * scripts/real-template-samples-expansion.ts 的纯函数部分（X-SCAF-1）：
 * 线路臂解析、幂等键、报告条目的身份与时间戳推进。不读 env、不连库、不触网。
 */
import { EXPERIMENT_BATCH_KEY_PREFIX } from "../../src/lib/experiments/run-key";

/**
 * 批次幂等键修订号：v1 用了裸 URL 假 asset id，被故事板锚定管线
 * （resolveOwnedMediaAssets）正确拒绝；v2 起参考图先注册为 MediaAsset；
 * v3 改分波提交——27 个批次一次性全建会让排队尾部越过 timeoutAt+10min
 * 宽限被 sweep 判死（v2 实测 19 条未提交即被扫）；
 * v4 起幂等键带线路后缀 `:${routeId}`（多线路/多套餐同一 slug 各占一个批次）。
 * 改键形状必须升版：否则续跑会按旧键找不到批次而重建，重复扣点。
 */
export const BATCH_KEY_REV = "v4";

export type SampleRouteKind = "buddy" | "volcengine_cn_legacy";

export interface SampleArm {
  /** 报告、幂等键、文件名里用的线路标识：`buddy`、`buddy@<planId>`、`volcengine_cn_legacy`。 */
  id: string;
  /** 批量管线的 videoRouteId。 */
  routeId: SampleRouteKind;
  /** Shuyu 显式套餐；null = 默认套餐（draft 档最便宜的 720P）。 */
  planId: string | null;
}

export class SampleArmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleArmError";
  }
}

const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

/**
 * 解析 `REAL_SAMPLES_ROUTE`：逗号分隔的线路臂，空 = `buddy`。
 *
 * - `buddy`：Shuyu 默认套餐。
 * - `buddy@<planId>`：Shuyu 显式套餐（1080P 档要 `SHUYU_ALLOW_FINAL_TIER=1`，由实时审计把关）。
 * - `volcengine_cn_legacy`：C1 故障转移的历史线路；它靠进程级 env 切 provider，
 *   所以只能单独跑，不能和 buddy 臂混在一轮里。
 * - `byteplus_international` 及其它：本轮不开新视频通道（路线图 D-2 / D-8），直接拒绝。
 */
export function parseSampleArms(raw: string | undefined | null): SampleArm[] {
  const tokens = (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [{ id: "buddy", routeId: "buddy", planId: null }];

  const arms: SampleArm[] = [];
  for (const token of tokens) {
    let arm: SampleArm;
    if (token === "buddy") {
      arm = { id: "buddy", routeId: "buddy", planId: null };
    } else if (token.startsWith("buddy@")) {
      const planId = token.slice("buddy@".length);
      if (!PLAN_ID_PATTERN.test(planId)) {
        throw new SampleArmError(`套餐 ID 不合法：${token}`);
      }
      arm = { id: token, routeId: "buddy", planId };
    } else if (token === "volcengine_cn_legacy") {
      arm = { id: token, routeId: "volcengine_cn_legacy", planId: null };
    } else {
      throw new SampleArmError(
        `不支持的线路「${token}」：本轮 Shuyu 是唯一视频通道（D-2），只接受 buddy、buddy@<planId>、volcengine_cn_legacy`,
      );
    }
    if (arms.some((existing) => existing.id === arm.id)) {
      throw new SampleArmError(`线路臂重复：${arm.id}`);
    }
    arms.push(arm);
  }
  if (arms.some((arm) => arm.routeId === "volcengine_cn_legacy") && arms.length > 1) {
    throw new SampleArmError("volcengine_cn_legacy 靠进程级 env 切 provider，只能单独跑，不能和其它臂混在一轮");
  }
  return arms;
}

/**
 * 多臂或显式套餐 = 对照实验：按 X-SCAF-0 必须用 `exp-2611-` 运行键（平台读数据此排除），
 * 且并发 ≤ 2。单臂默认套餐是模板库样片本身，不受此约束。
 */
export function isExperimentRun(arms: ReadonlyArray<SampleArm>): boolean {
  return arms.length > 1 || arms.some((arm) => arm.planId !== null);
}

export const EXPERIMENT_MAX_WAVE_SIZE = 2;

export function assertRunKeyForArms(runKey: string, arms: ReadonlyArray<SampleArm>): void {
  if (isExperimentRun(arms) && !runKey.startsWith(EXPERIMENT_BATCH_KEY_PREFIX)) {
    throw new SampleArmError(
      `多线路/显式套餐属于对照实验，REAL_SAMPLES_RUN_KEY 必须以 ${EXPERIMENT_BATCH_KEY_PREFIX} 开头（当前：${runKey}）`,
    );
  }
}

export function effectiveWaveSize(requested: number, arms: ReadonlyArray<SampleArm>): number {
  const base = Math.max(1, Math.floor(requested) || 1);
  return isExperimentRun(arms) ? Math.min(base, EXPERIMENT_MAX_WAVE_SIZE) : base;
}

export function sampleIdempotencyKey(args: {
  runKey: string;
  slug: string;
  armId: string;
  /** REAL_SAMPLES_FORCE 重跑时并入模板版本与可选重试号。 */
  force?: { templateVersion: number; retryRev?: string | null } | null;
}): string {
  const base = `${args.runKey}:${args.slug}:${BATCH_KEY_REV}:${args.armId}`;
  if (!args.force) return base;
  const retry = args.force.retryRev ? `:r${args.force.retryRev}` : "";
  return `${base}:t${args.force.templateVersion}${retry}`;
}

export function isCurrentRevKey(idempotencyKey: string): boolean {
  return idempotencyKey.includes(`:${BATCH_KEY_REV}:`);
}

/**
 * v4 之前的条目没有 armId：v3 键里 `:vol` 后缀 = volcengine，其余 = buddy 默认套餐。
 * 已 SUCCEEDED 的旧条目据此并入新报告的 (slug, arm) 身份，不会被当成待跑重复扣点。
 */
export function inferLegacyArmId(item: { armId?: string; idempotencyKey: string }): string {
  if (item.armId) return item.armId;
  return /:vol(?::|$)/.test(item.idempotencyKey) ? "volcengine_cn_legacy" : "buddy";
}

export function itemIdentity(slug: string, armId: string): string {
  return `${slug}::${armId}`;
}

/** 默认臂保持历史文件名 `<slug>.mp4`；其它臂加后缀，文件名里的 `@ : /` 换成 `_`。 */
export function sampleVideoFileName(slug: string, armId: string): string {
  if (armId === "buddy") return `${slug}.mp4`;
  return `${slug}--${armId.replace(/[^A-Za-z0-9._-]/g, "_")}.mp4`;
}

export type QaScore = 0 | 1 | 2;

/** 人工 QA 三项 0–2（与 scripts/ops/qa-first-pass.ts 的 product/person/lip 同口径），未评 = null。 */
export interface SampleQa {
  product: QaScore | null;
  person: QaScore | null;
  lipSync: QaScore | null;
}

export function emptyQa(): SampleQa {
  return { product: null, person: null, lipSync: null };
}

export interface TimingSnapshot {
  submittedAt?: string | null;
  firstProcessingAt?: string | null;
  finishedAt?: string | null;
}

/**
 * 推进一条的时间戳。submittedAt / finishedAt 以库里 VideoJob 为准（有就覆盖）；
 * firstProcessingAt 库里没有对应列，按轮询观察：第一次看到供应商处理中状态
 * （Shuyu `processing`、Seedance `running`）时记下当前时刻，之后不再改；
 * 一次都没观察到（排队到完成在一个轮询间隔内走完）就保持 null，不拿终态时刻冒充。
 * 精度 = 轮询间隔，报告里如实标注。
 */
export function advanceTiming(
  prev: TimingSnapshot,
  observed: {
    now: Date;
    submittedAt: Date | null;
    finishedAt: Date | null;
    providerStatus: string | null | undefined;
  },
): TimingSnapshot {
  const next: TimingSnapshot = { ...prev };
  if (observed.submittedAt) next.submittedAt = observed.submittedAt.toISOString();
  if (observed.finishedAt) next.finishedAt = observed.finishedAt.toISOString();
  if (!next.firstProcessingAt) {
    const status = observed.providerStatus?.toLowerCase() ?? "";
    if (status === "processing" || status === "running") {
      next.firstProcessingAt = observed.now.toISOString();
    }
  }
  return next;
}
