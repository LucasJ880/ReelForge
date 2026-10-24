import {
  BatchJobStatus,
  Prisma,
  ProviderSubmissionState,
  VideoDispatchRequestState,
  VideoJobStatus,
  type UsageResource,
} from "@prisma/client";
import type { Session } from "next-auth";
import { QUOTA_LIMITS, REGISTER_RATE_LIMIT, type QuotaPlanId } from "@/lib/config/quota-tiers";
import { QUOTA_PLAN_WORKSPACE_SELECT, quotaPlanFromWorkspace } from "@/lib/config/quota-tiers";
import { db } from "@/lib/db";
import {
  RateLimitExceededError,
  bumpRateLimit,
  dailyWindowKey,
  hourlyWindowKey,
} from "./rate-limit-service";

export { RateLimitExceededError };

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly resource: UsageResource;
  readonly used: number;
  readonly limit: number;
  readonly periodKey: string;

  constructor(params: {
    resource: UsageResource;
    used: number;
    limit: number;
    periodKey: string;
  }) {
    super(userMessageForQuota(params.resource));
    this.name = "QuotaExceededError";
    this.resource = params.resource;
    this.used = params.used;
    this.limit = params.limit;
    this.periodKey = params.periodKey;
  }
}

export function isQuotaEnforced(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.QUOTA_ENFORCE === "true") return true;
  if (process.env.QUOTA_ENFORCE === "false") return false;
  /// dev 默认关闭，避免 walkthrough 误触；设 QUOTA_ENFORCE=true 可本地测
  return false;
}

export function isQuotaExemptSession(session: Session): boolean {
  const userType = session.user.userType;
  if (userType === "OPERATOR" || userType === "SUPER_ADMIN") return true;
  const role = session.user.role;
  if (role === "SUPER_ADMIN") return true;
  return false;
}

export function currentUsagePeriodKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function resolveQuotaPlan(userId: string): Promise<QuotaPlanId> {
  try {
    const workspace = await db.workspace.findUnique({
      where: { ownerId: userId },
      select: QUOTA_PLAN_WORKSPACE_SELECT,
    });
    /// D5：starter 账号带试用标记时按 trial 计（规则在 quota-tiers）。
    return quotaPlanFromWorkspace(workspace);
  } catch (err) {
    console.warn("[resolveQuotaPlan] using starter fallback", err);
  }
  return "starter";
}

export function getLimitForResource(
  plan: QuotaPlanId,
  resource: UsageResource,
): number {
  return QUOTA_LIMITS[plan][resource];
}

export interface UsageMeterSnapshot {
  resource: UsageResource;
  used: number;
  limit: number;
  remaining: number;
  periodKey: string;
}

export async function getUsageSummary(userId: string): Promise<{
  plan: QuotaPlanId;
  periodKey: string;
  meters: UsageMeterSnapshot[];
}> {
  const plan = await resolveQuotaPlan(userId);
  const periodKey = currentUsagePeriodKey();
  const resources = Object.keys(QUOTA_LIMITS[plan]) as UsageResource[];

  const rows = await db.userUsagePeriod.findMany({
    where: { userId, periodKey },
  });
  const byResource = new Map(rows.map((r) => [r.resource, r.amount]));

  const meters = resources.map((resource) => {
    const limit = getLimitForResource(plan, resource);
    const used = byResource.get(resource) ?? 0;
    return {
      resource,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      periodKey,
    };
  });

  return { plan, periodKey, meters };
}

/**
 * 检查配额；enforce=true 时原子扣减并写 UsageLog。
 */
export async function consumeUsage(params: {
  userId: string;
  resource: UsageResource;
  amount?: number;
  enforce?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<UsageMeterSnapshot> {
  const amount = params.amount ?? 1;
  const enforce = params.enforce ?? isQuotaEnforced();
  const plan = await resolveQuotaPlan(params.userId);
  const periodKey = currentUsagePeriodKey();
  const limit = getLimitForResource(plan, params.resource);

  if (!enforce) {
    return {
      resource: params.resource,
      used: 0,
      limit,
      remaining: limit,
      periodKey,
    };
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.userUsagePeriod.findUnique({
      where: {
        userId_periodKey_resource: {
          userId: params.userId,
          periodKey,
          resource: params.resource,
        },
      },
    });

    const used = existing?.amount ?? 0;
    if (used + amount > limit) {
      throw new QuotaExceededError({
        resource: params.resource,
        used,
        limit,
        periodKey,
      });
    }

    const updated = await tx.userUsagePeriod.upsert({
      where: {
        userId_periodKey_resource: {
          userId: params.userId,
          periodKey,
          resource: params.resource,
        },
      },
      create: {
        userId: params.userId,
        periodKey,
        resource: params.resource,
        amount,
      },
      update: { amount: { increment: amount } },
    });

    await tx.usageLog.create({
      data: {
        userId: params.userId,
        resource: params.resource,
        amount,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return {
      resource: params.resource,
      used: updated.amount,
      limit,
      remaining: Math.max(0, limit - updated.amount),
      periodKey,
    };
  });
}

export async function assertQuotaForSession(
  session: Session,
  resource: UsageResource,
  amount = 1,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (isQuotaExemptSession(session)) return;
  await consumeUsage({
    userId: session.user.id,
    resource,
    amount,
    metadata,
  });
}

/** 一次请求扣多种资源（如 dispatch = 1 次视频 + N 个 Seedance 段） */
export async function assertQuotaBatchForSession(
  session: Session,
  items: Array<{
    resource: UsageResource;
    amount?: number;
    metadata?: Record<string, unknown>;
  }>,
): Promise<{ consumed: boolean; periodKey: string }> {
  const periodKey = currentUsagePeriodKey();
  if (isQuotaExemptSession(session)) return { consumed: false, periodKey };
  if (items.length === 0) return { consumed: false, periodKey };

  const enforce = isQuotaEnforced();
  if (!enforce) return { consumed: false, periodKey };

  const userId = session.user.id;
  const plan = await resolveQuotaPlan(userId);

  // The check and increment must serialize across distinct idempotency keys.
  // Under READ COMMITTED, two requests can both observe the last available
  // slot and commit, exceeding the hard plan limit. PostgreSQL SSI aborts one
  // contender; retrying that transaction makes it observe the committed usage
  // and fail with QuotaExceededError instead of overspending.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await db.$transaction(
        async (tx) => {
          for (const item of items) {
            const amount = item.amount ?? 1;
            const limit = getLimitForResource(plan, item.resource);
            const existing = await tx.userUsagePeriod.findUnique({
              where: {
                userId_periodKey_resource: {
                  userId,
                  periodKey,
                  resource: item.resource,
                },
              },
            });
            const used = existing?.amount ?? 0;
            if (used + amount > limit) {
              throw new QuotaExceededError({
                resource: item.resource,
                used,
                limit,
                periodKey,
              });
            }
          }

          for (const item of items) {
            const amount = item.amount ?? 1;
            await tx.userUsagePeriod.upsert({
              where: {
                userId_periodKey_resource: {
                  userId,
                  periodKey,
                  resource: item.resource,
                },
              },
              create: {
                userId,
                periodKey,
                resource: item.resource,
                amount,
              },
              update: { amount: { increment: amount } },
            });
            await tx.usageLog.create({
              data: {
                userId,
                resource: item.resource,
                amount,
                metadata: (item.metadata ?? undefined) as
                  | Prisma.InputJsonValue
                  | undefined,
              },
            });
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { consumed: true, periodKey };
    } catch (error) {
      if (!isQuotaSerializationConflict(error) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}

export class BatchQuotaAuthorizationError extends Error {
  constructor(message = "批次额度授权状态已变化，请刷新后重试") {
    super(message);
    this.name = "BatchQuotaAuthorizationError";
  }
}

function isQuotaSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

/**
 * 计量写入统一走 Serializable + SSI 冲突退避重试（与授权 / 补偿同一写法）。
 * 按条返还与重试补扣都用它：检查、标记 CAS、计量与流水必须同一个事务提交。
 */
export async function runSerializableQuotaTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isQuotaSerializationConflict(error) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}

/**
 * 在调用方的 Serializable 事务里按套餐上限检查并计量（口径与
 * assertQuotaBatchForSession 一致：先全部检查，再逐项 upsert + 正数 UsageLog）。
 * 超额抛 QuotaExceededError，调用方事务随之整体回滚。
 */
export async function chargeMetersInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    plan: QuotaPlanId;
    periodKey: string;
    items: Array<{
      resource: UsageResource;
      amount: number;
      metadata?: Record<string, unknown>;
    }>;
  },
): Promise<void> {
  for (const item of params.items) {
    const limit = getLimitForResource(params.plan, item.resource);
    const existing = await tx.userUsagePeriod.findUnique({
      where: {
        userId_periodKey_resource: {
          userId: params.userId,
          periodKey: params.periodKey,
          resource: item.resource,
        },
      },
    });
    const used = existing?.amount ?? 0;
    if (used + item.amount > limit) {
      throw new QuotaExceededError({
        resource: item.resource,
        used,
        limit,
        periodKey: params.periodKey,
      });
    }
  }
  for (const item of params.items) {
    await tx.userUsagePeriod.upsert({
      where: {
        userId_periodKey_resource: {
          userId: params.userId,
          periodKey: params.periodKey,
          resource: item.resource,
        },
      },
      create: {
        userId: params.userId,
        periodKey: params.periodKey,
        resource: item.resource,
        amount: item.amount,
      },
      update: { amount: { increment: item.amount } },
    });
    await tx.usageLog.create({
      data: {
        userId: params.userId,
        resource: item.resource,
        amount: item.amount,
        metadata: (item.metadata ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
      },
    });
  }
}

export class DirectDispatchQuotaCompensationError extends Error {
  constructor(message = "direct dispatch quota compensation evidence is unsafe") {
    super(message);
    this.name = "DirectDispatchQuotaCompensationError";
  }
}

export interface DirectDispatchQuotaCompensationInput {
  requestId: string;
  userId: string;
  briefIds: string[];
  videoDispatchAmount: number;
  seedanceSegmentAmount: number;
  periodKey: string;
  quotaWasMetered: boolean;
  reason: string;
  responseStatus: number;
  /**
   * 返还证据（缺省 all_jobs_rejected）：
   * - all_jobs_rejected：每个任务都被供应商明确拒绝且未创建（既有分支）；
   * - zero_jobs：扣费后派发途中抛异常，由故事板证明本请求没有留下任何任务行
   *   （brief 事务回滚 → 预留仍在；或 brief 已挂上故事板但一条 VideoJob 都没有）。
   *   任务行总是先落库再调供应商，零任务行 = 零外呼。
   */
  evidence?: "all_jobs_rejected" | "zero_jobs";
  /** zero_jobs 必填：本请求预留 / 挂载的故事板（单条派发一次只挂一块故事板） */
  storyboardRunId?: string;
}

type DirectDispatchFailureStage =
  | "preflight"
  | "transport"
  | "provider_response";

function directDispatchFailureStage(
  value: string | null,
): DirectDispatchFailureStage | null {
  const match = /^definitely_not_created:(preflight|transport|provider_response)$/.exec(
    value ?? "",
  );
  return (match?.[1] as DirectDispatchFailureStage | undefined) ?? null;
}

/**
 * Refunds a direct dispatch only when database evidence proves that every job
 * created by this request was rejected before the provider created a billable
 * job. The request marker is the compensation CAS: once it is cleared, a
 * replay cannot decrement the meters or append negative ledger rows again.
 *
 * Quota-exempt requests still clear the ownership marker after the same strict
 * evidence check, but deliberately do not invent meter or UsageLog activity.
 *
 * 返还时同一事务给涉及的 brief 打 `quotaRefundedAt`（CAS：必须全部尚未返还），
 * 与清扫器里的按条对账互斥——同一条 brief 绝不会被返还两次。
 */
export async function compensateDirectDispatchQuota(
  params: DirectDispatchQuotaCompensationInput,
): Promise<{ compensated: boolean; replayed: boolean }> {
  const evidence = params.evidence ?? "all_jobs_rejected";
  const uniqueBriefIds = [...new Set(params.briefIds)];
  const reason = params.reason.trim();
  const storyboardRunId = params.storyboardRunId?.trim() ?? "";
  const evidenceInputValid =
    evidence === "zero_jobs"
      ? // 零任务证据的 brief 由故事板反查，调用方不得自报；单条派发一次只出 1 支。
        uniqueBriefIds.length === 0 &&
        params.videoDispatchAmount === 1 &&
        storyboardRunId.length > 0
      : uniqueBriefIds.length === params.briefIds.length &&
        uniqueBriefIds.length === params.videoDispatchAmount;
  if (
    !params.requestId ||
    !params.userId ||
    !evidenceInputValid ||
    !Number.isInteger(params.videoDispatchAmount) ||
    params.videoDispatchAmount <= 0 ||
    !Number.isInteger(params.seedanceSegmentAmount) ||
    params.seedanceSegmentAmount <= 0 ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(params.periodKey) ||
    !reason ||
    !Number.isInteger(params.responseStatus) ||
    params.responseStatus < 100 ||
    params.responseStatus > 599
  ) {
    throw new DirectDispatchQuotaCompensationError(
      "direct dispatch compensation input is invalid",
    );
  }

  const httpClass = `${Math.floor(params.responseStatus / 100)}xx`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const request = await tx.videoDispatchRequest.findFirst({
            where: { id: params.requestId, userId: params.userId },
            select: { state: true, quotaConsumedAt: true },
          });
          if (!request) {
            throw new DirectDispatchQuotaCompensationError(
              "dispatch request does not exist or is not owned by the user",
            );
          }
          if (!request.quotaConsumedAt) {
            return { compensated: false, replayed: true };
          }
          if (request.state !== VideoDispatchRequestState.PROCESSING) {
            throw new DirectDispatchQuotaCompensationError(
              "dispatch request is no longer processing",
            );
          }

          /// 证据成立后要打返还标记的 brief（零任务且 brief 事务已回滚时为空）
          let briefIdsToStamp: string[];
          let failureStages: Array<DirectDispatchFailureStage | null>;
          if (evidence === "zero_jobs") {
            const run = await tx.storyboardRun.findFirst({
              where: { id: storyboardRunId, userId: params.userId },
              select: { videoBriefId: true, dispatchReservationKey: true },
            });
            if (!run) {
              throw new DirectDispatchQuotaCompensationError(
                "dispatch storyboard does not exist or is not owned by the user",
              );
            }
            if (run.videoBriefId == null) {
              /// brief 与故事板挂载在同一事务：预留仍归本请求、故事板没挂上任何 brief，
              /// 就证明本请求一条 brief / 任务都没有落库。
              if (run.dispatchReservationKey !== params.requestId) {
                throw new DirectDispatchQuotaCompensationError(
                  "storyboard reservation is not held by this dispatch request",
                );
              }
              briefIdsToStamp = [];
            } else {
              /// 预留只允许本请求挂载，所以挂上的 brief 必是本请求建的；
              /// 它名下一条 VideoJob 都没有 = 从未调用供应商。
              const ownedBriefs = await tx.videoBrief.findMany({
                where: {
                  id: run.videoBriefId,
                  contentAngle: {
                    round: { deliveryOrder: { createdById: params.userId } },
                  },
                },
                select: { id: true },
              });
              if (ownedBriefs.length !== 1) {
                throw new DirectDispatchQuotaCompensationError(
                  "dispatch brief is missing or not owned by the user",
                );
              }
              const jobCount = await tx.videoJob.count({
                where: { videoBriefId: run.videoBriefId },
              });
              if (jobCount !== 0) {
                throw new DirectDispatchQuotaCompensationError(
                  "dispatch brief already has video jobs",
                );
              }
              briefIdsToStamp = [run.videoBriefId];
            }
            failureStages = [];
          } else {
            const ownedBriefs = await tx.videoBrief.findMany({
              where: {
                id: { in: uniqueBriefIds },
                contentAngle: {
                  round: { deliveryOrder: { createdById: params.userId } },
                },
              },
              select: { id: true },
            });
            if (ownedBriefs.length !== uniqueBriefIds.length) {
              throw new DirectDispatchQuotaCompensationError(
                "dispatch briefs are missing or not owned by the user",
              );
            }

            const jobs = await tx.videoJob.findMany({
              where: { videoBriefId: { in: uniqueBriefIds } },
              select: {
                id: true,
                videoBriefId: true,
                status: true,
                submissionState: true,
                submissionErrorClass: true,
                externalJobId: true,
              },
            });
            const representedBriefIds = new Set(
              jobs.map((job) => job.videoBriefId).filter(Boolean),
            );
            failureStages = jobs.map((job) =>
              directDispatchFailureStage(job.submissionErrorClass),
            );
            const evidenceIsSafe =
              jobs.length === params.seedanceSegmentAmount &&
              representedBriefIds.size === uniqueBriefIds.length &&
              jobs.every(
                (job) =>
                  job.status === VideoJobStatus.FAILED &&
                  job.submissionState === ProviderSubmissionState.REJECTED &&
                  job.externalJobId == null,
              ) &&
              failureStages.every((stage) => stage !== null);
            if (!evidenceIsSafe) {
              throw new DirectDispatchQuotaCompensationError(
                "not every dispatch job is definitely-not-created and unacknowledged",
              );
            }
            briefIdsToStamp = uniqueBriefIds;
          }

          const marker = await tx.videoDispatchRequest.updateMany({
            where: {
              id: params.requestId,
              userId: params.userId,
              state: VideoDispatchRequestState.PROCESSING,
              quotaConsumedAt: { not: null },
            },
            data: { quotaConsumedAt: null },
          });
          if (marker.count !== 1) {
            throw new DirectDispatchQuotaCompensationError(
              "quota compensation marker CAS failed",
            );
          }

          if (briefIdsToStamp.length > 0) {
            /// 与清扫器的按条对账互斥：任一 brief 已被返还就整体失败关闭，绝不二次返还。
            const stamped = await tx.videoBrief.updateMany({
              where: { id: { in: briefIdsToStamp }, quotaRefundedAt: null },
              data: { quotaRefundedAt: new Date() },
            });
            if (stamped.count !== briefIdsToStamp.length) {
              throw new DirectDispatchQuotaCompensationError(
                "dispatch brief was already refunded",
              );
            }
          }

          if (params.quotaWasMetered) {
            const distinctFailureStages = [
              ...new Set(
                failureStages.filter(
                  (stage): stage is DirectDispatchFailureStage => stage !== null,
                ),
              ),
            ];
            const providerRequestSent = distinctFailureStages.includes(
              "provider_response",
            );
            const items: Array<{ resource: UsageResource; amount: number }> = [
              {
                resource: "VIDEO_DISPATCH",
                amount: params.videoDispatchAmount,
              },
              {
                resource: "SEEDANCE_SEGMENT",
                amount: params.seedanceSegmentAmount,
              },
            ];
            for (const item of items) {
              const meter = await tx.userUsagePeriod.updateMany({
                where: {
                  userId: params.userId,
                  periodKey: params.periodKey,
                  resource: item.resource,
                  amount: { gte: item.amount },
                },
                data: { amount: { decrement: item.amount } },
              });
              if (meter.count !== 1) {
                throw new DirectDispatchQuotaCompensationError(
                  `quota meter cannot compensate ${item.resource}`,
                );
              }
              await tx.usageLog.create({
                data: {
                  userId: params.userId,
                  resource: item.resource,
                  amount: -item.amount,
                  metadata: {
                    requestId: params.requestId,
                    reason,
                    providerCallMade: providerRequestSent,
                    providerRequestSent,
                    providerAccepted: false,
                    providerJobCreated: false,
                    failureStages: distinctFailureStages,
                    customerResponseClass: httpClass,
                    customerResponseStatus: params.responseStatus,
                    phase: "direct_dispatch_compensation",
                    /// 两种证据都点名本次打了返还标记的 brief：brief 与请求之间没有外键，
                    /// 重试补扣（rechargeRefundedBriefForSession）靠它把 brief 认回这笔
                    /// 请求的扣费与补偿；只靠时间窗口认领，并发请求会判 ambiguous、免费重跑。
                    evidence,
                    briefIds: briefIdsToStamp,
                  },
                },
              });
            }
          }

          return { compensated: true, replayed: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isQuotaSerializationConflict(error) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}

/**
 * Atomically authorizes a newly expanded batch and consumes its monthly
 * entitlement exactly once. Until this commits the BatchJob remains
 * EXPANDING and processBatchTick refuses every provider submission.
 */
export async function authorizeBatchQuotaForSession(
  session: Session,
  batchId: string,
): Promise<{ authorized: true; replayed: boolean }> {
  const userId = session.user.id;
  const enforce = isQuotaEnforced() && !isQuotaExemptSession(session);
  const plan = enforce ? await resolveQuotaPlan(userId) : null;
  const periodKey = currentUsagePeriodKey();

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const batch = await tx.batchJob.findFirst({
            where: { id: batchId, userId },
          });
          if (!batch) {
            throw new BatchQuotaAuthorizationError("批次不存在或无权访问");
          }
          if (batch.quotaConsumedAt) {
            return { authorized: true as const, replayed: true };
          }

          const items: Array<{ resource: UsageResource; amount: number }> = [
            { resource: "VIDEO_DISPATCH", amount: batch.requestedCount },
            { resource: "SEEDANCE_SEGMENT", amount: batch.requestedCount },
          ];
          if (enforce && plan) {
            for (const item of items) {
              const limit = getLimitForResource(plan, item.resource);
              const existing = await tx.userUsagePeriod.findUnique({
                where: {
                  userId_periodKey_resource: {
                    userId,
                    periodKey,
                    resource: item.resource,
                  },
                },
              });
              const used = existing?.amount ?? 0;
              if (used + item.amount > limit) {
                throw new QuotaExceededError({
                  resource: item.resource,
                  used,
                  limit,
                  periodKey,
                });
              }
            }
          }

          const activated = await tx.batchJob.updateMany({
            where: {
              id: batchId,
              userId,
              status: BatchJobStatus.EXPANDING,
              quotaConsumedAt: null,
            },
            data: {
              status: BatchJobStatus.RUNNING,
              quotaConsumedAt: new Date(),
              statusReason: "额度已确认，批次进入生成队列",
            },
          });
          if (activated.count !== 1) {
            const replay = await tx.batchJob.findFirst({
              where: { id: batchId, userId },
              select: { quotaConsumedAt: true },
            });
            if (replay?.quotaConsumedAt) {
              return { authorized: true as const, replayed: true };
            }
            throw new BatchQuotaAuthorizationError();
          }

          if (enforce) {
            for (const item of items) {
              await tx.userUsagePeriod.upsert({
                where: {
                  userId_periodKey_resource: {
                    userId,
                    periodKey,
                    resource: item.resource,
                  },
                },
                create: {
                  userId,
                  periodKey,
                  resource: item.resource,
                  amount: item.amount,
                },
                update: { amount: { increment: item.amount } },
              });
              await tx.usageLog.create({
                data: {
                  userId,
                  resource: item.resource,
                  amount: item.amount,
                  metadata: { batchId, phase: "batch_authorization" },
                },
              });
            }
          }
          return { authorized: true as const, replayed: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isQuotaSerializationConflict(error) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}

/**
 * 注册限流：IP 每小时 + 邮箱每天（成功注册前只计 IP）。
 */
export async function assertRegisterRateLimit(params: {
  ip: string | null;
  email: string;
}): Promise<void> {
  if (!isQuotaEnforced() && process.env.NODE_ENV !== "production") {
    return;
  }

  const ip = params.ip?.trim() || "unknown";
  const email = params.email.trim().toLowerCase();

  await bumpRateLimit(`register:ip:${ip}`, hourlyWindowKey(), REGISTER_RATE_LIMIT.perIpPerHour);
  await bumpRateLimit(
    `register:email:${email}`,
    dailyWindowKey(),
    REGISTER_RATE_LIMIT.perEmailPerDay,
  );
}

/**
 * Per-account protection for authenticated, provider-billed actions.
 * This is deliberately separate from monthly plan quotas: it prevents a
 * browser loop or duplicated client request from causing an abrupt spend
 * spike without inventing a new commercial entitlement.
 */
export async function assertAuthenticatedActionRateLimit(params: {
  action: "product-image";
  userId: string;
  maxPerHour?: number;
}): Promise<void> {
  if (!isQuotaEnforced() && process.env.NODE_ENV !== "production") return;

  const configured = Number.parseInt(
    process.env.PRODUCT_IMAGE_RATE_LIMIT_PER_HOUR ?? "5",
    10,
  );
  const fallback = Number.isFinite(configured) ? configured : 5;
  const max = Math.max(1, Math.min(params.maxPerHour ?? fallback, 100));
  await bumpRateLimit(
    `${params.action}:user:${params.userId}`,
    hourlyWindowKey(),
    max,
    "图片生成操作过于频繁，请一小时后再试。",
  );
}

function userMessageForQuota(resource: UsageResource): string {
  switch (resource) {
    case "VIDEO_DISPATCH":
      return "本月视频生成次数已用完。可在「用量与账单」查看额度，或下月再试。";
    case "PLAN_PREVIEW":
      return "本月方案预览次数已用完，请稍后再试或精简描述后直接生成。";
    case "BLOB_UPLOAD_BYTES":
      return "本月素材上传流量已达上限，请压缩文件或下月再试。";
    case "SEEDANCE_SEGMENT":
      return "本月 AI 画面生成额度已用完，请下月再试或联系客服。";
    case "DIGITAL_HUMAN_AD":
      return "本月数字人探店广告生成次数已用完，请下月再试或升级套餐。";
    default:
      return "本月用量已达上限，请稍后再试。";
  }
}

export const __test__ = {
  currentUsagePeriodKey,
  hourlyWindowKey,
  dailyWindowKey,
  isQuotaEnforced,
  isQuotaExemptSession,
};
