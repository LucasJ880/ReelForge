import { randomUUID } from "node:crypto";
import {
  BatchJobStatus,
  Prisma,
  ProviderSubmissionState,
  StyleTemplateStatus,
  VideoJobStatus,
  VideoProvider,
  type BatchJob,
  type StyleTemplate,
  type VideoJob,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertMockVideoRuntimeAllowed,
  assertVideoGenerationRuntimeReady,
  videoGenerationRuntimeReadiness,
  VideoGenerationRuntimeUnavailableError,
} from "@/lib/config/env";
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
  createVideoProviderByRouteSnapshot,
} from "@/lib/video-generation/providers";
import type { VideoProvider as VideoProviderAdapter } from "@/lib/video-generation/providers/types";
import {
  asProviderSubmissionError,
  shouldAutomaticallyRetrySubmission,
} from "@/lib/video-generation/providers/submission-error";
import {
  evaluateDispatchBreaker,
  type BreakerDecision,
} from "./dispatch-breaker";
import { reconcileVideoJob } from "./video-service";
import {
  logStatusTransition,
  videoJobDeadlineMin,
  watchdogGraceMin,
} from "./video-watchdog";
import {
  callProviderWithHistoricalGuard,
  HISTORICAL_DISPATCH_CUTOFF,
  isHistoricalDispatchQuarantined,
  isRealVideoDispatchMode,
  QUARANTINE_RELEASED,
} from "./historical-dispatch-quarantine";
import { classifyCustomerGenerationError } from "@/lib/api/customer-generation-error";
import { hashVideoDispatchRequest } from "./video-dispatch-idempotency";
import {
  createVideoRouteSnapshot,
  readVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "@/lib/video-generation/video-route-registry";
import { selectVideoRouteSnapshot } from "@/lib/video-generation/video-route-selection";

const MAX_SUBMIT_ATTEMPTS = 3;
const LEASE_MS = 60_000;
const PROVIDER_FAILURE_PREFIX = "[provider:failed]";
const SERIALIZABLE_RETRY_LIMIT = 3;

export class BatchIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;

  constructor() {
    super("同一个 Idempotency-Key 已用于不同的批量生成请求");
    this.name = "BatchIdempotencyConflictError";
  }
}

export class BatchImageIdConflictError extends Error {
  readonly code = "BATCH_IMAGE_ID_CONFLICT" as const;
  readonly httpStatus = 409 as const;

  constructor() {
    super("批量生成素材的图片 ID 不得重复");
    this.name = "BatchImageIdConflictError";
  }
}

export class BatchInsufficientAssetsError extends Error {
  readonly code = "BATCH_INSUFFICIENT_ASSETS" as const;
  readonly httpStatus = 422 as const;

  constructor(
    readonly required: number,
    readonly actual: number,
  ) {
    super(`当前模板每条至少需要 ${required} 张图，实际只有 ${actual} 张`);
    this.name = "BatchInsufficientAssetsError";
  }
}

/**
 * Customer batch lookups intentionally collapse "missing" and "owned by a
 * different account" into the same error. Routes must never reveal whether a
 * guessed batch id belongs to another customer.
 */
export class BatchNotFoundError extends Error {
  constructor() {
    super("BatchJob 不存在或无权访问");
    this.name = "BatchNotFoundError";
  }
}

export class BatchTemplateUnavailableError extends Error {
  constructor() {
    super("指定的 ACTIVE 模板版本不存在");
    this.name = "BatchTemplateUnavailableError";
  }
}

export class BatchDispatchNotAuthorizedError extends Error {
  readonly code = "BATCH_DISPATCH_NOT_AUTHORIZED" as const;

  constructor() {
    super("批次尚未完成额度授权，禁止派发");
    this.name = "BatchDispatchNotAuthorizedError";
  }
}

let videoProviderFactoryOverride:
  | ((job: Pick<VideoJob, "provider">) => VideoProviderAdapter)
  | null = null;

function providerForJob(
  job: Pick<
    VideoJob,
    | "provider"
    | "videoRouteSnapshot"
    | "videoModelSnapshot"
    | "videoProviderAdapterSnapshot"
  >,
): VideoProviderAdapter {
  if (videoProviderFactoryOverride) return videoProviderFactoryOverride(job);
  const read = readVideoRouteSnapshot(job);
  if (read.state === "historical_unknown") {
    if (job.provider === VideoProvider.MOCK) {
      return createVideoProviderByRouteSnapshot(
        createVideoRouteSnapshot("mock"),
      );
    }
    throw new Error(
      "历史批量任务缺少不可变线路快照；已禁止 provider 调用，请转人工对账",
    );
  }
  if (read.videoRouteSnapshot === "buddy" || !read.route.enabled) {
    throw new Error("持久化批量线路尚未启用，拒绝 provider 调用");
  }
  return createVideoProviderByRouteSnapshot({
    videoRouteSnapshot: read.videoRouteSnapshot,
    videoModelSnapshot: read.videoModelSnapshot,
    videoProviderAdapterSnapshot: read.videoProviderAdapterSnapshot,
  });
}

function assertPersistedJobProviderReady(
  job: Pick<
    VideoJob,
    | "provider"
    | "videoRouteSnapshot"
    | "videoModelSnapshot"
    | "videoProviderAdapterSnapshot"
  >,
): VideoProviderAdapter {
  const provider = providerForJob(job);
  if (provider.id === "mock") assertMockVideoRuntimeAllowed();
  if (!provider.isConfigured()) {
    throw new Error(
      `持久化视频线路 ${job.videoRouteSnapshot ?? "historical_unknown"} 未配置，拒绝派发`,
    );
  }
  return provider;
}

function assertProductionMockRuntimeSealed(): void {
  const readiness = videoGenerationRuntimeReadiness();
  if (!readiness.ok && readiness.reason === "production_mock_forbidden") {
    throw new VideoGenerationRuntimeUnavailableError(readiness.reason);
  }
}

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

function remainingPlanConcurrency(limit: number, active: number): number {
  return Math.max(0, Math.floor(limit) - Math.max(0, Math.floor(active)));
}

/**
 * A quarantined historical row cannot consume a live provider/workspace slot.
 * Keep this predicate aligned with `isHistoricalDispatchQuarantined`: in real
 * mode an undecided pre-cutoff row is blocked; EXPIRED is blocked in every
 * mode; RELEASED is explicitly eligible.
 */
function dispatchableRunningSlotFilter(
  realDispatch: boolean,
): Prisma.VideoJobWhereInput {
  return realDispatch
    ? {
        OR: [
          { dispatchQuarantineDecision: QUARANTINE_RELEASED },
          {
            dispatchQuarantineDecision: null,
            createdAt: { gt: HISTORICAL_DISPATCH_CUTOFF },
          },
        ],
      }
    : {
        OR: [
          { dispatchQuarantineDecision: null },
          { dispatchQuarantineDecision: QUARANTINE_RELEASED },
        ],
      };
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

function batchRequestHash(
  input: CreateBatchInput,
  videoRouteSnapshot?: VideoRouteSnapshot,
): string {
  return hashVideoDispatchRequest(
    {
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      images: input.images,
      requestedCount: input.requestedCount,
      productName: input.productName?.trim() || null,
    },
    videoRouteSnapshot,
  );
}

function assertBatchReplayMatches(
  existing: BatchJob,
  input: CreateBatchInput,
  requestHash: string,
): void {
  if (existing.requestHash) {
    const persistedRoute = readVideoRouteSnapshot(existing);
    const expectedHash =
      persistedRoute.state === "historical_unknown"
        ? batchRequestHash(input)
        : requestHash;
    if (existing.requestHash !== expectedHash) {
      throw new BatchIdempotencyConflictError();
    }
    return;
  }
  const legacyMatches =
    existing.templateId === input.templateId &&
    existing.templateVersion === input.templateVersion &&
    existing.requestedCount === input.requestedCount &&
    (existing.productName ?? null) === (input.productName?.trim() || null) &&
    JSON.stringify(existing.imageIds) ===
      JSON.stringify(input.images.map((image) => image.id)) &&
    JSON.stringify(existing.imageUrls) ===
      JSON.stringify(input.images.map((image) => image.url));
  if (!legacyMatches) throw new BatchIdempotencyConflictError();
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
  videoRouteSnapshot?: VideoRouteSnapshot;
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
    ...(args.videoRouteSnapshot ?? {}),
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
  const imageIds = input.images.map((image) => image.id);
  if (new Set(imageIds).size !== imageIds.length) {
    throw new BatchImageIdConflictError();
  }
  // Runtime readiness must precede the idempotent replay shortcut. Otherwise
  // a production+mock deployment can return an existing batch and let the
  // route continue into quota/tick work even though new dispatch is sealed.
  assertVideoGenerationRuntimeReady();
  const videoRouteSnapshot = selectVideoRouteSnapshot({
    isInternalStaff: false,
  });
  const requestHash = batchRequestHash(input, videoRouteSnapshot);
  const existing = await db.batchJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    assertBatchReplayMatches(existing, input, requestHash);
    return existing;
  }

  const template = await db.styleTemplate.findFirst({
    where: {
      id: input.templateId,
      version: input.templateVersion,
      status: StyleTemplateStatus.ACTIVE,
    },
  });
  if (!template) throw new BatchTemplateUnavailableError();
  parseLockedParams(template.lockedParams);
  const imagesPerVideo = parseImagesPerVideo(template.imagesPerVideo);
  if (input.images.length < imagesPerVideo.min) {
    throw new BatchInsufficientAssetsError(
      imagesPerVideo.min,
      input.images.length,
    );
  }
  const provider =
    videoRouteSnapshot.videoRouteSnapshot === "mock"
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
      if (raced) {
        assertBatchReplayMatches(raced, input, requestHash);
        return raced;
      }

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
          requestHash,
          status: BatchJobStatus.EXPANDING,
          ...videoRouteSnapshot,
        },
      });
      const rows = buildBatchVideoRows({
        batchId: batch.id,
        template,
        images: input.images,
        requestedCount: input.requestedCount,
        productName: input.productName,
        provider,
        videoRouteSnapshot,
      });
      await tx.videoJob.createMany({ data: rows });
      return tx.batchJob.update({
        where: { id: batch.id },
        data: {
          status: BatchJobStatus.EXPANDING,
          queuedCount: rows.length,
          statusReason: `已按模板 ${template.slug}@${template.version} 原子展开；等待额度授权`,
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
      if (raced) {
        assertBatchReplayMatches(raced, input, requestHash);
        return raced;
      }
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
  if (!batch) throw new BatchNotFoundError();
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
    select: { id: true, submissionState: true },
  });
  let recovered = 0;
  for (const job of expired) {
    const safeToReplay =
      job.submissionState === ProviderSubmissionState.NOT_STARTED;
    const nextStatus = safeToReplay
      ? VideoJobStatus.QUEUED
      : VideoJobStatus.FAILED;
    const result = await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.RUNNING,
        externalJobId: null,
        leaseExpiresAt: { lt: now },
        submissionState: job.submissionState,
      },
      data: {
        status: nextStatus,
        submissionState: safeToReplay
          ? ProviderSubmissionState.NOT_STARTED
          : ProviderSubmissionState.ACK_UNKNOWN,
        submissionErrorClass: safeToReplay
          ? null
          : "lease_expired_after_submission_started",
        errorMessage: safeToReplay
          ? null
          : `${PROVIDER_FAILURE_PREFIX} 提交确认丢失；为避免重复计费已停止自动重提`,
        userSafeError: safeToReplay
          ? null
          : "生成服务可能已接收任务，系统已暂停重试以避免重复计费。请联系管理员核对。",
        finishedAt: safeToReplay ? null : now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        availableAt: safeToReplay ? now : null,
      },
    });
    if (result.count > 0) {
      recovered++;
      logStatusTransition({
        taskId: job.id,
        from: VideoJobStatus.RUNNING,
        to: nextStatus,
        reason: safeToReplay
          ? "batch_lease_expired_before_submission_requeue"
          : "batch_lease_expired_after_submission_ack_unknown",
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
  const realDispatch = isRealVideoDispatchMode();
  return withSerializableRetry(() =>
    db.$transaction(
      async (tx) => {
        const [batch, batchProvider] = await Promise.all([
          tx.batchJob.findUnique({
            where: { id: args.batchId },
            select: {
              userId: true,
              user: {
                select: {
                  workspace: {
                    select: {
                      plan: { select: { batchConcurrencyLimit: true } },
                    },
                  },
                },
              },
            },
          }),
          tx.videoJob.findFirst({
            where: { batchJobId: args.batchId },
            select: { provider: true },
          }),
        ]);
        if (!batch || !batchProvider) return [];
        const planLimit = batch.user.workspace?.plan.batchConcurrencyLimit;
        if (planLimit === undefined) {
          throw new Error(
            "用户缺少 Workspace plan；拒绝派发批次，避免绕过 plan 并发限制",
          );
        }
        // Provider 全局槽与 Workspace plan 槽必须同时有余量。
        const [activeForProvider, activeForUser] = await Promise.all([
          tx.videoJob.count({
            where: {
              status: VideoJobStatus.RUNNING,
              provider: batchProvider.provider,
              ...dispatchableRunningSlotFilter(realDispatch),
            },
          }),
          tx.videoJob.count({
            where: {
              status: VideoJobStatus.RUNNING,
              batchJob: { userId: batch.userId },
              ...dispatchableRunningSlotFilter(realDispatch),
            },
          }),
        ]);
        const slots = Math.max(
          0,
          Math.min(
            args.maxClaims,
            providerConcurrency() - activeForProvider,
            remainingPlanConcurrency(planLimit, activeForUser),
          ),
        );
        if (slots === 0) return [];
        const candidates = await tx.videoJob.findMany({
          where: {
            batchJobId: args.batchId,
            status: VideoJobStatus.QUEUED,
            submissionState: ProviderSubmissionState.NOT_STARTED,
            AND: [
              { OR: [{ availableAt: null }, { availableAt: { lte: args.now } }] },
              {
                OR: [
                  { dispatchQuarantineDecision: QUARANTINE_RELEASED },
                  {
                    dispatchQuarantineDecision: null,
                    ...(realDispatch
                      ? { createdAt: { gt: HISTORICAL_DISPATCH_CUTOFF } }
                      : {}),
                  },
                ],
              },
            ],
          },
          orderBy: { batchIndex: "asc" },
          take: slots,
        });
        const candidateIds = candidates.map((job) => job.id);
        if (candidateIds.length === 0) return [];

        // One set-based CAS keeps the serializable transaction bounded on a
        // remote Neon branch. The old per-row loop performed up to N network
        // round trips and could expire the 5s transaction after partially
        // preparing a customer batch.
        const claimed = await tx.videoJob.updateMany({
          where: {
            id: { in: candidateIds },
            status: VideoJobStatus.QUEUED,
            submissionState: ProviderSubmissionState.NOT_STARTED,
          },
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
        if (claimed.count === 0) return [];

        const claimedRows = await tx.videoJob.findMany({
          where: {
            id: { in: candidateIds },
            status: VideoJobStatus.RUNNING,
            submissionState: ProviderSubmissionState.NOT_STARTED,
            leaseOwner: owner,
          },
          orderBy: { batchIndex: "asc" },
        });
        return claimedRows.map((job) => ({ ...job, claimOwner: owner }));
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
  const provider = providerForJob(job);
  const now = new Date();
  const attempts = job.submitAttempts + 1;
  const providerRequestKey = `${job.id}:attempt:${attempts}`;
  const intent = await db.videoJob.updateMany({
    where: {
      id: job.id,
      status: VideoJobStatus.RUNNING,
      leaseOwner: job.claimOwner,
      submissionState: ProviderSubmissionState.NOT_STARTED,
    },
    data: {
      submissionState: ProviderSubmissionState.SUBMITTING,
      submissionErrorClass: null,
      providerRequestKey,
      submittedAt: now,
      submitAttempts: { increment: 1 },
      heartbeatAt: now,
    },
  });
  if (intent.count === 0) return;

  let providerAcknowledged = false;
  try {
    const guarded = await callProviderWithHistoricalGuard({
      record: job,
      call: () => provider.createVideoJob({
        providerRequestKey,
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
      }),
    });
    if (!guarded.called) {
      await db.videoJob.updateMany({
        where: {
          id: job.id,
          status: VideoJobStatus.RUNNING,
          leaseOwner: job.claimOwner,
          submissionState: ProviderSubmissionState.SUBMITTING,
          providerRequestKey,
        },
        data: {
          status: VideoJobStatus.QUEUED,
          submissionState: ProviderSubmissionState.NOT_STARTED,
          providerRequestKey: null,
          submittedAt: null,
          submitAttempts: { decrement: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      });
      console.warn(JSON.stringify({
        evt: "historical_dispatch_quarantined",
        entity: "VideoJob",
        id: job.id,
        cutoff: HISTORICAL_DISPATCH_CUTOFF.toISOString(),
      }));
      return;
    }
    const created = guarded.value;
    providerAcknowledged = true;
    const updated = await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.RUNNING,
        leaseOwner: job.claimOwner,
        submissionState: ProviderSubmissionState.SUBMITTING,
        providerRequestKey,
      },
      data: {
        externalJobId: created.providerJobId,
        startedAt: now,
        lastProviderStatus: "queued",
        submissionState: ProviderSubmissionState.ACCEPTED,
        submissionErrorClass: null,
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
      return;
    }
    throw new Error("provider acknowledgement could not be persisted");
  } catch (error) {
    const classified = asProviderSubmissionError({
      error,
      providerId: job.videoRouteSnapshot ?? provider.id,
      evidence: providerAcknowledged
        ? { stage: "persistence" }
        : provider.isMockMode()
          ? { stage: "preflight", retryable: true }
          : undefined,
    });
    const retryable =
      attempts < MAX_SUBMIT_ATTEMPTS &&
      shouldAutomaticallyRetrySubmission(classified);
    const acknowledgementUnknown =
      classified.disposition === "acknowledgement_unknown";
    const nextStatus = retryable
      ? VideoJobStatus.QUEUED
      : VideoJobStatus.FAILED;
    const nextSubmissionState = retryable
      ? ProviderSubmissionState.NOT_STARTED
      : acknowledgementUnknown
        ? ProviderSubmissionState.ACK_UNKNOWN
        : ProviderSubmissionState.REJECTED;
    const delayMs = Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
    await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.RUNNING,
        leaseOwner: job.claimOwner,
        submissionState: ProviderSubmissionState.SUBMITTING,
        providerRequestKey,
      },
      data: {
        status: nextStatus,
        submissionState: nextSubmissionState,
        submissionErrorClass: `${classified.disposition}:${classified.stage}`,
        providerRequestKey: retryable ? null : providerRequestKey,
        availableAt: retryable ? new Date(Date.now() + delayMs) : null,
        errorMessage: acknowledgementUnknown
          ? `${PROVIDER_FAILURE_PREFIX} 提交确认未知；禁止自动重提: ${classified.message}`
          : retryable
            ? `批量提交确认未创建任务，将退避重试: ${classified.message}`
            : `${PROVIDER_FAILURE_PREFIX} 提交被拒绝: ${classified.message}`,
        userSafeError: acknowledgementUnknown
          ? "生成服务可能已接收任务，系统已暂停重试以避免重复计费。请联系管理员核对。"
          : retryable
            ? null
            : "视频提交失败，请检查素材或稍后重试。",
        finishedAt: retryable ? null : new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    logStatusTransition({
      taskId: job.id,
      from: VideoJobStatus.RUNNING,
      to: nextStatus,
      reason: retryable
        ? `batch_submit_confirmed_no_create_backoff_attempt_${attempts}`
        : acknowledgementUnknown
          ? "batch_submit_ack_unknown_no_retry"
          : "batch_submit_rejected",
    });
  }
}

function isBillingSafeManualRetry(job: {
  provider: VideoProvider;
  videoRouteSnapshot: string | null;
  videoModelSnapshot: string | null;
  videoProviderAdapterSnapshot: string | null;
  submissionState: ProviderSubmissionState;
  externalJobId: string | null;
  lastProviderStatus: string | null;
  errorMessage: string | null;
}): boolean {
  if (
    job.submissionState === ProviderSubmissionState.ACK_UNKNOWN ||
    job.submissionState === ProviderSubmissionState.SUBMITTING
  ) {
    return false;
  }
  // Provider capability is the only mock/real decision point. The explicit
  // rehearsal adapter is zero-cost and deterministically succeeds on retry;
  // real adapters continue through the conservative billing-evidence checks.
  if (providerForJob(job).manualRetryBillingRisk === "none") return true;
  // For a paid/ambiguous adapter, only positive evidence that no external job
  // exists makes this zero-cost retry path safe. Provider-terminal states and
  // post-generation QA failures may already be billable and require a new,
  // explicitly metered regeneration workflow instead.
  return (
    job.externalJobId === null &&
    (job.submissionState === ProviderSubmissionState.NOT_STARTED ||
      job.submissionState === ProviderSubmissionState.REJECTED)
  );
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const errors: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          await fn(items[index]);
        } catch (error) {
          // One malformed/provider-failed item must not strand its siblings.
          // Preserve failure visibility, but only reject after every claimed item
          // has settled so callers can safely reconcile/account for the batch.
          errors.push(error);
        }
      }
    }),
  );
  if (errors.length > 0) {
    throw new AggregateError(errors, `${errors.length} concurrent item(s) failed`);
  }
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

/**
 * A batch that is no longer being viewed must not permanently consume every
 * global provider slot. Reconcile only jobs that are already beyond the hard
 * deadline; reconcileVideoJob will take the no-provider-call watchdog path and
 * CAS them to FAILED. This keeps the global concurrency guard strict without
 * allowing abandoned jobs to deadlock every later customer batch.
 */
async function expireHardDeadlineProviderSlots(
  provider: VideoProvider,
  now: Date,
  reconcile: (jobId: string) => Promise<unknown> = reconcileVideoJob,
): Promise<number> {
  const hardDeadlineCutoff = new Date(
    now.getTime() - watchdogGraceMin() * 60_000,
  );
  const expired = await db.videoJob.findMany({
    where: {
      provider,
      status: VideoJobStatus.RUNNING,
      timeoutAt: { lt: hardDeadlineCutoff },
    },
    select: { id: true, batchJobId: true },
    orderBy: { timeoutAt: "asc" },
    take: providerConcurrency() * 20,
  });
  if (expired.length === 0) return 0;

  await mapConcurrent(expired, providerConcurrency(), async (job) => {
    await reconcile(job.id);
  });
  const affectedBatchIds = [
    ...new Set(
      expired
        .map((job) => job.batchJobId)
        .filter((batchId): batchId is string => Boolean(batchId)),
    ),
  ];
  await mapConcurrent(affectedBatchIds, providerConcurrency(), async (batchId) => {
    await syncBatchCounts(batchId);
  });
  return expired.length;
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
  // This guard intentionally runs before the first DB read. Route-specific
  // credential readiness is checked from the persisted job snapshot below.
  assertProductionMockRuntimeSealed();
  const now = new Date();
  const [batch, batchProvider] = await Promise.all([
    db.batchJob.findUnique({ where: { id: batchId } }),
    db.videoJob.findFirst({
      where: { batchJobId: batchId },
      select: {
        provider: true,
        videoRouteSnapshot: true,
        videoModelSnapshot: true,
        videoProviderAdapterSnapshot: true,
      },
    }),
  ]);
  if (!batch) throw new BatchNotFoundError();
  if (isTerminalBatchStatus(batch.status)) {
    return batch;
  }
  if (!batch.quotaConsumedAt) {
    throw new BatchDispatchNotAuthorizedError();
  }
  if (isHistoricalDispatchQuarantined(batch)) {
    console.warn(JSON.stringify({
      evt: "historical_dispatch_quarantined",
      entity: "BatchJob",
      id: batch.id,
      cutoff: HISTORICAL_DISPATCH_CUTOFF.toISOString(),
    }));
    return batch;
  }
  if (batchProvider) assertPersistedJobProviderReady(batchProvider);

  await recoverExpiredLeases(batchId, now);
  if (batchProvider) {
    await expireHardDeadlineProviderSlots(batchProvider.provider, now);
  }
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
  // Retry is a dispatch-enabling mutation. Refuse it while the selected video
  // runtime is unavailable instead of leaving newly QUEUED work behind.
  assertProductionMockRuntimeSealed();
  const failed = await db.videoJob.findMany({
    where: { batchJobId: batchId, status: VideoJobStatus.FAILED },
    select: {
      id: true,
      provider: true,
      videoRouteSnapshot: true,
      videoModelSnapshot: true,
      videoProviderAdapterSnapshot: true,
      submissionState: true,
      externalJobId: true,
      lastProviderStatus: true,
      errorMessage: true,
    },
  });
  let reset = 0;
  for (const job of failed) {
    try {
      assertPersistedJobProviderReady(job);
    } catch {
      continue;
    }
    if (!isBillingSafeManualRetry(job)) continue;
    const result = await db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.FAILED,
        submissionState: job.submissionState,
      },
      data: {
        status: VideoJobStatus.QUEUED,
        submissionState: ProviderSubmissionState.NOT_STARTED,
        submissionErrorClass: null,
        providerRequestKey: null,
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

export type RetryFailedBatchJobResult =
  | { outcome: "retried" }
  | { outcome: "not_found" }
  | { outcome: "invalid_state" }
  | { outcome: "billing_unsafe" };

export async function retryFailedBatchJob(
  batchId: string,
  jobId: string,
): Promise<RetryFailedBatchJobResult> {
  // Keep the single-job retry path under the same fail-closed boundary as the
  // retry-all path; preview mock remains allowed by the shared env predicate.
  assertProductionMockRuntimeSealed();
  const job = await db.videoJob.findFirst({
    where: {
      id: jobId,
      batchJobId: batchId,
    },
    select: {
      status: true,
      provider: true,
      videoRouteSnapshot: true,
      videoModelSnapshot: true,
      videoProviderAdapterSnapshot: true,
      submissionState: true,
      externalJobId: true,
      lastProviderStatus: true,
      errorMessage: true,
    },
  });
  if (!job) return { outcome: "not_found" };
  if (job.status !== VideoJobStatus.FAILED) {
    return { outcome: "invalid_state" };
  }
  try {
    assertPersistedJobProviderReady(job);
  } catch {
    return { outcome: "billing_unsafe" };
  }
  if (!isBillingSafeManualRetry(job)) {
    return { outcome: "billing_unsafe" };
  }
  const result = await db.videoJob.updateMany({
    where: {
      id: jobId,
      batchJobId: batchId,
      status: VideoJobStatus.FAILED,
      submissionState: job.submissionState,
    },
    data: {
      status: VideoJobStatus.QUEUED,
      submissionState: ProviderSubmissionState.NOT_STARTED,
      submissionErrorClass: null,
      providerRequestKey: null,
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
  if (result.count === 0) return { outcome: "invalid_state" };
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
  return { outcome: "retried" };
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
          provider: true,
          videoRouteSnapshot: true,
          videoModelSnapshot: true,
          videoProviderAdapterSnapshot: true,
          externalJobId: true,
          lastProviderStatus: true,
          submissionState: true,
          submissionErrorClass: true,
          retryCount: true,
          createdAt: true,
          submittedAt: true,
          finishedAt: true,
        },
      },
    },
  });
  if (!batch) throw new BatchNotFoundError();
  return batch;
}

export type CustomerBatchStatus = {
  id: string;
  templateId: string;
  templateVersion: number;
  productName: string | null;
  requestedCount: number;
  status: BatchJobStatus;
  queuedCount: number;
  pausedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  statusReason: string | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  template: {
    id: string;
    version: number;
    name: string;
    nameZh: string;
    category: string;
    coverImage: string | null;
  };
  videoJobs: Array<{
    id: string;
    batchIndex: number | null;
    status: VideoJobStatus;
    assignedAssets: {
      assets: Array<{ id: string; url: string }>;
    } | null;
    outputVideoUrl: string | null;
    outputThumbUrl: string | null;
    lastProgress: number | null;
    userSafeError: string | null;
    retryCount: number;
    createdAt: Date;
    submittedAt: Date | null;
    finishedAt: Date | null;
    error: ReturnType<typeof classifyCustomerGenerationError>;
  }>;
};

function customerHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function customerAssetAssignment(value: Prisma.JsonValue | null): {
  assets: Array<{ id: string; url: string }>;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const assets = (value as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return null;
  const safeAssets = assets.flatMap((asset) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) return [];
    const id = (asset as { id?: unknown }).id;
    const url = customerHttpUrl((asset as { url?: unknown }).url);
    return typeof id === "string" && id.length > 0 && url
      ? [{ id, url }]
      : [];
  });
  return { assets: safeAssets };
}

/**
 * Customer APIs must never expose provider diagnostics or submission internals.
 * Those values remain in the database/internal surfaces for incident response.
 */
export function toCustomerBatchStatus(
  batch: Awaited<ReturnType<typeof getBatchStatus>>,
): CustomerBatchStatus {
  const statusReason =
    batch.status === BatchJobStatus.PAUSED
      ? "生成服务暂时拥堵，任务已安全排队。"
      : batch.status === BatchJobStatus.PARTIAL_FAILED ||
          batch.status === BatchJobStatus.FAILED
        ? "部分视频生成失败，请查看任务详情。"
        : null;
  return {
    id: batch.id,
    templateId: batch.templateId,
    templateVersion: batch.templateVersion,
    productName: batch.productName,
    requestedCount: batch.requestedCount,
    status: batch.status,
    queuedCount: batch.queuedCount,
    pausedCount: batch.pausedCount,
    runningCount: batch.runningCount,
    completedCount: batch.completedCount,
    failedCount: batch.failedCount,
    cancelledCount: batch.cancelledCount,
    statusReason,
    finishedAt: batch.finishedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    template: {
      id: batch.template.id,
      version: batch.template.version,
      name: batch.template.name,
      nameZh: batch.template.nameZh,
      category: batch.template.category,
      coverImage: batch.template.coverImage,
    },
    videoJobs: batch.videoJobs.map((job) => ({
      id: job.id,
      batchIndex: job.batchIndex,
      status: job.status,
      assignedAssets: customerAssetAssignment(job.assignedAssets),
      outputVideoUrl: customerHttpUrl(job.outputVideoUrl),
      outputThumbUrl: customerHttpUrl(job.outputThumbUrl),
      lastProgress: job.lastProgress,
      userSafeError: job.userSafeError,
      retryCount: job.retryCount,
      createdAt: job.createdAt,
      submittedAt: job.submittedAt,
      finishedAt: job.finishedAt,
      error: classifyCustomerGenerationError({
        status: job.status,
        submissionState: job.submissionState,
        submissionErrorClass: job.submissionErrorClass,
        errorMessage: job.errorMessage,
        userSafeError: job.userSafeError,
        billingSafeToRetry:
          job.status === VideoJobStatus.FAILED
            ? isBillingSafeManualRetry(job)
            : false,
      }),
    })),
  };
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
  remainingPlanConcurrency,
  dispatchableRunningSlotFilter,
  mapConcurrent,
  recoverExpiredLeases,
  expireHardDeadlineProviderSlots,
  claimJobs,
  applyBreaker,
  isSerializableConflict,
  withSerializableRetry,
  submitClaimedJob,
  isBillingSafeManualRetry,
  __setVideoProviderFactoryForTests(
    factory: ((job: Pick<VideoJob, "provider">) => VideoProviderAdapter) | null,
  ): void {
    videoProviderFactoryOverride = factory;
  },
};
