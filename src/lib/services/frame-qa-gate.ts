import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "@/lib/db";
import {
  FRAME_QA_ERROR_PREFIX,
  FRAME_QA_GATE_TIMEOUT_MS,
  isFrameQaEnabled,
  runFrameTextQa,
  type FrameQaVerdict,
} from "@/lib/video-generation/frame-qa";

/**
 * 发片前帧质检门禁的唯一入口。reconcileVideoJob 只按这里给的决定执行状态迁移，
 * 不再自己判断质检结果——门禁的策略（谁能跑、跑什么、拦不拦、结果怎么落库）都在这里。
 *
 * - pass：可以转 SUCCEEDED；successData 并入 SUCCEEDED 的写入（质检结果列）
 * - block：转 FAILED；failureData 是 FAILED 写入的错误字段 + 质检结果列
 * - defer：本次调用的上下文不跑质检、也不转终态，留给有质检预算的调用方
 *
 * D2（2026-10-25）：
 * - 结果落库：frameQaStatus = PASSED / BLOCKED / WOULD_BLOCK / SKIPPED，
 *   frameQaCheckedAt、frameQaDetail（结论、问题帧、影子检查、累计拦截次数）。
 *   MOCK 引擎不写（null = 未质检）。
 * - 质检只在「帧质检预算」上下文里跑：cron poll-videos / process-batches 用
 *   runWithFrameQaBudget 包住整次调用（条数 + 时长上限）。用户面轮询遇到
 *   「供应商已完成」时 defer，由 cron 收尾（最多晚 1 分钟）。
 * - 同一段被拦截后平台最多免费重抽 2 次；第 3 次仍检出就按 WOULD_BLOCK 放行
 *   并告警，不再无限付费重抽。计数存在 frameQaDetail.blockCount（重试复用同一行）。
 * - 黑边 / 近静止是影子检查：只写 frameQaDetail.shadow，永不拦截。
 */
export type FrameQaGateDecision =
  | { action: "pass"; successData: Prisma.VideoJobUpdateManyMutationInput }
  | {
      action: "block";
      summary: string;
      failureData: Prisma.VideoJobUpdateManyMutationInput;
    }
  | { action: "defer"; reason: string };

export const FRAME_QA_STATUS = {
  PASSED: "PASSED",
  BLOCKED: "BLOCKED",
  WOULD_BLOCK: "WOULD_BLOCK",
  SKIPPED: "SKIPPED",
} as const;
export type FrameQaStatus = (typeof FRAME_QA_STATUS)[keyof typeof FRAME_QA_STATUS];

/** 同一段被帧质检拦截后，平台最多免费重抽的次数；用满后再检出 → WOULD_BLOCK 放行 */
export const FRAME_QA_FREE_RETRY_CAP = 2;

/**
 * 质检进行中的占位（frameQaStatus 的一个过程值，不是结论）：真跑质检前 CAS 写入，
 * frameQaCheckedAt = 占位时刻；结论写回时被 PASSED / BLOCKED / WOULD_BLOCK / SKIPPED 覆盖。
 *
 * 为什么要占位：cron 每分钟一次、maxDuration 300s，Vercel 不串行化重叠的调用，
 * 每次调用各有一份质检预算。上一次调用还在给某段跑质检（单次最坏 45s）时，下一次
 * 调用按 lastCheckedAt 升序又会先拿到同一段，重复下载、抽帧、调 vision，两份结论
 * 先后落库。占位之后，并发的调用看到占位未过期就 defer。
 */
export const FRAME_QA_CHECKING = "CHECKING";
/// 占位租期：持有者被平台杀掉时，过了租期别的调用可以接手。远大于单次检查的最坏耗时。
const FRAME_QA_CLAIM_LEASE_MS = 2 * (FRAME_QA_GATE_TIMEOUT_MS + 10_000);

export const FRAME_QA_BLOCK_USER_ERROR =
  "画面质检未通过（检测到异常文字），已自动拦截。点击「重试」可重新生成本段。";

// ---------- 质检预算上下文 ----------

export interface FrameQaBudgetOptions {
  /** 记进 frameQaDetail.budget，便于在库里区分是哪条 cron 跑的 */
  label: string;
  /** 本次调用最多真跑几次质检 */
  maxChecks: number;
  /** 从进入上下文起，质检必须在这个窗口内跑完（毫秒） */
  timeBudgetMs: number;
}

interface FrameQaBudgetState extends FrameQaBudgetOptions {
  deadline: number;
  used: number;
  deferred: number;
  /// 本轮段级门禁里 vision / 下载 / 抽帧出错或超时的次数（成片级复检据此让路，#16 item 7）
  visionFailures: number;
}

/**
 * cron 默认预算：poll-videos / process-batches 都设 maxDuration=300。
 * 4 次 × 单次最坏 45s 门禁超时 ≈ 3 分钟，留出轮询 / 清扫的余量。
 */
export const CRON_FRAME_QA_BUDGET = {
  maxChecks: 4,
  timeBudgetMs: 180_000,
} as const;

/// 单次检查的最坏耗时（门禁超时 + 余量）：剩余窗口不够就 defer，
/// 不把函数拖过 maxDuration（被平台杀掉会连带丢掉本轮其它状态迁移）。
const PER_CHECK_RESERVE_MS = FRAME_QA_GATE_TIMEOUT_MS + 10_000;

const budgetStore = new AsyncLocalStorage<FrameQaBudgetState>();

export function runWithFrameQaBudget<T>(
  options: FrameQaBudgetOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return budgetStore.run(
    {
      ...options,
      deadline: Date.now() + options.timeBudgetMs,
      used: 0,
      deferred: 0,
      visionFailures: 0,
    },
    fn,
  );
}

/** 当前上下文的预算用量（cron 响应体里回显，便于观察） */
export function frameQaBudgetUsage():
  | { label: string; used: number; maxChecks: number; deferred: number; visionFailures: number }
  | null {
  const budget = budgetStore.getStore();
  if (!budget) return null;
  return {
    label: budget.label,
    used: budget.used,
    maxChecks: budget.maxChecks,
    deferred: budget.deferred,
    visionFailures: budget.visionFailures,
  };
}

/** 段级门禁这一次没跑成（vision 出错 / 下载抽帧异常 / 超时）：记一笔，供成片级复检判断本轮要不要让路。 */
export function noteFrameQaVisionFailure(): void {
  const budget = budgetStore.getStore();
  if (budget) budget.visionFailures += 1;
}

const GATE_FAILURE_REASON = /执行异常|超时/;

/**
 * 预算上下文之外的策略。生产默认 defer（D2：用户面请求不跑质检）；
 * 非生产（本机 dev、脚本、测试）默认 inline，否则本机没有 cron 时任务会永远停在
 * 「供应商已完成」。FRAME_QA_OUTSIDE_BUDGET=defer|inline 可显式覆盖。
 */
function outsideBudgetPolicy(): "defer" | "inline" {
  const explicit = process.env.FRAME_QA_OUTSIDE_BUDGET?.trim().toLowerCase();
  if (explicit === "defer" || explicit === "inline") return explicit;
  return process.env.NODE_ENV === "production" ? "defer" : "inline";
}

type BudgetReservation =
  | { ok: true; label: string }
  | { ok: false; reason: string };

function reserveFrameQaCheck(now: number): BudgetReservation {
  const budget = budgetStore.getStore();
  if (!budget) {
    return outsideBudgetPolicy() === "inline"
      ? { ok: true, label: "inline" }
      : { ok: false, reason: "frame_qa_outside_cron_budget" };
  }
  if (budget.used >= budget.maxChecks) {
    budget.deferred += 1;
    return { ok: false, reason: "frame_qa_budget_checks_exhausted" };
  }
  if (budget.deadline - now < PER_CHECK_RESERVE_MS) {
    budget.deferred += 1;
    return { ok: false, reason: "frame_qa_budget_time_exhausted" };
  }
  /// 同步占位（在任何 await 之前），并发的同上下文调用不会超发
  budget.used += 1;
  return { ok: true, label: budget.label };
}

/** 预算占了位、但这一段没真跑（别的调用正在质检它）：把名额还回去给别的段用 */
function releaseFrameQaCheck(): void {
  const budget = budgetStore.getStore();
  if (budget && budget.used > 0) {
    budget.used -= 1;
    budget.deferred += 1;
  }
}

/**
 * 给成片级复检（P01-E，final-frame-qa-service）共用同一份 cron 预算：段级门禁先用，复检吃剩下的。
 * 只是把上面两个内部函数暴露出去，不改任何决策。
 */
export function reserveFrameQaBudgetSlot(now = Date.now()): BudgetReservation {
  return reserveFrameQaCheck(now);
}

export function releaseFrameQaBudgetSlot(): void {
  releaseFrameQaCheck();
}

/**
 * 质检这一段的那次尝试：供应商任务号 + 提交幂等键。重试会换掉其中之一
 *（单条重试先换 providerRequestKey，批量重试先清空 externalJobId），
 * 占位与终态写入都钉住它，旧尝试的质检不会写到新一轮上。
 */
export interface FrameQaAttemptPin {
  externalJobId: string | null;
  providerRequestKey: string | null;
}

/** 质检占位：仍在跑、仍是同一次尝试、且没有未过期的别人的占位，才占下 */
export function frameQaClaimWhere(
  jobId: string,
  pin: FrameQaAttemptPin,
  now: Date,
): Prisma.VideoJobWhereInput {
  return {
    id: jobId,
    status: { in: [VideoJobStatus.RUNNING, VideoJobStatus.QUEUED] },
    externalJobId: pin.externalJobId,
    providerRequestKey: pin.providerRequestKey,
    OR: [
      { frameQaStatus: null },
      { frameQaStatus: { not: FRAME_QA_CHECKING } },
      { frameQaCheckedAt: null },
      { frameQaCheckedAt: { lt: new Date(now.getTime() - FRAME_QA_CLAIM_LEASE_MS) } },
    ],
  };
}

async function claimFrameQaCheckInDb(
  jobId: string,
  pin: FrameQaAttemptPin,
  now: Date,
): Promise<boolean> {
  const claimed = await db.videoJob.updateMany({
    where: frameQaClaimWhere(jobId, pin, now),
    data: { frameQaStatus: FRAME_QA_CHECKING, frameQaCheckedAt: now },
  });
  return claimed.count === 1;
}

// ---------- 落库结构 ----------

export interface FrameQaDetail {
  v: 1;
  status: FrameQaStatus;
  checked: boolean;
  summary: string;
  skipReason?: string;
  frameCount: number;
  issues: FrameQaVerdict["issues"];
  /** 本段累计被帧质检拦截的次数（跨重试累计） */
  blockCount: number;
  freeRetryCap: number;
  warning?: string;
  shadow?: FrameQaVerdict["shadow"] | null;
  budget?: string;
  checkedAt: string;
}

/** 读取历史 frameQaDetail 里的累计拦截次数（坏数据按 0） */
export function readFrameQaBlockCount(detail: unknown): number {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return 0;
  const raw = (detail as { blockCount?: unknown }).blockCount;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0;
}

function columns(
  status: FrameQaStatus,
  detail: FrameQaDetail,
  checkedAt: Date,
): Prisma.VideoJobUpdateManyMutationInput {
  return {
    frameQaStatus: status,
    frameQaCheckedAt: checkedAt,
    frameQaDetail: detail as unknown as Prisma.InputJsonValue,
  };
}

function skippedDecision(args: {
  reason: string;
  priorBlockCount: number;
  checkedAt: Date;
  verdict?: FrameQaVerdict;
  budget?: string;
}): FrameQaGateDecision {
  const detail: FrameQaDetail = {
    v: 1,
    status: FRAME_QA_STATUS.SKIPPED,
    checked: false,
    summary: args.verdict?.summary ?? `帧质检跳过：${args.reason}`,
    skipReason: args.reason,
    frameCount: args.verdict?.frameCount ?? 0,
    issues: [],
    blockCount: args.priorBlockCount,
    freeRetryCap: FRAME_QA_FREE_RETRY_CAP,
    ...(args.verdict?.shadow ? { shadow: args.verdict.shadow } : {}),
    ...(args.budget ? { budget: args.budget } : {}),
    checkedAt: args.checkedAt.toISOString(),
  };
  return {
    action: "pass",
    successData: columns(FRAME_QA_STATUS.SKIPPED, detail, args.checkedAt),
  };
}

/**
 * 纯决策：质检结论 + 本段历史拦截次数 → 门禁决定（含要落库的列）。
 * 单独导出便于测试拦截上限与 WOULD_BLOCK 放行。
 */
export function decideFromVerdict(args: {
  verdict: FrameQaVerdict;
  priorBlockCount: number;
  checkedAt: Date;
  budget?: string;
}): FrameQaGateDecision {
  const { verdict, priorBlockCount, checkedAt } = args;
  if (!verdict.checked) {
    return skippedDecision({
      reason: verdict.skipReason ?? "门禁未执行",
      priorBlockCount,
      checkedAt,
      verdict,
      budget: args.budget,
    });
  }
  const base = {
    v: 1 as const,
    checked: true,
    summary: verdict.summary,
    frameCount: verdict.frameCount,
    issues: verdict.issues,
    freeRetryCap: FRAME_QA_FREE_RETRY_CAP,
    ...(verdict.shadow ? { shadow: verdict.shadow } : {}),
    ...(args.budget ? { budget: args.budget } : {}),
    checkedAt: checkedAt.toISOString(),
  };
  if (verdict.ok) {
    const detail: FrameQaDetail = {
      ...base,
      status: FRAME_QA_STATUS.PASSED,
      blockCount: priorBlockCount,
    };
    return {
      action: "pass",
      successData: columns(FRAME_QA_STATUS.PASSED, detail, checkedAt),
    };
  }
  if (priorBlockCount >= FRAME_QA_FREE_RETRY_CAP) {
    /// 免费重抽已用满：放行，但把「本该拦截」原样记下来供人工复核
    const detail: FrameQaDetail = {
      ...base,
      status: FRAME_QA_STATUS.WOULD_BLOCK,
      blockCount: priorBlockCount,
      warning: `同一段已因画面文字拦截 ${priorBlockCount} 次（免费重抽上限 ${FRAME_QA_FREE_RETRY_CAP} 次），本次仍检出，按上限放行，需人工复核`,
    };
    return {
      action: "pass",
      successData: columns(FRAME_QA_STATUS.WOULD_BLOCK, detail, checkedAt),
    };
  }
  const detail: FrameQaDetail = {
    ...base,
    status: FRAME_QA_STATUS.BLOCKED,
    blockCount: priorBlockCount + 1,
  };
  return {
    action: "block",
    summary: verdict.summary,
    failureData: {
      errorMessage: `${FRAME_QA_ERROR_PREFIX} ${verdict.summary}`,
      userSafeError: FRAME_QA_BLOCK_USER_ERROR,
      ...columns(FRAME_QA_STATUS.BLOCKED, detail, checkedAt),
    },
  };
}

export interface FrameQaGateDeps {
  isFrameQaEnabled: () => boolean;
  runFrameTextQa: (videoUrl: string) => Promise<FrameQaVerdict>;
  loadPriorDetail: (jobId: string) => Promise<unknown>;
  now: () => Date;
  /** 质检占位（默认 CAS 写 frameQaStatus=CHECKING）；只在调用方传了 attempt 时调用 */
  claimCheck?: (jobId: string, pin: FrameQaAttemptPin, now: Date) => Promise<boolean>;
}

const defaultDeps: FrameQaGateDeps = {
  isFrameQaEnabled,
  runFrameTextQa: async (videoUrl) => {
    const verdict = await runFrameTextQa(videoUrl);
    if (!verdict.checked && GATE_FAILURE_REASON.test(verdict.skipReason ?? "")) {
      noteFrameQaVisionFailure();
    }
    return verdict;
  },
  loadPriorDetail: async (jobId) =>
    (
      await db.videoJob.findUnique({
        where: { id: jobId },
        select: { frameQaDetail: true },
      })
    )?.frameQaDetail ?? null,
  now: () => new Date(),
  claimCheck: claimFrameQaCheckInDb,
};

export async function decideFrameQaGate(
  params: {
    jobId: string;
    provider: VideoProvider;
    videoUrl: string | null | undefined;
    /**
     * 调用方手上已有的 frameQaDetail（reconcile 读出的整行）。传了就不再查库；
     * 不传则只在真跑质检时查一次（取历史拦截次数）。
     */
    priorFrameQaDetail?: unknown;
    /**
     * 这一段当前那次尝试（reconcile 读出的行）。传了就在真跑质检前占位：
     * 占不到（别的调用正在质检它，或这次尝试已被重试换掉）就 defer，不重复跑。
     */
    attempt?: FrameQaAttemptPin;
  },
  deps: FrameQaGateDeps = defaultDeps,
): Promise<FrameQaGateDecision> {
  /// MOCK 引擎：不质检、不落库（null = 未质检）
  if (params.provider === VideoProvider.MOCK) {
    return { action: "pass", successData: {} };
  }
  const knownPrior =
    params.priorFrameQaDetail === undefined
      ? null
      : readFrameQaBlockCount(params.priorFrameQaDetail);

  if (!params.videoUrl) {
    console.warn(`[frame-qa] job ${params.jobId} 门禁跳过: 供应商未返回视频地址`);
    return skippedDecision({
      reason: "供应商未返回视频地址",
      priorBlockCount: knownPrior ?? 0,
      checkedAt: deps.now(),
    });
  }
  if (!deps.isFrameQaEnabled()) {
    return skippedDecision({
      reason: "门禁未启用（FRAME_QA_DISABLED / mock 模式 / 未配置 vision key）",
      priorBlockCount: knownPrior ?? 0,
      checkedAt: deps.now(),
    });
  }

  /// 预算按真实时钟计（deadline 在进入上下文时用 Date.now() 定下）
  const reservation = reserveFrameQaCheck(Date.now());
  if (!reservation.ok) {
    return { action: "defer", reason: reservation.reason };
  }
  if (params.attempt) {
    const claim = deps.claimCheck ?? claimFrameQaCheckInDb;
    const claimed = await claim(params.jobId, params.attempt, deps.now());
    if (!claimed) {
      releaseFrameQaCheck();
      return { action: "defer", reason: "frame_qa_claimed_elsewhere" };
    }
  }

  const priorBlockCount =
    knownPrior ?? readFrameQaBlockCount(await deps.loadPriorDetail(params.jobId));
  const verdict = await deps.runFrameTextQa(params.videoUrl);
  if (!verdict.checked) {
    console.warn(`[frame-qa] job ${params.jobId} 门禁跳过: ${verdict.skipReason}`);
  }
  const decision = decideFromVerdict({
    verdict,
    priorBlockCount,
    checkedAt: deps.now(),
    budget: reservation.label,
  });
  if (
    decision.action === "pass" &&
    decision.successData.frameQaStatus === FRAME_QA_STATUS.WOULD_BLOCK
  ) {
    console.warn(
      `[frame-qa] job ${params.jobId} WOULD_BLOCK（免费重抽已用满，按上限放行）: ${verdict.summary}`,
    );
  }
  return decision;
}

export const __test__ = {
  reserveFrameQaCheck,
  outsideBudgetPolicy,
  PER_CHECK_RESERVE_MS,
  FRAME_QA_CLAIM_LEASE_MS,
};
