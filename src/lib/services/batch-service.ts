import { randomUUID } from "node:crypto";
import {
  BatchJobStatus,
  Prisma,
  StyleTemplateStatus,
  VideoJobStatus,
  VideoProvider,
  type BatchJob,
  type StyleTemplate,
  type VideoJob,
} from "@prisma/client";
import { db } from "@/lib/db";
import { getAppEnv } from "@/lib/config/env";
import {
  allocateAssets,
  type AllocatableAsset,
  type AssetAssignment,
} from "@/lib/video-generation/asset-allocator";
import {
  renderBatchTemplatePrompt,
  type BatchStyleImagesPerVideo,
  type BatchStyleLockedParams,
} from "@/lib/video-generation/batch-style-templates";
import {
  createVideoProviderById,
  getVideoProvider,
} from "@/lib/video-generation/providers";
import {
  evaluateDispatchBreaker,
  type BreakerDecision,
} from "./dispatch-breaker";
import { reconcileVideoJob } from "./video-service";
import {
  logStatusTransition,
  videoJobDeadlineMin,
} from "./video-watchdog";

const MAX_SUBMIT_ATTEMPTS = 3;
const LEASE_MS = 60_000;
const PROVIDER_FAILURE_PREFIX = "[provider:failed]";
const SERIALIZABLE_RETRY_LIMIT = 3;

function isSerializableConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  const message = error instanceof Error ? error.message : String(error);
  return /write conflict|deadlock/i.test(message);
}

async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  retryLimit = SERIALIZABLE_RETRY_LIMIT,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableConflict(error) || attempt >= retryLimit) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}

function providerConcurrency(): number {
  return Math.max(1, Math.floor(Number(process.env.PROVIDER_CONCURRENCY ?? "10")));
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parseLockedParams(value: Prisma.JsonValue): BatchStyleLockedParams {
  const parsed = value as unknown as BatchStyleLockedParams;
  if (
    !parsed ||
    ![5, 10, 15].includes(parsed.duration) ||
    !["9:16", "16:9", "1:1"].includes(parsed.aspectRatio) ||
    !["720p", "1080p"].includes(parsed.resolution)
  ) {
    throw new Error("模板 lockedParams 数据不合法");
  }
  return parsed;
}

function parseImagesPerVideo(value: Prisma.JsonValue): BatchStyleImagesPerVideo {
  const parsed = value as unknown as BatchStyleImagesPerVideo;
  if (
    !parsed ||
    !Number.isInteger(parsed.min) ||
    !Number.isInteger(parsed.max) ||
    parsed.min < 1 ||
    parsed.min > parsed.max
  ) {
    throw new Error("模板 imagesPerVideo 数据不合法");
  }
  return parsed;
}

export interface CreateBatchInput {
  userId: string;
  templateId: string;
  templateVersion: number;
  images: AllocatableAsset[];
  requestedCount: number;
  productName?: string | null;
  idempotencyKey: string;
}

function templateSnapshot(template: StyleTemplate): Prisma.InputJsonValue {
  return json({
    id: template.id,
    slug: template.slug,
    version: template.version,
    name: template.name,
    nameZh: template.nameZh,
    category: template.category,
    promptSkeleton: template.promptSkeleton,
    negativePrompt: template.negativePrompt,
    lockedParams: template.lockedParams,
    imagesPerVideo: template.imagesPerVideo,
  });
}

export function buildBatchVideoRows(args: {
  batchId: string;
  template: StyleTemplate;
  images: AllocatableAsset[];
  requestedCount: number;
  productName?: string | null;
  provider: VideoProvider;
}): Prisma.VideoJobCreateManyInput[] {
  const assignments = allocateAssets({
    batchId: args.batchId,
    images: args.images,
    count: args.requestedCount,
    templateId: `${args.template.id}@${args.template.version}`,
    imagesPerVideo: parseImagesPerVideo(args.template.imagesPerVideo),
  });
  const snapshot = templateSnapshot(args.template);

  return assignments.map((assignment) => ({
    batchJobId: args.batchId,
    batchIndex: assignment.index,
    batchItemKey: `${args.batchId}:${assignment.index}`,
    provider: args.provider,
    status: VideoJobStatus.QUEUED,
    assignedAssets: json(assignment),
    templateSnapshot: snapshot,
    promptText: renderBatchTemplatePrompt({
      promptSkeleton: args.template.promptSkeleton,
      imageUrls: assignment.assets.map((asset) => asset.url),
      productName: args.productName,
    }),
    negativePrompt: args.template.negativePrompt,
    seed: assignment.seed,
    availableAt: new Date(),
  }));
}

/**
 * INV-B4：BatchJob + N 个 VideoJob 在同一事务内原子展开。
 * userId+idempotencyKey 唯一约束处理并发重复请求；冲突时返回首个批次。
 */
export async function createBatchJob(input: CreateBatchInput): Promise<BatchJob> {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) {
    throw new Error("idempotencyKey 必须是 1-200 字符");
  }
  const existing = await db.batchJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  const template = await db.styleTemplate.findFirst({
    where: {
      id: input.templateId,
      version: input.templateVersion,
      status: StyleTemplateStatus.ACTIVE,
    },
  });
  if (!template) throw new Error("指定的 ACTIVE 模板版本不存在");
  const locked = parseLockedParams(template.lockedParams);
  const provider =
    getAppEnv().videoProvider === "mock"
      ? VideoProvider.MOCK
      : VideoProvider.SEEDANCE_I2V;

  try {
    return await db.$transaction(async (tx) => {
      const raced = await tx.batchJob.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (raced) return raced;

      const batch = await tx.batchJob.create({
        data: {
          userId: input.userId,
          templateId: template.id,
          templateVersion: template.version,
          imageIds: input.images.map((image) => image.id),
          imageUrls: input.images.map((image) => image.url),
          productName: input.productName?.trim() || null,
          requestedCount: input.requestedCount,
          idempotencyKey: input.idempotencyKey,
          status: BatchJobStatus.EXPANDING,
        },
      });
      const rows = buildBatchVideoRows({
        batchId: batch.id,
        template,
        images: input.images,
        requestedCount: input.requestedCount,
        productName: input.productName,
        provider,
      });
      await tx.videoJob.createMany({ data: rows });
      return tx.batchJob.update({
        where: { id: batch.id },
        data: {
          status: BatchJobStatus.RUNNING,
          queuedCount: rows.length,
          statusReason: `已按模板 ${template.slug}@${template.version} 原子展开；${locked.duration}s ${locked.aspectRatio}`,
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await db.batchJob.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

type StatusCount = { status: VideoJobStatus; _count: { _all: number } };

export function deriveBatchStatus(args: {
  requestedCount: number;
  counts: Partial<Record<VideoJobStatus, number>>;
}): BatchJobStatus {
  const queued = args.counts.QUEUED ?? 0;
  const paused = args.counts.PAUSED ?? 0;
  const running = args.counts.RUNNING ?? 0;
  const completed = args.counts.SUCCEEDED ?? 0;
  const failed = args.counts.FAILED ?? 0;
  const cancelled = args.counts.CANCELLED ?? 0;
  if (paused > 0) return BatchJobStatus.PAUSED;
  if (queued + running > 0) return BatchJobStatus.RUNNING;
  if (completed === args.requestedCount) return BatchJobStatus.COMPLETED;
  if (cancelled === args.requestedCount) return BatchJobStatus.CANCELLED;
  if (completed > 0 && failed + cancelled > 0) {
    return BatchJobStatus.PARTIAL_FAILED;
  }
  if (failed > 0) return BatchJobStatus.FAILED;
  return BatchJobStatus.RUNNING;
}

export function isTerminalBatchStatus(status: BatchJobStatus): boolean {
  return (
    status === BatchJobStatus.COMPLETED ||
    status === BatchJobStatus.PARTIAL_FAILED ||
    status === BatchJobStatus.FAILED ||
    status === BatchJobStatus.CANCELLED
  );
}

export async function syncBatchCounts(batchId: string): Promise<BatchJob> {
  const [batch, grouped] = await Promise.all([
    db.batchJob.findUnique({ where: { id: batchId } }),
    db.videoJob.groupBy({
      by: ["status"],
      where: { batchJobId: batchId },
      _count: { _all: true },
    }),
  ]);
  if (!batch) throw new Error("BatchJob 不存在");
  const counts: Partial<Record<VideoJobStatus, number>> = {};
  for (const row of grouped as StatusCount[]) {
    counts[row.status] = row._count._all;
  }
  const status = deriveBatchStatus({
    requestedCount: batch.requestedCount,
    counts,
  });
  const terminal = isTerminalBatchStatus(status);
  return db.batchJob.update({
    where: { id: batchId },
    data: {
      status,
      queuedCount: counts.QUEUED ?? 0,
      pausedCount: counts.PAUSED ?? 0,
      runningCount: counts.RUNNING ?? 0,
      completedCount: counts.SUCCEEDED ?? 0,
      failedCount: counts.FAILED ?? 0,
      cancelledCount: counts.CANCELLED ?? 0,
      finishedAt: terminal ? batch.finishedAt ?? new Date() : null,
    },
  });
}

async function recoverExpiredLeases(batchId: string, now: Date): Promise<number> {
  const expired = await db.videoJob.findMany({
    where: {
      batchJobId: batchId,
      status: VideoJobStatus.RUNNING,
      externalJobId: null,
      leaseExpiresAt: { lt: now },
    },
    select: { id: true },
  });
  let recovered = 0;
  for (const job of expired) {
    const result = await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.RUNNING,
        externalJobId: null,
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: VideoJobStatus.QUEUED,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        availableAt: now,
      },
    });
    if (result.count > 0) {
      recovered++;
      logStatusTransition({
        taskId: job.id,
        from: VideoJobStatus.RUNNING,
        to: VideoJobStatus.QUEUED,
        reason: "batch_lease_expired_requeue",
      });
    }
  }
  return recovered;
}

async function claimJobs(args: {
  batchId: string;
  maxClaims: number;
  now: Date;
}): Promise<Array<VideoJob & { claimOwner: string }>> {
  if (args.maxClaims <= 0) return [];
  const owner = randomUUID();
  return withSerializableRetry(() =>
    db.$transaction(
      async (tx) => {
        const batchProvider = await tx.videoJob.findFirst({
          where: { batchJobId: args.batchId },
          select: { provider: true },
        });
        if (!batchProvider) return [];
        // active provider jobs（已提交 + 正在提交）共同占用并发槽。
        const active = await tx.videoJob.count({
          where: {
            status: VideoJobStatus.RUNNING,
            provider: batchProvider.provider,
          },
        });
        const slots = Math.max(
          0,
          Math.min(args.maxClaims, providerConcurrency() - active),
        );
        if (slots === 0) return [];
        const candidates = await tx.videoJob.findMany({
          where: {
            batchJobId: args.batchId,
            status: VideoJobStatus.QUEUED,
            OR: [{ availableAt: null }, { availableAt: { lte: args.now } }],
          },
          orderBy: { batchIndex: "asc" },
          take: slots,
        });
        const claimed: Array<VideoJob & { claimOwner: string }> = [];
        for (const job of candidates) {
          const result = await tx.videoJob.updateMany({
            where: { id: job.id, status: VideoJobStatus.QUEUED },
            data: {
              status: VideoJobStatus.RUNNING,
              leaseOwner: owner,
              leaseExpiresAt: new Date(args.now.getTime() + LEASE_MS),
              heartbeatAt: args.now,
              timeoutAt: new Date(
                args.now.getTime() + videoJobDeadlineMin() * 60_000,
              ),
            },
          });
          if (result.count > 0) claimed.push({ ...job, claimOwner: owner });
        }
        return claimed;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

function assignmentFromJob(job: VideoJob): AssetAssignment {
  return job.assignedAssets as unknown as AssetAssignment;
}

async function submitClaimedJob(
  job: VideoJob & { claimOwner: string },
): Promise<void> {
  const assignment = assignmentFromJob(job);
  const snapshot = job.templateSnapshot as unknown as {
    lockedParams: BatchStyleLockedParams;
  };
  const provider =
    job.provider === VideoProvider.MOCK
      ? createVideoProviderById("mock")
      : getVideoProvider();
  const now = new Date();
  try {
    const created = await provider.createVideoJob({
      prompt: job.promptText ?? "",
      negativePrompt: job.negativePrompt ?? undefined,
      referenceImages: assignment.assets.map((asset) => ({
        url: asset.url,
        role: "content",
      })),
      durationSec: snapshot.lockedParams.duration,
      aspectRatio: snapshot.lockedParams.aspectRatio,
      resolution: snapshot.lockedParams.resolution,
      seed: job.seed ?? assignment.seed,
      mockHints: {
        briefId: job.batchJobId ?? "batch",
        segmentIndex: job.batchIndex ?? 0,
        segmentCount: 1,
        durationSec: snapshot.lockedParams.duration,
        aspectRatio: snapshot.lockedParams.aspectRatio,
        purpose: "batch-template",
        retryAttempt: job.retryCount,
      },
    });
    const updated = await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.RUNNING,
        leaseOwner: job.claimOwner,
      },
      data: {
        externalJobId: created.providerJobId,
        submittedAt: now,
        startedAt: now,
        lastProviderStatus: "queued",
        submitAttempts: { increment: 1 },
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
      },
    });
    if (updated.count > 0) {
      logStatusTransition({
        taskId: job.id,
        from: VideoJobStatus.QUEUED,
        to: VideoJobStatus.RUNNING,
        reason: `batch_provider_submitted (${created.providerId})`,
      });
    }
  } catch (error) {
    const attempts = job.submitAttempts + 1;
    const terminal = attempts >= MAX_SUBMIT_ATTEMPTS;
    const nextStatus = terminal
      ? VideoJobStatus.FAILED
      : VideoJobStatus.QUEUED;
    const delayMs = Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
    await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.RUNNING,
        leaseOwner: job.claimOwner,
      },
      data: {
        status: nextStatus,
        submitAttempts: attempts,
        availableAt: terminal ? null : new Date(Date.now() + delayMs),
        errorMessage: terminal
          ? `${PROVIDER_FAILURE_PREFIX} 提交失败: ${(error as Error).message}`
          : `批量提交暂时失败，将退避重试: ${(error as Error).message}`,
        userSafeError: terminal ? "视频提交失败，请点击重试。" : null,
        finishedAt: terminal ? new Date() : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    logStatusTransition({
      taskId: job.id,
      from: VideoJobStatus.RUNNING,
      to: nextStatus,
      reason: terminal
        ? "batch_submit_failed_exhausted"
        : `batch_submit_backoff_attempt_${attempts}`,
    });
  }
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await fn(items[index]);
      }
    }),
  );
}

async function reconcileRunningBatchJobs(batchId: string): Promise<void> {
  const running = await db.videoJob.findMany({
    where: {
      batchJobId: batchId,
      status: VideoJobStatus.RUNNING,
      externalJobId: { not: null },
    },
    orderBy: { batchIndex: "asc" },
  });
  await mapConcurrent(running, providerConcurrency(), async (job) => {
    await reconcileVideoJob(job.id);
  });
}

async function applyBreaker(
  batchId: string,
  decision: BreakerDecision,
): Promise<void> {
  if (decision.state === "open") {
    await db.$transaction([
      db.videoJob.updateMany({
        where: { batchJobId: batchId, status: VideoJobStatus.QUEUED },
        data: { status: VideoJobStatus.PAUSED },
      }),
      db.batchJob.update({
        where: { id: batchId },
        data: {
          status: BatchJobStatus.PAUSED,
          breakerPausedAt: new Date(),
          statusReason: decision.reason,
        },
      }),
    ]);
    return;
  }
  await db.videoJob.updateMany({
    where: { batchJobId: batchId, status: VideoJobStatus.PAUSED },
    data: { status: VideoJobStatus.QUEUED, availableAt: new Date() },
  });
  await db.batchJob.updateMany({
    where: { id: batchId, status: BatchJobStatus.PAUSED },
    data: {
      status: BatchJobStatus.RUNNING,
      breakerPausedAt: null,
      statusReason:
        decision.state === "half_open_probe"
          ? "熔断半开：放行 1 条探测任务"
          : "生成服务恢复，自动续跑",
    },
  });
}

/**
 * 单个 worker tick：回收租约 → 批量调和 → 熔断联动 → 按全局并发槽提交。
 * 前端只调用 batch status 端点一次；不会为 N 个任务建立 N 条连接。
 */
export async function processBatchTick(batchId: string): Promise<BatchJob> {
  const now = new Date();
  const batch = await db.batchJob.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("BatchJob 不存在");
  if (isTerminalBatchStatus(batch.status)) {
    return batch;
  }

  await recoverExpiredLeases(batchId, now);
  await reconcileRunningBatchJobs(batchId);
  await syncBatchCounts(batchId);

  const breaker = await evaluateDispatchBreaker(now);
  await applyBreaker(batchId, breaker);
  if (breaker.state === "open") return syncBatchCounts(batchId);

  const maxClaims =
    breaker.state === "half_open_probe" ? 1 : providerConcurrency();
  const claimed = await claimJobs({ batchId, maxClaims, now });
  await mapConcurrent(claimed, providerConcurrency(), submitClaimedJob);
  return syncBatchCounts(batchId);
}

export async function retryFailedBatchJobs(batchId: string): Promise<number> {
  const failed = await db.videoJob.findMany({
    where: { batchJobId: batchId, status: VideoJobStatus.FAILED },
    select: { id: true },
  });
  let reset = 0;
  for (const job of failed) {
    const result = await db.videoJob.updateMany({
      where: { id: job.id, status: VideoJobStatus.FAILED },
      data: {
        status: VideoJobStatus.QUEUED,
        externalJobId: null,
        errorMessage: null,
        userSafeError: null,
        finishedAt: null,
        submittedAt: null,
        startedAt: null,
        lastCheckedAt: null,
        lastProviderStatus: null,
        lastProgress: null,
        timeoutAt: null,
        pollErrors: 0,
        submitAttempts: 0,
        retryCount: { increment: 1 },
        availableAt: new Date(),
      },
    });
    if (result.count > 0) {
      reset++;
      logStatusTransition({
        taskId: job.id,
        from: VideoJobStatus.FAILED,
        to: VideoJobStatus.QUEUED,
        reason: "batch_retry_preserve_assignment_and_template",
      });
    }
  }
  if (reset > 0) {
    await db.batchJob.update({
      where: { id: batchId },
      data: {
        status: BatchJobStatus.RUNNING,
        finishedAt: null,
        statusReason: `重试 ${reset} 条失败任务（复用原素材与模板版本）`,
      },
    });
  }
  await syncBatchCounts(batchId);
  return reset;
}

export async function retryFailedBatchJob(
  batchId: string,
  jobId: string,
): Promise<boolean> {
  const result = await db.videoJob.updateMany({
    where: {
      id: jobId,
      batchJobId: batchId,
      status: VideoJobStatus.FAILED,
    },
    data: {
      status: VideoJobStatus.QUEUED,
      externalJobId: null,
      errorMessage: null,
      userSafeError: null,
      finishedAt: null,
      submittedAt: null,
      startedAt: null,
      lastCheckedAt: null,
      lastProviderStatus: null,
      lastProgress: null,
      timeoutAt: null,
      pollErrors: 0,
      submitAttempts: 0,
      retryCount: { increment: 1 },
      availableAt: new Date(),
    },
  });
  if (result.count === 0) return false;
  logStatusTransition({
    taskId: jobId,
    from: VideoJobStatus.FAILED,
    to: VideoJobStatus.QUEUED,
    reason: "batch_single_retry_preserve_assignment_and_template",
  });
  await db.batchJob.update({
    where: { id: batchId },
    data: {
      status: BatchJobStatus.RUNNING,
      finishedAt: null,
      statusReason: "已重试 1 条失败任务（复用原素材与模板版本）",
    },
  });
  await syncBatchCounts(batchId);
  return true;
}

export async function cancelPendingBatchJobs(batchId: string): Promise<number> {
  const result = await db.videoJob.updateMany({
    where: {
      batchJobId: batchId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED] },
    },
    data: {
      status: VideoJobStatus.CANCELLED,
      finishedAt: new Date(),
      errorMessage: "用户取消未开始任务",
      userSafeError: "已取消",
    },
  });
  await syncBatchCounts(batchId);
  return result.count;
}

export async function getBatchStatus(batchId: string, userId?: string) {
  const batch = await db.batchJob.findFirst({
    where: { id: batchId, ...(userId ? { userId } : {}) },
    include: {
      template: {
        select: {
          id: true,
          version: true,
          name: true,
          nameZh: true,
          category: true,
          coverImage: true,
        },
      },
      videoJobs: {
        orderBy: { batchIndex: "asc" },
        select: {
          id: true,
          batchIndex: true,
          status: true,
          assignedAssets: true,
          outputVideoUrl: true,
          outputThumbUrl: true,
          lastProgress: true,
          errorMessage: true,
          userSafeError: true,
          retryCount: true,
          createdAt: true,
          submittedAt: true,
          finishedAt: true,
        },
      },
    },
  });
  if (!batch) throw new Error("BatchJob 不存在或无权访问");
  return batch;
}

export async function runBatchUntilTerminal(args: {
  batchId: string;
  timeoutMs?: number;
  tickMs?: number;
}): Promise<BatchJob> {
  const deadline = Date.now() + (args.timeoutMs ?? 10 * 60_000);
  while (Date.now() < deadline) {
    const batch = await processBatchTick(args.batchId);
    if (isTerminalBatchStatus(batch.status)) {
      return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, args.tickMs ?? 250));
  }
  throw new Error("等待 BatchJob 终态超时");
}

export const __test__ = {
  parseLockedParams,
  parseImagesPerVideo,
  providerConcurrency,
  mapConcurrent,
  recoverExpiredLeases,
  claimJobs,
  applyBreaker,
  isSerializableConflict,
  withSerializableRetry,
};
