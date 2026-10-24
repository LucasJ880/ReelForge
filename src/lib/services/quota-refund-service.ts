import {
  ProviderSubmissionState,
  VideoBriefStatus,
  VideoDispatchRequestState,
  VideoJobStatus,
  type Prisma,
  type UsageResource,
} from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import {
  chargeMetersInTransaction,
  currentUsagePeriodKey,
  isQuotaEnforced,
  isQuotaExemptSession,
  resolveQuotaPlan,
  runSerializableQuotaTransaction,
} from "./quota-service";

/**
 * 按条返还（D1，2026-10-25）：客户只为已交付的成片计数。
 *
 * 记账口径（UsageLog 是流水，UserUsagePeriod 是按 UTC 月的计量表）：
 * - 正向：批次授权（batch_authorization，一次扣 requestedCount，按条分摊为 1）、
 *   单条派发授权（direct_dispatch_authorization，按请求扣，按 brief 分摊）、
 *   已返还条目的重试补扣（*_retry_recharge，按条）。
 * - 负向：按条返还（batch_item_refund / brief_refund）、单条派发即时补偿
 *   （direct_dispatch_compensation，按请求）。
 * - 某一条按资源分别算「净额」= 归属于它的正向 − 负向。净额 > 0 才动计量，
 *   返还记到最近一次正向记录所在的月份；净额 ≤ 0（豁免会话、脚本、历史回填、
 *   已即时补偿）只打标记、不动计量、不写流水。
 * - 防重：VideoJob.quotaRefundedAt / VideoBrief.quotaRefundedAt 是「本次终态已处理」
 *   标记；打标 CAS、计量递减与负数流水在同一个 Serializable 事务里提交。
 * - 截止：只处理 QUOTA_REFUND_CUTOFF（默认上线日）之后才进入终态的条目，历史不追溯。
 * - 已返还的条目再重试：先按最近一次正向记录的数额补扣，扣不到就拒绝重试
 *   （见 requeueRefundedBatchJob / rechargeRefundedBriefForSession）。
 *
 * 返还由清扫器末尾的 reconcileUndeliveredQuotaRefunds 做，不进 processBatchTick 热路径；
 * 单条出错只记日志、不影响其它条目，也不会抛进清扫器。
 */

/**
 * 本轮上线日：此前进入终态的条目一律不追溯。可用 QUOTA_REFUND_CUTOFF（ISO）覆盖。
 *
 * QUOTA_REFUND_CUTOFF 是「本轮上线时刻」的唯一来源：按条返还的截止线与清扫器里
 * 无任务 brief 看门狗的起点（sweep-service.joblessBriefSweepSince）都读 quotaRefundCutoff()。
 * 上线时把它设成真实部署时刻；没设时退回这个默认值——它不早于部署，只会少处理、
 * 绝不追溯历史（宁少退不多退，历史 brief 不被扫成失败）。
 */
export const QUOTA_REFUND_CUTOFF_DEFAULT = "2026-10-24T20:45:00.000Z";

const METERED_RESOURCES = [
  "VIDEO_DISPATCH",
  "SEEDANCE_SEGMENT",
] as const satisfies readonly UsageResource[];
type MeteredResource = (typeof METERED_RESOURCES)[number];

/** 流水 metadata.phase 的取值（正向 / 负向各自成对，按条归属靠 videoJobId / briefId） */
export const QUOTA_LEDGER_PHASE = {
  batchAuthorization: "batch_authorization",
  batchRetryRecharge: "batch_retry_recharge",
  batchItemRefund: "batch_item_refund",
  directDispatchAuthorization: "direct_dispatch_authorization",
  directDispatchCompensation: "direct_dispatch_compensation",
  briefRetryRecharge: "brief_retry_recharge",
  briefRefund: "brief_refund",
} as const;

/// 单条派发请求在这段时间内可能仍在路由里做即时补偿（Vercel 函数时长远小于此），
/// 对账让路，避免与路由的补偿抢同一条 brief。
const DISPATCH_IN_FLIGHT_MS = 15 * 60_000;
/// brief 补扣与「把失败段翻回排队」不在同一个事务（重提在 video-service 里）。
/// 刚补扣的 brief 这段时间内不返还，等重提落定。
const RECENT_RECHARGE_GRACE_MS = 5 * 60_000;

const UNDELIVERED_JOB_STATUSES: readonly VideoJobStatus[] = [
  VideoJobStatus.FAILED,
  VideoJobStatus.CANCELLED,
];
const ACTIVE_JOB_STATUSES: readonly VideoJobStatus[] = [
  VideoJobStatus.QUEUED,
  VideoJobStatus.RUNNING,
  VideoJobStatus.PAUSED,
];

export function quotaRefundCutoff(
  env: Record<string, string | undefined> = process.env,
): Date {
  const raw = env.QUOTA_REFUND_CUTOFF?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    console.warn(
      JSON.stringify({ evt: "quota_refund_cutoff_invalid", value: raw }),
    );
  }
  return new Date(QUOTA_REFUND_CUTOFF_DEFAULT);
}

// ---------------------------------------------------------------------------
// 流水净额（纯函数，便于单测）
// ---------------------------------------------------------------------------

export interface QuotaLedgerEntry {
  resource: MeteredResource;
  /** 正数 = 扣费，负数 = 返还 */
  amount: number;
  createdAt: Date;
  phase: string;
}

export interface QuotaLedgerPosition {
  net: number;
  /** 最近一次正向记录：返还记到它的月份，补扣按它的数额 */
  latestCharge: { amount: number; createdAt: Date; phase: string } | null;
}

export function quotaLedgerPosition(
  entries: readonly QuotaLedgerEntry[],
  resource: MeteredResource,
): QuotaLedgerPosition {
  let net = 0;
  let latestCharge: QuotaLedgerPosition["latestCharge"] = null;
  for (const entry of entries) {
    if (entry.resource !== resource) continue;
    net += entry.amount;
    if (
      entry.amount > 0 &&
      (!latestCharge || entry.createdAt >= latestCharge.createdAt)
    ) {
      latestCharge = {
        amount: entry.amount,
        createdAt: entry.createdAt,
        phase: entry.phase,
      };
    }
  }
  return { net, latestCharge };
}

/** 净额 > 0 的资源：返还数额与入账月份（最近一次正向记录的 UTC 月） */
export function planLedgerRefund(entries: readonly QuotaLedgerEntry[]): Array<{
  resource: MeteredResource;
  amount: number;
  periodKey: string;
  chargePhase: string;
}> {
  return METERED_RESOURCES.flatMap((resource) => {
    const position = quotaLedgerPosition(entries, resource);
    if (position.net <= 0 || !position.latestCharge) return [];
    return [
      {
        resource,
        /// 正常情况下净额恰好等于最近一次正向数额；多出来说明流水异常，宁少退不多退。
        amount: Math.min(position.net, position.latestCharge.amount),
        periodKey: currentUsagePeriodKey(position.latestCharge.createdAt),
        chargePhase: position.latestCharge.phase,
      },
    ];
  });
}

/** 已返还条目的补扣：曾经扣过费、且已全部返还（净额 ≤ 0）的资源，按最近一次正向数额补扣 */
export function planLedgerRecharge(entries: readonly QuotaLedgerEntry[]): Array<{
  resource: MeteredResource;
  amount: number;
}> {
  return METERED_RESOURCES.flatMap((resource) => {
    const position = quotaLedgerPosition(entries, resource);
    if (position.net > 0 || !position.latestCharge) return [];
    return [{ resource, amount: position.latestCharge.amount }];
  });
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMeteredResource(resource: UsageResource): resource is MeteredResource {
  return (METERED_RESOURCES as readonly UsageResource[]).includes(resource);
}

type LedgerLog = {
  resource: UsageResource;
  amount: number;
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
};

const LEDGER_LOG_SELECT = {
  resource: true,
  amount: true,
  createdAt: true,
  metadata: true,
} as const;

function logPhase(log: LedgerLog): string {
  const phase = jsonRecord(log.metadata).phase;
  return typeof phase === "string" ? phase : "";
}

/** 某条自己的补扣（+）与返还（−）流水 */
function itemLedgerEntries(
  logs: readonly LedgerLog[],
  rechargePhase: string,
  refundPhase: string,
): QuotaLedgerEntry[] {
  const entries: QuotaLedgerEntry[] = [];
  for (const log of logs) {
    if (!isMeteredResource(log.resource)) continue;
    const phase = logPhase(log);
    if (
      (phase === rechargePhase && log.amount > 0) ||
      (phase === refundPhase && log.amount < 0)
    ) {
      entries.push({
        resource: log.resource,
        amount: log.amount,
        createdAt: log.createdAt,
        phase,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 批量：按 VideoJob 记账
// ---------------------------------------------------------------------------

async function loadBatchItemLedger(
  tx: Prisma.TransactionClient,
  args: { userId: string; batchId: string; jobId: string },
): Promise<QuotaLedgerEntry[]> {
  const authorization = await tx.usageLog.findMany({
    where: {
      userId: args.userId,
      resource: { in: [...METERED_RESOURCES] },
      amount: { gt: 0 },
      AND: [
        { metadata: { path: ["batchId"], equals: args.batchId } },
        {
          metadata: {
            path: ["phase"],
            equals: QUOTA_LEDGER_PHASE.batchAuthorization,
          },
        },
      ],
    },
    select: LEDGER_LOG_SELECT,
    orderBy: { createdAt: "asc" },
  });
  const itemLogs = await tx.usageLog.findMany({
    where: {
      userId: args.userId,
      resource: { in: [...METERED_RESOURCES] },
      metadata: { path: ["videoJobId"], equals: args.jobId },
    },
    select: LEDGER_LOG_SELECT,
  });

  const entries: QuotaLedgerEntry[] = [];
  /// 批次授权一次扣 requestedCount 条，按条分摊：每条 1 支视频 + 1 段画面。
  const authorized = new Set<MeteredResource>();
  for (const log of authorization) {
    if (!isMeteredResource(log.resource) || authorized.has(log.resource)) continue;
    authorized.add(log.resource);
    entries.push({
      resource: log.resource,
      amount: 1,
      createdAt: log.createdAt,
      phase: QUOTA_LEDGER_PHASE.batchAuthorization,
    });
  }
  entries.push(
    ...itemLedgerEntries(
      itemLogs,
      QUOTA_LEDGER_PHASE.batchRetryRecharge,
      QUOTA_LEDGER_PHASE.batchItemRefund,
    ),
  );
  return entries;
}

/**
 * 按计划递减计量表并写负数流水。计量表不够减（人工改过表等）时不写流水，
 * 保持流水与计量一致；调用方照样打标，日志留给客服对账。
 */
async function applyLedgerRefund(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    entries: readonly QuotaLedgerEntry[];
    metadata: Record<string, unknown>;
  },
): Promise<boolean> {
  let refunded = false;
  for (const item of planLedgerRefund(args.entries)) {
    const meter = await tx.userUsagePeriod.updateMany({
      where: {
        userId: args.userId,
        periodKey: item.periodKey,
        resource: item.resource,
        amount: { gte: item.amount },
      },
      data: { amount: { decrement: item.amount } },
    });
    if (meter.count !== 1) {
      console.warn(
        JSON.stringify({
          evt: "quota_refund_meter_underflow",
          userId: args.userId,
          resource: item.resource,
          periodKey: item.periodKey,
          amount: item.amount,
          ...args.metadata,
        }),
      );
      continue;
    }
    await tx.usageLog.create({
      data: {
        userId: args.userId,
        resource: item.resource,
        amount: -item.amount,
        metadata: {
          ...args.metadata,
          chargedPeriodKey: item.periodKey,
          chargePhase: item.chargePhase,
        } as Prisma.InputJsonValue,
      },
    });
    refunded = true;
  }
  return refunded;
}

export type QuotaRefundOutcome = "refunded" | "stamped" | "skipped";

function jobTerminalAfterCutoff(
  job: { finishedAt: Date | null; createdAt: Date },
  cutoff: Date,
): boolean {
  if (job.finishedAt) return job.finishedAt >= cutoff;
  /// 个别失败路径不写 finishedAt：只认上线之后才创建的行（它的终态必然在上线之后）。
  return job.createdAt >= cutoff;
}

/**
 * 批量里一条已终态未交付（FAILED / CANCELLED）的 VideoJob：返还它分摊到的额度。
 * 幂等：VideoJob.quotaRefundedAt CAS；同事务递减扣费当月计量并写负数流水。
 */
export async function refundUndeliveredBatchJob(
  jobId: string,
  options: { now?: Date; cutoff?: Date } = {},
): Promise<QuotaRefundOutcome> {
  const now = options.now ?? new Date();
  const cutoff = options.cutoff ?? quotaRefundCutoff();
  return runSerializableQuotaTransaction(async (tx) => {
    const job = await tx.videoJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        quotaRefundedAt: true,
        finishedAt: true,
        createdAt: true,
        batchJobId: true,
        batchJob: { select: { userId: true } },
      },
    });
    if (!job?.batchJobId || !job.batchJob || job.quotaRefundedAt) {
      return "skipped" as const;
    }
    if (!UNDELIVERED_JOB_STATUSES.includes(job.status)) return "skipped" as const;
    if (!jobTerminalAfterCutoff(job, cutoff)) return "skipped" as const;

    const userId = job.batchJob.userId;
    const entries = await loadBatchItemLedger(tx, {
      userId,
      batchId: job.batchJobId,
      jobId: job.id,
    });
    const stamped = await tx.videoJob.updateMany({
      where: { id: job.id, status: job.status, quotaRefundedAt: null },
      data: { quotaRefundedAt: now },
    });
    if (stamped.count !== 1) return "skipped" as const;

    const refunded = await applyLedgerRefund(tx, {
      userId,
      entries,
      metadata: {
        batchId: job.batchJobId,
        videoJobId: job.id,
        phase: QUOTA_LEDGER_PHASE.batchItemRefund,
        reason: job.status === VideoJobStatus.CANCELLED ? "cancelled" : "failed",
      },
    });
    return refunded ? ("refunded" as const) : ("stamped" as const);
  });
}

export class QuotaRechargeUnavailableError extends Error {
  readonly code = "QUOTA_RECHARGE_UNAVAILABLE" as const;
  constructor(message = "该任务的额度已返还，重试需要先重新计入额度") {
    super(message);
    this.name = "QuotaRechargeUnavailableError";
  }
}

/**
 * 把一条已返还额度的失败批量任务翻回排队：先补扣它最近一次被返还的额度，
 * 再执行调用方给的 CAS 重置（requeue 的 where 必须带上传入的 refundedAt，
 * data 必须把 quotaRefundedAt 置空），两者同一个 Serializable 事务——
 * 不会出现「扣了没排上」或「排上了没扣」。
 *
 * - 额度不足抛 QuotaExceededError（事务回滚，任务保持 FAILED）。
 * - 豁免会话 / 未开启计量：不补扣，仍允许重试；流水净额保持 ≤ 0，再失败只打标记。
 * - 没有会话（脚本）且需要补扣：抛 QuotaRechargeUnavailableError，拒绝重试。
 */
export async function requeueRefundedBatchJob(params: {
  session?: Session | null;
  userId: string;
  batchId: string;
  jobId: string;
  requeue: (
    tx: Prisma.TransactionClient,
    state: { refundedAt: Date | null },
  ) => Promise<number>;
}): Promise<{ requeued: boolean; recharged: boolean }> {
  const meteringOn = isQuotaEnforced();
  const enforce =
    meteringOn && !!params.session && !isQuotaExemptSession(params.session);
  const plan = enforce ? await resolveQuotaPlan(params.userId) : null;
  const periodKey = currentUsagePeriodKey();
  return runSerializableQuotaTransaction(async (tx) => {
    const job = await tx.videoJob.findFirst({
      where: { id: params.jobId, batchJobId: params.batchId },
      select: { quotaRefundedAt: true },
    });
    if (!job) return { requeued: false, recharged: false };

    const recharge = job.quotaRefundedAt
      ? planLedgerRecharge(
          await loadBatchItemLedger(tx, {
            userId: params.userId,
            batchId: params.batchId,
            jobId: params.jobId,
          }),
        )
      : [];
    if (recharge.length > 0 && meteringOn && !params.session) {
      throw new QuotaRechargeUnavailableError();
    }

    const requeued = await params.requeue(tx, {
      refundedAt: job.quotaRefundedAt,
    });
    if (requeued !== 1) return { requeued: false, recharged: false };

    if (recharge.length > 0 && enforce && plan) {
      await chargeMetersInTransaction(tx, {
        userId: params.userId,
        plan,
        periodKey,
        items: recharge.map((item) => ({
          resource: item.resource,
          amount: item.amount,
          metadata: {
            batchId: params.batchId,
            videoJobId: params.jobId,
            phase: QUOTA_LEDGER_PHASE.batchRetryRecharge,
          },
        })),
      });
      return { requeued: true, recharged: true };
    }
    return { requeued: true, recharged: false };
  });
}

// ---------------------------------------------------------------------------
// 单条：按 VideoBrief 记账
// ---------------------------------------------------------------------------

type DispatchRequestRow = {
  id: string;
  state: VideoDispatchRequestState;
  createdAt: Date;
  completedAt: Date | null;
  responseBody: Prisma.JsonValue | null;
};

/** 成功响应体里点名的 brief（briefId + batch[].briefId） */
function successBodyBriefIds(body: Prisma.JsonValue | null): string[] {
  const record = jsonRecord(body);
  if (record.ok !== true) return [];
  const ids = new Set<string>();
  if (typeof record.briefId === "string") ids.add(record.briefId);
  if (Array.isArray(record.batch)) {
    for (const entry of record.batch) {
      const id = jsonRecord(entry as Prisma.JsonValue).briefId;
      if (typeof id === "string") ids.add(id);
    }
  }
  return [...ids];
}

function dispatchWindowEnd(request: DispatchRequestRow): Date {
  return (
    request.completedAt ??
    new Date(request.createdAt.getTime() + DISPATCH_IN_FLIGHT_MS)
  );
}

type BriefDispatchLink =
  | { kind: "linked"; requestId: string; briefCount: number }
  | { kind: "unlinked" }
  | { kind: "ambiguous" }
  | { kind: "in_flight" };

/**
 * brief 与扣费请求之间没有外键：成功响应体会点名 brief；失败响应体不带 brief，
 * 只能按「brief 创建时刻落在请求处理窗口内」认领，且窗口内必须只有它一条
 * 无主 brief。认不准就判 ambiguous（只打标记、宁少退不多退）。
 */
async function linkBriefDispatchRequest(
  tx: Prisma.TransactionClient,
  args: { briefId: string; briefCreatedAt: Date; ownerId: string; now: Date },
): Promise<BriefDispatchLink> {
  const requests: DispatchRequestRow[] = await tx.videoDispatchRequest.findMany({
    where: {
      userId: args.ownerId,
      createdAt: {
        gte: new Date(args.briefCreatedAt.getTime() - DISPATCH_IN_FLIGHT_MS),
        lte: args.briefCreatedAt,
      },
    },
    select: {
      id: true,
      state: true,
      createdAt: true,
      completedAt: true,
      responseBody: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const inWindow = requests.filter(
    (request) => dispatchWindowEnd(request) >= args.briefCreatedAt,
  );
  const named = inWindow.filter((request) =>
    successBodyBriefIds(request.responseBody).includes(args.briefId),
  );
  if (named.length > 1) return { kind: "ambiguous" };
  if (named.length === 1) {
    return {
      kind: "linked",
      requestId: named[0].id,
      briefCount: successBodyBriefIds(named[0].responseBody).length,
    };
  }

  const open = inWindow.filter(
    (request) => successBodyBriefIds(request.responseBody).length === 0,
  );
  if (
    open.some(
      (request) =>
        request.state === VideoDispatchRequestState.PROCESSING &&
        args.now.getTime() - request.createdAt.getTime() < DISPATCH_IN_FLIGHT_MS,
    )
  ) {
    return { kind: "in_flight" };
  }
  if (open.length === 0) return { kind: "unlinked" };
  if (open.length > 1) return { kind: "ambiguous" };

  const request = open[0];
  const claimedElsewhere = new Set(
    inWindow.flatMap((candidate) => successBodyBriefIds(candidate.responseBody)),
  );
  const siblings = await tx.videoBrief.findMany({
    where: {
      createdAt: { gte: request.createdAt, lte: dispatchWindowEnd(request) },
      contentAngle: {
        round: { deliveryOrder: { createdById: args.ownerId } },
      },
    },
    select: { id: true },
    take: 10,
  });
  const unclaimed = siblings.filter((brief) => !claimedElsewhere.has(brief.id));
  if (unclaimed.length !== 1 || unclaimed[0].id !== args.briefId) {
    return { kind: "ambiguous" };
  }
  return { kind: "linked", requestId: request.id, briefCount: 1 };
}

/**
 * 按即时补偿流水认领：direct_dispatch_compensation 的 metadata.briefIds 点名了本条 brief，
 * 且只指向一笔请求，就认那笔请求；briefCount 取那次补偿点名的 brief 数（按支均摊）。
 * 没有点名（历史流水、未补偿过）或点名了多笔请求时返回 null，退回时间窗口认领。
 */
async function linkBriefByCompensation(
  tx: Prisma.TransactionClient,
  args: { briefId: string; ownerId: string },
): Promise<Extract<BriefDispatchLink, { kind: "linked" }> | null> {
  const logs = await tx.usageLog.findMany({
    where: {
      userId: args.ownerId,
      resource: { in: [...METERED_RESOURCES] },
      amount: { lt: 0 },
      AND: [
        {
          metadata: {
            path: ["phase"],
            equals: QUOTA_LEDGER_PHASE.directDispatchCompensation,
          },
        },
        { metadata: { path: ["briefIds"], array_contains: [args.briefId] } },
      ],
    },
    select: { metadata: true },
    take: 10,
  });
  const links = new Map<string, number>();
  for (const log of logs) {
    const metadata = jsonRecord(log.metadata);
    const briefIds = Array.isArray(metadata.briefIds) ? metadata.briefIds : [];
    if (typeof metadata.requestId !== "string" || !briefIds.includes(args.briefId)) {
      continue;
    }
    links.set(metadata.requestId, briefIds.length);
  }
  if (links.size !== 1) return null;
  const [[requestId, briefCount]] = [...links];
  return { kind: "linked", requestId, briefCount };
}

async function loadBriefLedger(
  tx: Prisma.TransactionClient,
  args: { briefId: string; briefCreatedAt: Date; ownerId: string; now: Date },
): Promise<
  | { kind: "in_flight" }
  | {
      kind: "ledger";
      entries: QuotaLedgerEntry[];
      requestId: string | null;
      linkage: BriefDispatchLink["kind"];
    }
> {
  /// 即时补偿流水点名过这条 brief（briefIds）：这是数据库里的硬证据，优先于时间窗口认领。
  /// 并发派发（两个标签页）时窗口里有多笔请求，窗口认领只能判 ambiguous——已补偿的
  /// brief 再重试就清掉标记、一分不补扣，免费重跑。
  const link =
    (await linkBriefByCompensation(tx, args)) ??
    (await linkBriefDispatchRequest(tx, args));
  if (link.kind === "in_flight") return { kind: "in_flight" };

  const entries: QuotaLedgerEntry[] = [];
  let linkage: BriefDispatchLink["kind"] = link.kind;
  if (link.kind === "linked") {
    const requestLogs: LedgerLog[] = await tx.usageLog.findMany({
      where: {
        userId: args.ownerId,
        resource: { in: [...METERED_RESOURCES] },
        metadata: { path: ["requestId"], equals: link.requestId },
      },
      select: LEDGER_LOG_SELECT,
      orderBy: { createdAt: "asc" },
    });
    const requestEntries: QuotaLedgerEntry[] = [];
    for (const resource of METERED_RESOURCES) {
      const authorization = requestLogs.filter(
        (log) =>
          log.resource === resource &&
          log.amount > 0 &&
          logPhase(log) === QUOTA_LEDGER_PHASE.directDispatchAuthorization,
      );
      const compensation = requestLogs.filter(
        (log) =>
          log.resource === resource &&
          log.amount < 0 &&
          logPhase(log) === QUOTA_LEDGER_PHASE.directDispatchCompensation,
      );
      const charged = authorization.reduce((sum, log) => sum + log.amount, 0);
      const compensated = compensation.reduce((sum, log) => sum - log.amount, 0);
      if (charged <= 0) continue;
      /// 历史多支请求（batchCount 1–3）按支均摊；除不尽就不认这笔，宁少退不多退。
      if (charged % link.briefCount !== 0 || compensated % link.briefCount !== 0) {
        linkage = "ambiguous";
        requestEntries.length = 0;
        break;
      }
      requestEntries.push({
        resource,
        amount: charged / link.briefCount,
        createdAt: authorization[0].createdAt,
        phase: QUOTA_LEDGER_PHASE.directDispatchAuthorization,
      });
      if (compensated > 0) {
        requestEntries.push({
          resource,
          amount: -(compensated / link.briefCount),
          createdAt: compensation[compensation.length - 1].createdAt,
          phase: QUOTA_LEDGER_PHASE.directDispatchCompensation,
        });
      }
    }
    entries.push(...requestEntries);
  }

  const briefLogs: LedgerLog[] = await tx.usageLog.findMany({
    where: {
      userId: args.ownerId,
      resource: { in: [...METERED_RESOURCES] },
      metadata: { path: ["briefId"], equals: args.briefId },
    },
    select: LEDGER_LOG_SELECT,
  });
  entries.push(
    ...itemLedgerEntries(
      briefLogs,
      QUOTA_LEDGER_PHASE.briefRetryRecharge,
      QUOTA_LEDGER_PHASE.briefRefund,
    ),
  );
  return {
    kind: "ledger",
    entries,
    requestId: link.kind === "linked" ? link.requestId : null,
    linkage,
  };
}

const BRIEF_REFUND_SELECT = {
  id: true,
  status: true,
  quotaRefundedAt: true,
  finalVideoUrl: true,
  brandedVideoUrl: true,
  createdAt: true,
  contentAngle: {
    select: {
      round: { select: { deliveryOrder: { select: { createdById: true } } } },
    },
  },
  videoJobs: {
    select: {
      status: true,
      submissionState: true,
      submittedAt: true,
      createdAt: true,
      finishedAt: true,
    },
  },
  finalVideo: { select: { finishedAt: true } },
} as const;

/**
 * 这一段的提交可能还在路上：SUBMITTING 且提交时刻（缺失时退回建行时刻）在
 * DISPATCH_IN_FLIGHT_MS 之内。派发 / 重试路由的执行上限远小于这个窗口，
 * 更老的 SUBMITTING 只能是路由中途被杀、没来得及写回的残留——清扫器把它判
 * FAILED 时不改 submissionState。它不可能再提交成功，也拿不到供应商任务号、
 * 不会交付成片，按 D1 照常返还（宁可对客户有利，也不让它永远卡在队头）。
 */
function submissionMayBeInFlight(
  job: { submissionState: ProviderSubmissionState; submittedAt: Date | null; createdAt: Date },
  now: Date,
): boolean {
  if (job.submissionState !== ProviderSubmissionState.SUBMITTING) return false;
  const startedAt = job.submittedAt ?? job.createdAt;
  return now.getTime() - startedAt.getTime() < DISPATCH_IN_FLIGHT_MS;
}

/** 对账候选里排除「还不能处理」的 brief：有段在跑，或有段的提交可能还在路上（与上面同口径）。 */
function briefRefundNotReadyJobWhere(now: Date): Prisma.VideoJobWhereInput {
  const inFlightSince = new Date(now.getTime() - DISPATCH_IN_FLIGHT_MS);
  return {
    OR: [
      { status: { in: [...ACTIVE_JOB_STATUSES] } },
      {
        submissionState: ProviderSubmissionState.SUBMITTING,
        OR: [
          { submittedAt: { gt: inFlightSince } },
          { submittedAt: null, createdAt: { gt: inFlightSince } },
        ],
      },
    ],
  };
}

function briefTerminalAfterCutoff(
  brief: {
    createdAt: Date;
    videoJobs: Array<{ finishedAt: Date | null }>;
    finalVideo: { finishedAt: Date | null } | null;
  },
  cutoff: Date,
): boolean {
  return (
    brief.createdAt >= cutoff ||
    brief.videoJobs.some((job) => !!job.finishedAt && job.finishedAt >= cutoff) ||
    (!!brief.finalVideo?.finishedAt && brief.finalVideo.finishedAt >= cutoff)
  );
}

/**
 * 单条：brief 进入终态失败（RENDER_FAILED）且没有交付任何成片时，返还它那一单
 * 分摊到的额度。幂等：VideoBrief.quotaRefundedAt CAS（与派发路由的即时补偿互斥）。
 */
export async function refundFailedBrief(
  briefId: string,
  options: { now?: Date; cutoff?: Date } = {},
): Promise<QuotaRefundOutcome> {
  const now = options.now ?? new Date();
  const cutoff = options.cutoff ?? quotaRefundCutoff();
  return runSerializableQuotaTransaction(async (tx) => {
    const brief = await tx.videoBrief.findUnique({
      where: { id: briefId },
      select: BRIEF_REFUND_SELECT,
    });
    if (!brief || brief.quotaRefundedAt) return "skipped" as const;
    if (
      brief.status !== VideoBriefStatus.RENDER_FAILED ||
      brief.finalVideoUrl ||
      brief.brandedVideoUrl
    ) {
      return "skipped" as const;
    }
    /// 还有段在跑（刚被重试翻回排队）就不是终态，等它落定。
    if (brief.videoJobs.some((job) => ACTIVE_JOB_STATUSES.includes(job.status))) {
      return "skipped" as const;
    }
    /// 提交可能还在路上就等它落定；早已超出路由上限的 SUBMITTING 残留不再挡住返还。
    if (brief.videoJobs.some((job) => submissionMayBeInFlight(job, now))) {
      return "skipped" as const;
    }
    if (!briefTerminalAfterCutoff(brief, cutoff)) return "skipped" as const;

    const ownerId = brief.contentAngle.round.deliveryOrder.createdById;
    let entries: QuotaLedgerEntry[] = [];
    let requestId: string | null = null;
    if (ownerId) {
      const ledger = await loadBriefLedger(tx, {
        briefId: brief.id,
        briefCreatedAt: brief.createdAt,
        ownerId,
        now,
      });
      if (ledger.kind === "in_flight") return "skipped" as const;
      const rechargedRecently = ledger.entries.some(
        (entry) =>
          entry.phase === QUOTA_LEDGER_PHASE.briefRetryRecharge &&
          now.getTime() - entry.createdAt.getTime() < RECENT_RECHARGE_GRACE_MS,
      );
      if (rechargedRecently) return "skipped" as const;
      if (ledger.linkage === "ambiguous") {
        console.warn(
          JSON.stringify({
            evt: "quota_refund_brief_unlinked",
            briefId: brief.id,
            userId: ownerId,
          }),
        );
      }
      entries = ledger.entries;
      requestId = ledger.requestId;
    }

    const stamped = await tx.videoBrief.updateMany({
      where: {
        id: brief.id,
        status: VideoBriefStatus.RENDER_FAILED,
        quotaRefundedAt: null,
      },
      data: { quotaRefundedAt: now },
    });
    if (stamped.count !== 1) return "skipped" as const;
    if (!ownerId) return "stamped" as const;

    const refunded = await applyLedgerRefund(tx, {
      userId: ownerId,
      entries,
      metadata: {
        briefId: brief.id,
        requestId,
        phase: QUOTA_LEDGER_PHASE.briefRefund,
        reason: "render_failed",
      },
    });
    return refunded ? ("refunded" as const) : ("stamped" as const);
  });
}

/**
 * 单条重试前调用（render-retry）：brief 的额度已返还过，就先按最近一次正向数额补扣，
 * 同事务清掉返还标记；额度不足抛 QuotaExceededError，调用方拒绝重试。
 * 豁免会话 / 未开启计量：只清标记不补扣（流水净额 ≤ 0，再失败只打标记）。
 */
export async function rechargeRefundedBriefForSession(
  session: Session,
  briefId: string,
): Promise<{ recharged: boolean; cleared: boolean }> {
  const now = new Date();
  const enforce = isQuotaEnforced() && !isQuotaExemptSession(session);
  const plan = enforce ? await resolveQuotaPlan(session.user.id) : null;
  const periodKey = currentUsagePeriodKey(now);
  return runSerializableQuotaTransaction(async (tx) => {
    const brief = await tx.videoBrief.findUnique({
      where: { id: briefId },
      select: {
        quotaRefundedAt: true,
        createdAt: true,
        contentAngle: {
          select: {
            round: {
              select: { deliveryOrder: { select: { createdById: true } } },
            },
          },
        },
      },
    });
    if (!brief?.quotaRefundedAt) return { recharged: false, cleared: false };

    const ownerId = brief.contentAngle.round.deliveryOrder.createdById;
    let recharge: ReturnType<typeof planLedgerRecharge> = [];
    if (ownerId) {
      const ledger = await loadBriefLedger(tx, {
        briefId,
        briefCreatedAt: brief.createdAt,
        ownerId,
        now,
      });
      if (ledger.kind === "ledger") recharge = planLedgerRecharge(ledger.entries);
    }

    const mustCharge = enforce && recharge.length > 0;
    /// 只给 brief 的主人补扣；非豁免会话替别人重试属于越权，失败关闭。
    if (mustCharge && ownerId !== session.user.id) {
      throw new QuotaRechargeUnavailableError();
    }

    const cleared = await tx.videoBrief.updateMany({
      where: { id: briefId, quotaRefundedAt: brief.quotaRefundedAt },
      data: { quotaRefundedAt: null },
    });
    if (cleared.count !== 1) return { recharged: false, cleared: false };

    if (mustCharge && ownerId && plan) {
      await chargeMetersInTransaction(tx, {
        userId: ownerId,
        plan,
        periodKey,
        items: recharge.map((item) => ({
          resource: item.resource,
          amount: item.amount,
          metadata: {
            briefId,
            phase: QUOTA_LEDGER_PHASE.briefRetryRecharge,
          },
        })),
      });
      return { recharged: true, cleared: true };
    }
    return { recharged: false, cleared: true };
  });
}

// ---------------------------------------------------------------------------
// 清扫器入口
// ---------------------------------------------------------------------------

export interface QuotaRefundReconcileResult {
  refundedJobs: string[];
  stampedJobs: number;
  refundedBriefs: string[];
  stampedBriefs: number;
  errors: number;
}

/**
 * 清扫器末尾调用：把上线之后进入终态、尚未处理的未交付条目逐条返还。
 * 每条一个独立事务；单条异常只计数记日志，绝不抛出。
 */
export async function reconcileUndeliveredQuotaRefunds(
  now = new Date(),
  options: { batchLimit?: number; briefLimit?: number; cutoff?: Date } = {},
): Promise<QuotaRefundReconcileResult> {
  const cutoff = options.cutoff ?? quotaRefundCutoff();
  const result: QuotaRefundReconcileResult = {
    refundedJobs: [],
    stampedJobs: 0,
    refundedBriefs: [],
    stampedBriefs: 0,
    errors: 0,
  };

  try {
    const batchLimit = options.batchLimit ?? 40;
    const pendingRefundWhere: Prisma.VideoJobWhereInput = {
      status: { in: [...UNDELIVERED_JOB_STATUSES] },
      quotaRefundedAt: null,
      OR: [
        { finishedAt: { gte: cutoff } },
        { finishedAt: null, createdAt: { gte: cutoff } },
      ],
    };
    /// 按批次取候选（一批的未交付条目通常一起进入终态，同一批连着对账）。
    const batches = await db.batchJob.findMany({
      where: { videoJobs: { some: pendingRefundWhere } },
      select: {
        id: true,
        videoJobs: {
          where: pendingRefundWhere,
          select: { id: true, status: true, quotaRefundedAt: true },
          orderBy: { updatedAt: "asc" },
          take: batchLimit,
        },
      },
      orderBy: { updatedAt: "asc" },
      take: batchLimit,
    });
    const jobs = batches
      .flatMap((batch) =>
        batch.videoJobs.map((job) => ({ ...job, batchJobId: batch.id })),
      )
      .slice(0, batchLimit);
    for (const job of jobs) {
      /// 防御：只处理确实是「批量 + 未交付终态 + 未处理」的行。
      if (
        !job.batchJobId ||
        job.quotaRefundedAt ||
        !UNDELIVERED_JOB_STATUSES.includes(job.status)
      ) {
        continue;
      }
      try {
        const outcome = await refundUndeliveredBatchJob(job.id, { now, cutoff });
        if (outcome === "refunded") result.refundedJobs.push(job.id);
        if (outcome === "stamped") result.stampedJobs += 1;
      } catch (error) {
        result.errors += 1;
        console.warn(
          `[quota-refund] batch job ${job.id} failed:`,
          (error as Error).message,
        );
      }
    }
  } catch (error) {
    result.errors += 1;
    console.warn("[quota-refund] batch scan failed:", (error as Error).message);
  }

  try {
    const briefs = await db.videoBrief.findMany({
      where: {
        status: VideoBriefStatus.RENDER_FAILED,
        quotaRefundedAt: null,
        finalVideoUrl: null,
        brandedVideoUrl: null,
        /// 跳过不打标、也不刷新 updatedAt 的行会一直排在 updatedAt 升序的队头；
        /// 现在就不能处理的 brief 不进候选，免得 20 条名额被它们长期占满。
        videoJobs: { none: briefRefundNotReadyJobWhere(now) },
        OR: [
          { createdAt: { gte: cutoff } },
          { videoJobs: { some: { finishedAt: { gte: cutoff } } } },
          { finalVideo: { is: { finishedAt: { gte: cutoff } } } },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: options.briefLimit ?? 20,
    });
    for (const brief of briefs) {
      try {
        const outcome = await refundFailedBrief(brief.id, { now, cutoff });
        if (outcome === "refunded") result.refundedBriefs.push(brief.id);
        if (outcome === "stamped") result.stampedBriefs += 1;
      } catch (error) {
        result.errors += 1;
        console.warn(
          `[quota-refund] brief ${brief.id} failed:`,
          (error as Error).message,
        );
      }
    }
  } catch (error) {
    result.errors += 1;
    console.warn("[quota-refund] brief scan failed:", (error as Error).message);
  }

  return result;
}

export const __test__ = {
  successBodyBriefIds,
  linkBriefDispatchRequest,
  loadBatchItemLedger,
  loadBriefLedger,
  DISPATCH_IN_FLIGHT_MS,
  RECENT_RECHARGE_GRACE_MS,
};
