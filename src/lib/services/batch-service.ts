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
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { QuotaExceededError } from "./quota-service";
import {
  QuotaRechargeUnavailableError,
  requeueRefundedBatchJob,
} from "./quota-refund-service";
import {
  assertMockVideoRuntimeAllowed,
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
import type { BatchPostProductionInput } from "@/lib/schemas/unified-input";
import {
  createVideoRouteSnapshot,
  readVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "@/lib/video-generation/video-route-registry";
import {
  canVideoRouteOverrideDefaultRuntimeFailure,
  getVideoRouteSnapshotRuntimeAvailability,
  selectVideoRouteSnapshot,
} from "@/lib/video-generation/video-route-selection";
import {
  resolveShuyuVideoPlan,
  SHUYU_MAX_REFERENCE_IMAGES,
  shuyuVideoPlanPointsForDuration,
} from "@/lib/providers/shuyu";
import { resolveVideoRouteCostSnapshot } from "@/lib/video-generation/video-route-cost";
import {
  creativeRecipeSnapshot,
  DEFAULT_BRAND_PLACEMENT,
} from "@/lib/video-generation/creative-recipe";
import {
  attachStoryboardToVideoJob,
  canRegenerateStoryboardFrame,
  createStoryboardRun,
  reconcileStoryboardRun,
  regenerateStoryboardFrame,
  requireApprovedStoryboardForVideoJob,
} from "@/lib/video-generation/storyboard-service";

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

export class BatchProviderInputError extends Error {
  readonly code = "BATCH_PROVIDER_INPUT_INVALID" as const;
  readonly httpStatus = 422 as const;

  constructor(message: string) {
    super(message);
    this.name = "BatchProviderInputError";
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

/// 提交已被合作方确认，但 ACCEPTED 的 CAS 干净落空（count=0）——行已被并发
/// 路径接管。与「落库抛错」区分开：后者值得重试一次持久化，前者不值得。
class BatchSubmissionPersistenceLostError extends Error {
  constructor() {
    super("provider acknowledgement could not be persisted");
    this.name = "BatchSubmissionPersistenceLostError";
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
  if (!read.route.enabled) {
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
  videoRouteId?: unknown;
  isInternalStaff?: boolean;
  /// 批次级后期（口播 / BGM / 字幕），整批共用；null/省略 = 干净视频。
  postProduction?: BatchPostProductionInput | null;
  /// 合作方(买断制)线路的套餐选择;必须在实时审计清单内,省略 = 默认套餐。
  videoPlanId?: string | null;
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
      /// 后期设置改变成片，必须进哈希，否则同一幂等键换配置会被误判为重放。
      /// 仅在非空时并入：不选后期的批次沿用历史哈希，旧批次重放不会假冲突。
      ...(input.postProduction ? { postProduction: input.postProduction } : {}),
      /// 套餐选择改变计费与线路行为,同理进哈希;缺省(默认套餐)不并入。
      ...(input.videoPlanId ? { videoPlanId: input.videoPlanId } : {}),
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

/**
 * 批次级后期在快照里的命名空间键。
 *
 * 后期设置本属于批次而非单条，理想位置是 BatchJob 上的一列；但生产库的 DDL
 * 需要 neondb_owner，而运行时角色只有 DML 权限（见 docs/roadmap 记录）。
 * 因此随不可变的模板快照一起写进每条 VideoJob：同批次所有行值相同，
 * 语义仍是「整批共用一套后期」，且天然获得与模板快照一致的可溯源性。
 * 加 `__` 前缀与模板自身字段区隔，读取方按 schema 校验，失败即视为无后期。
 */
const BATCH_POST_PRODUCTION_KEY = "__batchPostProduction" as const;

export function readBatchPostProductionFromSnapshot(
  snapshot: unknown,
): unknown {
  if (!snapshot || typeof snapshot !== "object") return null;
  return (snapshot as Record<string, unknown>)[BATCH_POST_PRODUCTION_KEY] ?? null;
}

/// lockedParams 是 Json 列，运行时不保证形状；取不到画幅就返回 undefined，
/// 让 aspectRatio 保持 null 而不是编一个 "9:16"。
function templateAspectRatio(template: StyleTemplate): string | undefined {
  const locked = template.lockedParams as { aspectRatio?: unknown } | null;
  const ratio = locked?.aspectRatio;
  return typeof ratio === "string" && ratio.trim() ? ratio : undefined;
}

function templateSnapshot(
  template: StyleTemplate,
  postProduction?: BatchPostProductionInput | null,
  providerPlanId?: string | null,
): Prisma.InputJsonValue {
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
    ...(postProduction ? { [BATCH_POST_PRODUCTION_KEY]: postProduction } : {}),
    /// 用户选定的合作方套餐(0803 多套餐)。缺省 = 提交时用实时默认套餐。
    /// 落在快照里保证:同一批次内所有任务、包括后续重试,用同一套餐提交。
    ...(providerPlanId ? { providerPlanId } : {}),
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
  postProduction?: BatchPostProductionInput | null;
  /// 由调用方在事务外解析(买断制线路计价随 /prices 实时变化,必须 async 取)。
  costSnapshot?: { providerUnitPoints?: number };
  /// 用户选定的合作方套餐 ID;缺省用提交时默认套餐。
  videoPlanId?: string | null;
}): Prisma.VideoJobCreateManyInput[] {
  const assignments = allocateAssets({
    batchId: args.batchId,
    images: args.images,
    count: args.requestedCount,
    templateId: `${args.template.id}@${args.template.version}`,
    imagesPerVideo: parseImagesPerVideo(args.template.imagesPerVideo),
  });
  const snapshot = templateSnapshot(
    args.template,
    args.postProduction,
    args.videoPlanId,
  );

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
    /// 单条成片成本快照：没有这一列，PRD C1 的成本指标连基线都算不出来
    ...(args.costSnapshot ?? {}),
    /// 创意配方快照（PRD §9.4）：赛马按「哪种结构在赢」归因的分组键。
    /// 批量线路的配方身份就是模板版本；钩子类型批量线路没有，保持 null。
    ...creativeRecipeSnapshot({
      template: args.template,
      aspectRatio: templateAspectRatio(args.template),
      brandPlacement: DEFAULT_BRAND_PLACEMENT,
    }),
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
  const videoRouteSnapshot = selectVideoRouteSnapshot({
    requestedRouteId: input.videoRouteId,
    isInternalStaff: input.isInternalStaff === true,
  });
  // Keep production mock/content-review seals ahead of replay, while allowing
  // an explicitly selected healthy provider to act as a fallback when only the
  // deployment's default provider is misconfigured.
  const runtimeReadiness = videoGenerationRuntimeReadiness();
  const selectedRouteOverridesDefaultFailure =
    !runtimeReadiness.ok &&
    canVideoRouteOverrideDefaultRuntimeFailure(
      videoRouteSnapshot,
      runtimeReadiness.reason,
    );
  if (!runtimeReadiness.ok && !selectedRouteOverridesDefaultFailure) {
    throw new VideoGenerationRuntimeUnavailableError(runtimeReadiness.reason);
  }
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
  const imagesPerVideo = parseImagesPerVideo(template.imagesPerVideo);
  if (input.images.length < imagesPerVideo.min) {
    throw new BatchInsufficientAssetsError(
      imagesPerVideo.min,
      input.images.length,
    );
  }
  if (videoRouteSnapshot.videoRouteSnapshot === "buddy") {
    const invalidReferenceUrl = input.images.some((image) => {
      try {
        return new URL(image.url).protocol !== "https:";
      } catch {
        return true;
      }
    });
    if (invalidReferenceUrl) {
      throw new BatchProviderInputError("合作方线路只接受 HTTPS 图片地址");
    }
    if (imagesPerVideo.max > 9) {
      throw new BatchProviderInputError("合作方线路每支视频最多接受 9 张参考图");
    }
  }
  /// 买断制线路按实时审计套餐估算积分需求;解析失败时交给可用性探针给出
  /// 具体原因(price_contract_mismatch 等),不用过期常量高/低估。
  const lockedDurationSec =
    (template.lockedParams as { duration?: number } | null)?.duration ?? 15;
  const requestedPlanId = input.videoPlanId?.trim() || null;
  if (requestedPlanId && videoRouteSnapshot.videoRouteSnapshot !== "buddy") {
    throw new BatchProviderInputError("套餐选择仅适用于合作方线路");
  }
  let buddyPerVideoPoints: number | undefined;
  if (videoRouteSnapshot.videoRouteSnapshot === "buddy") {
    if (requestedPlanId) {
      /// 显式选择的套餐必须实时在审计清单内;不在就明确拒绝,
      /// 绝不静默换成别的套餐扣费。
      try {
        const plan = await resolveShuyuVideoPlan({ planId: requestedPlanId });
        buddyPerVideoPoints = shuyuVideoPlanPointsForDuration(
          plan,
          lockedDurationSec,
        );
      } catch {
        throw new BatchProviderInputError(
          "所选视频套餐已下架或暂不可用，请刷新后重新选择",
        );
      }
    } else {
      try {
        const plan = await resolveShuyuVideoPlan();
        buddyPerVideoPoints = shuyuVideoPlanPointsForDuration(
          plan,
          lockedDurationSec,
        );
      } catch {
        buddyPerVideoPoints = undefined;
      }
    }
  }
  const availability = await getVideoRouteSnapshotRuntimeAvailability({
    snapshot: videoRouteSnapshot,
    shuyuRequiredPoints:
      buddyPerVideoPoints !== undefined
        ? input.requestedCount * buddyPerVideoPoints
        : undefined,
  });
  if (!availability.available) {
    throw new VideoGenerationRuntimeUnavailableError(
      availability.reason === "insufficient_balance"
        ? "shuyu_insufficient_balance"
        : videoRouteSnapshot.videoRouteSnapshot === "buddy"
          ? "shuyu_unavailable"
          : videoRouteSnapshot.videoRouteSnapshot === "volcengine_cn_legacy"
            ? "volcengine_legacy_key_missing"
            : "byteplus_key_missing",
    );
  }
  const provider =
    videoRouteSnapshot.videoRouteSnapshot === "mock"
      ? VideoProvider.MOCK
      : VideoProvider.SEEDANCE_I2V;
  /// 在事务外解析计价快照(网络调用不进事务;买断线路价格实时变化)。
  const costSnapshot = await resolveVideoRouteCostSnapshot(
    videoRouteSnapshot.videoRouteSnapshot,
    lockedDurationSec,
    requestedPlanId,
  );

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
        costSnapshot,
        videoPlanId: requestedPlanId,
        postProduction: input.postProduction,
      });
      if (videoRouteSnapshot.videoRouteSnapshot === "buddy") {
        const negativePrompt = template.negativePrompt?.trim();
        const hasInvalidPrompt = rows.some((row) => {
          const prompt =
            typeof row.promptText === "string" ? row.promptText : "";
          const mergedPrompt = negativePrompt
            ? `${prompt}\nNegative constraints: ${negativePrompt}`
            : prompt;
          return !mergedPrompt.trim() || mergedPrompt.length > 5_000;
        });
        if (hasInvalidPrompt) {
          // Throwing inside this transaction rolls back the just-created
          // BatchJob, and the route has not authorized any local quota yet.
          throw new BatchProviderInputError(
            "合作方线路的渲染后提示词不得超过 5000 个字符",
          );
        }
      }
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
  /// 取消不是失败：只有真失败的条目才让批次进入（部分）失败；
  /// 「完成 + 取消」「全部取消」都是已取消，已完成的成片照常保留。
  if (failed > 0) {
    return completed > 0
      ? BatchJobStatus.PARTIAL_FAILED
      : BatchJobStatus.FAILED;
  }
  if (cancelled > 0) return BatchJobStatus.CANCELLED;
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

/// syncBatchCounts 的 CAS 落空重读次数。落空意味着另一个写者刚写过这一行，
/// 重读即可拿到不比它旧的计数；连续落空说明写者在抢，交给下一次 tick 收敛。
const SYNC_COUNTS_CAS_RETRY_LIMIT = 3;

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

/**
 * 按任务真实状态重算批次计数与状态。
 *
 * 写入带 updatedAt 条件（乐观并发）：先读批次行、再数任务，只有这期间没人写过
 * 这一行才落库。此前无条件覆盖：两个标签页 / cron 并发 tick 时，先读到旧计数
 * 的一方可能晚落库，把刚到终态的批次写回「生成中」，或把重试后刚复活的批次写回
 * 终态——后者会让 processBatchTick 在终态短路，排队行再无人推进。
 * 读取顺序是语义：批次行在前、计数在后，落库成功即保证计数不比上一个写者旧。
 */
export async function syncBatchCounts(batchId: string): Promise<BatchJob> {
  for (let attempt = 0; ; attempt += 1) {
    const batch = await db.batchJob.findUnique({ where: { id: batchId } });
    if (!batch) throw new BatchNotFoundError();
    const grouped = await db.videoJob.groupBy({
      by: ["status"],
      where: { batchJobId: batchId },
      _count: { _all: true },
    });
    const counts: Partial<Record<VideoJobStatus, number>> = {};
    for (const row of grouped as StatusCount[]) {
      counts[row.status] = row._count._all;
    }
    const status = deriveBatchStatus({
      requestedCount: batch.requestedCount,
      counts,
    });
    const terminal = isTerminalBatchStatus(status);
    try {
      return await db.batchJob.update({
        where: { id: batchId, updatedAt: batch.updatedAt },
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
    } catch (error) {
      if (!isRecordNotFound(error)) throw error;
      if (attempt + 1 >= SYNC_COUNTS_CAS_RETRY_LIMIT) {
        const latest = await db.batchJob.findUnique({ where: { id: batchId } });
        if (!latest) throw new BatchNotFoundError();
        console.warn(JSON.stringify({
          evt: "batch_sync_counts_cas_contended",
          batchId,
          attempts: attempt + 1,
        }));
        return latest;
      }
    }
  }
}

/**
 * 批次 tick 租约（D3）：放弃 advisory lock——走 pooler 会把锁泄漏在复用连接上
 * （CLAUDE.md §4.1）——改用 BatchJob.tickLeaseUntil/tickLeaseOwner 做 CAS 抢占。
 *
 * 同一批次同一时刻只有一个 tick 在做供应商对账与派发：每多开一个批次详情页，
 * 不再多出一份供应商查询与帧质检。抢不到就跳过本次 tick（另一个 tick 正在做
 * 同样的事），持有者在 finally 里释放。
 *
 * 时长按「函数被平台杀掉后多久可以接手」取 2 分钟；tick 在故事板阶段之后、派发
 * 之前各续租一次，慢 tick 不会中途丢锁。若真丢了（续租落空），停止新的派发，
 * 只保留已做完的对账——最坏情况退化成改造前的并发 tick，任务级 CAS 仍保证不重复提交。
 */
const TICK_LEASE_MS = 120_000;

async function acquireBatchTickLease(
  batchId: string,
  now: Date,
): Promise<string | null> {
  const owner = randomUUID();
  const acquired = await db.batchJob.updateMany({
    where: {
      id: batchId,
      OR: [{ tickLeaseUntil: null }, { tickLeaseUntil: { lt: now } }],
    },
    data: {
      tickLeaseOwner: owner,
      tickLeaseUntil: new Date(now.getTime() + TICK_LEASE_MS),
    },
  });
  return acquired.count === 1 ? owner : null;
}

async function renewBatchTickLease(
  batchId: string,
  owner: string,
): Promise<boolean> {
  const renewed = await db.batchJob.updateMany({
    where: { id: batchId, tickLeaseOwner: owner },
    data: { tickLeaseUntil: new Date(Date.now() + TICK_LEASE_MS) },
  });
  return renewed.count === 1;
}

async function releaseBatchTickLease(
  batchId: string,
  owner: string,
): Promise<void> {
  try {
    await db.batchJob.updateMany({
      where: { id: batchId, tickLeaseOwner: owner },
      data: { tickLeaseOwner: null, tickLeaseUntil: null },
    });
  } catch (error) {
    /// 释放失败不抛：租约最多 TICK_LEASE_MS 后自然过期，不能让它盖掉 tick 的真实结果。
    console.warn(JSON.stringify({
      evt: "batch_tick_lease_release_failed",
      batchId,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    }));
  }
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
        /// 回队列的行清掉提交期 deadline，排队等待不该消耗渲染时钟。
        ...(safeToReplay ? { timeoutAt: null } : {}),
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
            select: { provider: true, videoRouteSnapshot: true },
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
            ...(batchProvider.videoRouteSnapshot === "buddy"
              ? { storyboardRun: { status: "APPROVED" } }
              : {}),
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
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        /// Neon pooler 的跨洋 RTT 下，claim 事务的多条查询可能超过 Prisma 默认
        /// 5s interactive-transaction 超时（2026-07-20 批量验收实测 5.07s 爆炸）。
        /// 事务内只有 DB 操作，放宽到 30s 不影响正确性。
        maxWait: 10_000,
        timeout: 30_000,
      },
    ),
  );
}

function assignmentFromJob(job: VideoJob): AssetAssignment {
  return job.assignedAssets as unknown as AssetAssignment;
}

/// 任何视频线路单次提交的参考图硬上限（Shuyu 文档上限，也是其它适配器的最大值）。
/// 按套餐的实际上限由各适配器在解析出套餐后再截断，见 shuyu-video-provider。
const BATCH_REFERENCE_IMAGES_HARD_MAX = SHUYU_MAX_REFERENCE_IMAGES;

/**
 * 批量提交的参考图顺序：商家实拍产品图在前，故事板帧在后。
 *
 * prompt 在建批次时由 renderBatchTemplatePrompt 按产品图张数写好
 * 「input_images[1..k]」——槽位编号只有在实拍图真的排在第 1..k 位时才指对图。
 * 此前故事板帧排在前面，提示词里的产品槽位实际指向 AI 帧（产品细节漂移的根因
 * 之一）；遇到只收 4 张的套餐时，按位截断还会把实拍图整组挤掉。
 * 实拍在前之后，任何截断（这里的硬上限、适配器按套餐上限）都只会先丢故事板帧。
 */
function orderBatchReferenceImages(args: {
  productUrls: string[];
  storyboardUrls: string[];
}): Array<{ url: string; role: "content" }> {
  return [...args.productUrls, ...args.storyboardUrls]
    .slice(0, BATCH_REFERENCE_IMAGES_HARD_MAX)
    .map((url) => ({ url, role: "content" as const }));
}

async function submitClaimedJob(
  job: VideoJob & { claimOwner: string },
): Promise<void> {
  const assignment = assignmentFromJob(job);
  const snapshot = job.templateSnapshot as unknown as {
    lockedParams: BatchStyleLockedParams;
    /// 0803 多套餐:批次创建时选定的合作方套餐;缺失 = 提交时实时默认。
    providerPlanId?: string;
  };
  const provider = providerForJob(job);
  const now = new Date();
  const attempts = job.submitAttempts + 1;
  const providerRequestKey = `${job.id}:attempt:${attempts}`;
  const storyboardReferences = job.videoRouteSnapshot === "buddy"
    ? await requireApprovedStoryboardForVideoJob(job.id)
    : [];
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

  /// 合作方一旦返回任务号，提交就已确认；把确认结果捕获在 try 外，
  /// 落库瞬时失败时重试一次持久化即可救回真实任务（900pt 级），
  /// 而不是让它掉进「确认未知」黑洞。
  let acknowledged: {
    providerJobId: string;
    providerId: string;
    providerUnitPoints?: number;
  } | null = null;
  const acceptJobSubmission = (ack: NonNullable<typeof acknowledged>) =>
    db.videoJob.updateMany({
      where: {
        id: job.id,
        status: VideoJobStatus.RUNNING,
        leaseOwner: job.claimOwner,
        submissionState: ProviderSubmissionState.SUBMITTING,
        providerRequestKey,
      },
      data: {
        externalJobId: ack.providerJobId,
        startedAt: now,
        lastProviderStatus: "queued",
        submissionState: ProviderSubmissionState.ACCEPTED,
        submissionErrorClass: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        /// 提交级套餐降级后以实际使用的套餐回写计价快照,保证账实一致。
        ...(ack.providerUnitPoints !== undefined
          ? { providerUnitPoints: ack.providerUnitPoints }
          : {}),
      },
    });
  try {
    const guarded = await callProviderWithHistoricalGuard({
      record: job,
      call: () => provider.createVideoJob({
        providerRequestKey,
        prompt: job.promptText ?? "",
        negativePrompt: job.negativePrompt ?? undefined,
        referenceImages: orderBatchReferenceImages({
          productUrls: assignment.assets.map((asset) => asset.url),
          storyboardUrls: storyboardReferences,
        }),
        /// 批量模板的多张产品图是「视觉真值参考」，不是首尾帧。Seedance 2 必须走
        /// Omni-Reference，否则 4 张不同房间的图会被当 first/last frame 强行变形
        /// 拼接（2026-07-20 真机验收发现的幻觉源头）。Seedance-1/Shuyu 适配器会
        /// 各自忽略或按自身模式处理该字段。
        referenceMode: "reference",
        durationSec: snapshot.lockedParams.duration,
        aspectRatio: snapshot.lockedParams.aspectRatio,
        resolution: snapshot.lockedParams.resolution,
        providerPlanId: snapshot.providerPlanId ?? null,
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
          /// timeoutAt 是提交后的渲染 deadline；回到队列的行不许带着旧钟走，
          /// 否则会在排队时被 sweep 误判超时。
          timeoutAt: null,
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
    acknowledged = {
      providerJobId: created.providerJobId,
      providerId: created.providerId,
      providerUnitPoints: created.providerUnitPoints,
    };
    const updated = await acceptJobSubmission(acknowledged);
    if (updated.count > 0) {
      logStatusTransition({
        taskId: job.id,
        from: VideoJobStatus.QUEUED,
        to: VideoJobStatus.RUNNING,
        reason: `batch_provider_submitted (${created.providerId})`,
      });
      return;
    }
    throw new BatchSubmissionPersistenceLostError();
  } catch (error) {
    /// 0804 取证:同一批「route is not ready」裸文案在多次净进程复现,
    /// 静态检索找不到源——在写入点落完整堆栈定位真实抛出者。
    if (error instanceof Error && /route is not ready/.test(error.message)) {
      console.error("[forensics] not-ready origin", {
        message: error.message,
        stack: error.stack?.split("\n").slice(0, 8).join(" <- "),
        causeMessage: (error as { cause?: Error }).cause?.message,
        causeStack: (error as { cause?: Error }).cause?.stack
          ?.split("\n")
          .slice(0, 6)
          .join(" <- "),
      });
    }
    if (
      acknowledged &&
      !(error instanceof BatchSubmissionPersistenceLostError)
    ) {
      // 提交已确认、只是落库**抛错**（瞬时故障）：重试一次持久化就能救回
      // 真实任务。CAS 干净落空（count=0，行已被并发路径接管）走的是上面的
      // 哨兵错误，不重试——重复同一个 CAS 只会再次落空。
      const recovered = await acceptJobSubmission(acknowledged)
        .catch(() => ({ count: 0 }));
      if (recovered.count > 0) {
        logStatusTransition({
          taskId: job.id,
          from: VideoJobStatus.QUEUED,
          to: VideoJobStatus.RUNNING,
          reason: `batch_provider_submitted_recovered_persistence (${acknowledged.providerId})`,
        });
        return;
      }
    }
    const classified = asProviderSubmissionError({
      error,
      providerId: job.videoRouteSnapshot ?? provider.id,
      evidence: acknowledged
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
        /// 重新排队的行清掉提交期 deadline，避免排队中被 sweep 误判超时；
        /// 已确认的任务号写进失败行，供人工/对账按真实状态处置。
        ...(retryable ? { timeoutAt: null } : {}),
        ...(acknowledgementUnknown && acknowledged
          ? { externalJobId: acknowledged.providerJobId }
          : {}),
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

function batchStoryboardSpec(job: VideoJob): {
  durationSec: 5 | 10 | 15;
  aspectRatio: "9:16" | "16:9" | "1:1";
  sourceAssetIds: string[];
} {
  const snapshot = job.templateSnapshot as unknown as {
    lockedParams?: { duration?: unknown; aspectRatio?: unknown };
  };
  const assignment = assignmentFromJob(job);
  const duration = snapshot.lockedParams?.duration;
  const aspectRatio = snapshot.lockedParams?.aspectRatio;
  if (duration !== 5 && duration !== 10 && duration !== 15) {
    throw new Error(`批量故事板不支持时长 ${String(duration)}`);
  }
  if (aspectRatio !== "9:16" && aspectRatio !== "16:9" && aspectRatio !== "1:1") {
    throw new Error(`批量故事板不支持画幅 ${String(aspectRatio)}`);
  }
  return {
    durationSec: duration,
    aspectRatio,
    sourceAssetIds: assignment.assets.map((asset) => asset.id),
  };
}

/**
 * 批量场景下故事板帧的自动重投上限。
 *
 * 单条创作里失败帧由用户在故事板界面手动重生成；批量没有人盯着，
 * 因此这里代为重试。上限存在的意义是：供应商真的长时间不可用时，
 * 批次应当以失败收敛，而不是无限重投烧积分。
 */
const BATCH_FRAME_MAX_ATTEMPTS = 3;

/**
 * 把可安全重投的失败帧按新 attempt 重投一次。
 *
 * 0728 真机实测：Shuyu 线路繁忙会对部分帧回 502「积分已退回」，4 帧里 3 帧
 * 因此失败、整个故事板 FAILED，而派发闸门要求 storyboardRun=APPROVED，
 * 于是批次永久停在 QUEUED 无人推进。canRegenerateStoryboardFrame 识别可安全
 * 重投的帧（REJECTED / refunded / 无任务号的 ACK_UNKNOWN——0804 真机复现的
 * 悬死根因），批量路径据此自愈；任务号已知的 ACK_UNKNOWN 帧先让 reconcile
 * 查真实状态，本轮不重投。
 */
async function retryRecoverableBatchFrames(batchId: string): Promise<void> {
  const runs = await db.storyboardRun.findMany({
    where: { videoJob: { batchJobId: batchId }, status: "FAILED" },
    select: {
      id: true,
      userId: true,
      frames: {
        where: { isCurrent: true, status: "FAILED" },
        select: {
          id: true,
          attempt: true,
          status: true,
          submissionState: true,
          lastProviderStatus: true,
          externalTaskId: true,
        },
      },
    },
    take: providerConcurrency(),
  });

  for (const run of runs) {
    /// 真实状态可查的帧（ACK_UNKNOWN + 任务号）由 reconcile 复活或落地；
    /// 在事实揭晓前重投别的帧只会白花钱，这条 run 本轮跳过。
    if (
      run.frames.some(
        (frame) =>
          frame.submissionState === ProviderSubmissionState.ACK_UNKNOWN &&
          frame.externalTaskId !== null,
      )
    ) {
      continue;
    }
    const retryable = run.frames.filter(
      (frame) =>
        frame.attempt < BATCH_FRAME_MAX_ATTEMPTS &&
        canRegenerateStoryboardFrame(frame),
    );
    /// 存在无法安全重投的帧（计费状态未确认）时整条留给人工，不碰。
    if (retryable.length === 0 || retryable.length !== run.frames.length) continue;
    for (const frame of retryable) {
      await regenerateStoryboardFrame({
        userId: run.userId,
        runId: run.id,
        frameId: frame.id,
      }).catch((error) => {
        console.warn(JSON.stringify({
          evt: "batch_frame_retry_failed",
          batchId,
          runId: run.id,
          frameId: frame.id,
          error: (error as Error).message.slice(0, 200),
        }));
      });
    }
  }
}

async function advanceBatchStoryboards(batchId: string): Promise<void> {
  /// 顺序即语义：先按合作方真实状态对账（可复活任务号已知的 ACK_UNKNOWN 帧、
  /// 终结提交半途僵死的帧），再重投可安全重投的失败帧，最后把确认救不回的
  /// run 落地成诚实的任务失败——保证 FAILED run + QUEUED job 不会活过一个 tick。
  const runs = await db.storyboardRun.findMany({
    where: {
      videoJob: { batchJobId: batchId },
      OR: [
        { status: "GENERATING" },
        {
          status: "FAILED",
          frames: {
            some: {
              isCurrent: true,
              status: "FAILED",
              submissionState: ProviderSubmissionState.ACK_UNKNOWN,
              externalTaskId: { not: null },
            },
          },
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    select: { id: true },
    take: providerConcurrency(),
  });
  await mapConcurrent(runs, providerConcurrency(), async (run) => {
    await reconcileStoryboardRun(run.id);
  });
  await retryRecoverableBatchFrames(batchId);
  await settleDeadStoryboardBatchJobs(batchId);
}

/**
 * 0804 真机复现的悬死根因收口：storyboardRun FAILED 且既无法对账（没有任务号
 * 可查）也无法安全重投（计费冻结帧 / 重投次数耗尽）时，把仍在排队的 VideoJob
 * 落成诚实失败，而不是让它悬死 QUEUED 等 sweep 用「生成超时」误判。
 *
 * 同时把死掉的 run 从任务上解绑（归档保留，不删）：任务重试后 retryCount 抬升，
 * prepareBatchStoryboards 会用新的幂等键重建全新 run，一键续跑不需要人工 force。
 */
async function settleDeadStoryboardBatchJobs(batchId: string): Promise<void> {
  const runs = await db.storyboardRun.findMany({
    where: {
      status: "FAILED",
      videoJob: {
        batchJobId: batchId,
        status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED] },
      },
    },
    select: {
      id: true,
      videoJobId: true,
      frames: {
        where: { isCurrent: true, status: "FAILED" },
        select: {
          attempt: true,
          status: true,
          submissionState: true,
          lastProviderStatus: true,
          externalTaskId: true,
        },
      },
    },
    take: 50,
  });
  const now = new Date();
  for (const run of runs) {
    if (!run.videoJobId) continue;
    /// 没有失败帧的 FAILED run 是可自愈的残留（advanceRun 会翻正），不落地。
    if (run.frames.length === 0) continue;
    /// 还有事实可查（任务号已知）→ 留给 reconcile。
    if (
      run.frames.some(
        (frame) =>
          frame.submissionState === ProviderSubmissionState.ACK_UNKNOWN &&
          frame.externalTaskId !== null,
      )
    ) {
      continue;
    }
    /// 全部帧都可安全重投 → 留给 retryRecoverableBatchFrames。
    if (
      run.frames.every(
        (frame) =>
          frame.attempt < BATCH_FRAME_MAX_ATTEMPTS &&
          canRegenerateStoryboardFrame(frame),
      )
    ) {
      continue;
    }
    const settled = await db.$transaction(async (tx) => {
      const failedJob = await tx.videoJob.updateMany({
        where: {
          id: run.videoJobId!,
          status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED] },
        },
        data: {
          status: VideoJobStatus.FAILED,
          submissionErrorClass: "storyboard_failed",
          errorMessage: `[storyboard:failed] 故事板锚定失败且无法安全自动重投（runId=${run.id}）`,
          userSafeError:
            "分镜图生成失败，本条视频未提交生成、不产生视频扣费。点击「重试」会重新生成分镜后继续；若反复失败请联系支持核对分镜积分。",
          finishedAt: now,
          availableAt: null,
        },
      });
      /// CAS 落空（任务已被并发路径接管）时不解绑，避免把 run 从
      /// 一个未失败的任务上摘走。
      if (failedJob.count === 0) return failedJob;
      await tx.storyboardRun.updateMany({
        where: { id: run.id, videoJobId: run.videoJobId },
        data: { videoJobId: null },
      });
      return failedJob;
    });
    if (settled.count > 0) {
      logStatusTransition({
        taskId: run.videoJobId,
        from: VideoJobStatus.QUEUED,
        to: VideoJobStatus.FAILED,
        reason: `batch_storyboard_dead_settled (runId=${run.id})`,
      });
    }
  }
}

async function prepareBatchStoryboards(batchId: string, userId: string): Promise<void> {
  const jobs = await db.videoJob.findMany({
    where: {
      batchJobId: batchId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED] },
      videoRouteSnapshot: "buddy",
      storyboardRun: null,
    },
    orderBy: { batchIndex: "asc" },
    take: providerConcurrency(),
  });
  await mapConcurrent(jobs, providerConcurrency(), async (job) => {
    const spec = batchStoryboardSpec(job);
    const run = await createStoryboardRun({
      userId,
      /// 幂等键按 retryCount 分代：settleDeadStoryboardBatchJobs 把死掉的 run
      /// 解绑归档后，用户重试（retryCount+1）会在这里拿到全新的 run，而不是
      /// replay 回那条已判死的旧 run——这是「不靠人工 force 重跑」的另一半。
      idempotencyKey: `batch-storyboard:${job.id}:r${job.retryCount}`,
      prompt: job.promptText ?? "Create a faithful product demonstration.",
      durationSec: spec.durationSec,
      aspectRatio: spec.aspectRatio,
      sourceAssetIds: spec.sourceAssetIds,
      approvalPolicy: "AUTO",
      purpose: `batch-video-storyboard:${job.id}`,
    });
    await attachStoryboardToVideoJob({ userId, runId: run.id, videoJobId: job.id });
  });
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
 * deadline; reconcileVideoJob performs one final provider query, then either
 * collects/keeps a confirmed live task or CAS-fails an unreachable one. This
 * keeps the global concurrency guard strict without discarding paid slow jobs.
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
 * 单个 worker tick：抢租约 → 回收租约 → 批量调和 → 熔断联动 → 按全局并发槽提交 → 放租约。
 * 前端只调用 batch status 端点一次；不会为 N 个任务建立 N 条连接。
 * 多个标签页 / cron 同时 tick 同一批次时只有抢到租约的那个干活，其余直接返回当前行。
 */
export async function processBatchTick(batchId: string): Promise<BatchJob> {
  // This guard intentionally runs before the first DB read. Route-specific
  // credential readiness is checked from the persisted job snapshot below.
  assertProductionMockRuntimeSealed();
  const now = new Date();
  const [batchRow, batchProvider] = await Promise.all([
    db.batchJob.findUnique({
      where: { id: batchId },
      include: { user: { select: { disabledAt: true } } },
    }),
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
  if (!batchRow) throw new BatchNotFoundError();
  const { user: owner, ...batch } = batchRow;
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

  /// 以上全是只读守卫；从这里开始会写库、会调供应商，先抢 tick 租约。
  const leaseOwner = await acquireBatchTickLease(batchId, now);
  if (!leaseOwner) return batch;
  try {
    /// 2.8 停用账号：不再推进排队（不建故事板、不重投帧、不领取、不提交），
    /// 但已提交给合作方的任务照常对账收回素材（铁律 §4.7：保留素材），
    /// 计数照常同步——排队行由停用流程取消后，批次能自然落到终态。
    if (owner?.disabledAt) {
      console.warn(JSON.stringify({
        evt: "batch_tick_owner_disabled",
        batchId,
        userId: batch.userId,
      }));
      await recoverExpiredLeases(batchId, now);
      await reconcileRunningBatchJobs(batchId);
      return await syncBatchCounts(batchId);
    }

    if (batchProvider?.videoRouteSnapshot === "buddy") {
      await advanceBatchStoryboards(batchId);
      await prepareBatchStoryboards(batchId, batch.userId);
      await renewBatchTickLease(batchId, leaseOwner);
    }

    await recoverExpiredLeases(batchId, now);
    if (batchProvider) {
      await expireHardDeadlineProviderSlots(batchProvider.provider, now);
    }
    await reconcileRunningBatchJobs(batchId);
    await syncBatchCounts(batchId);

    const breaker = await evaluateDispatchBreaker(now);
    await applyBreaker(batchId, breaker);
    if (breaker.state === "open") return await syncBatchCounts(batchId);

    /// 派发前确认租约仍在：慢 tick 若已被别的 tick 接手，这里不再领取提交，
    /// 避免两份 tick 同时占用供应商槽位。
    if (!(await renewBatchTickLease(batchId, leaseOwner))) {
      console.warn(JSON.stringify({ evt: "batch_tick_lease_lost", batchId }));
      return await syncBatchCounts(batchId);
    }
    const maxClaims =
      breaker.state === "half_open_probe" ? 1 : providerConcurrency();
    const claimed = await claimJobs({ batchId, maxClaims, now });
    await mapConcurrent(claimed, providerConcurrency(), submitClaimedJob);
    return await syncBatchCounts(batchId);
  } finally {
    await releaseBatchTickLease(batchId, leaseOwner);
  }
}

export interface BatchRetryOptions {
  /// 已返还额度的失败条目再重试要先补扣（D1），补扣按这个会话的豁免与套餐口径。
  /// 脚本不传会话且计量开启时，需要补扣的条目一律拒绝重试。
  session?: Session | null;
}

/// 失败条目翻回排队：复用原素材与模板版本，清掉上一轮的提交 / 终态痕迹。
function batchRetryResetData(): Prisma.VideoJobUpdateManyMutationInput {
  return {
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
    /// 新一轮重新计账：已返还的条目在下方同一事务里补扣，再失败由清扫器重新对账。
    quotaRefundedAt: null,
  };
}

/**
 * 单条失败任务翻回排队。没返还过额度的直接 CAS 重置；已返还的走
 * requeueRefundedBatchJob：补扣与重置同一个 Serializable 事务，额度不足抛
 * QuotaExceededError（任务保持 FAILED）。
 */
async function requeueFailedBatchJob(args: {
  batchId: string;
  job: {
    id: string;
    submissionState: ProviderSubmissionState;
    quotaRefundedAt?: Date | null;
  };
  options: BatchRetryOptions;
  resolveOwnerId: () => Promise<string>;
}): Promise<boolean> {
  const casWhere = (refundedAt: Date | null): Prisma.VideoJobWhereInput => ({
    id: args.job.id,
    batchJobId: args.batchId,
    status: VideoJobStatus.FAILED,
    submissionState: args.job.submissionState,
    quotaRefundedAt: refundedAt,
  });
  if (!args.job.quotaRefundedAt) {
    const result = await db.videoJob.updateMany({
      where: casWhere(null),
      data: batchRetryResetData(),
    });
    return result.count > 0;
  }
  const outcome = await requeueRefundedBatchJob({
    session: args.options.session,
    userId: await args.resolveOwnerId(),
    batchId: args.batchId,
    jobId: args.job.id,
    requeue: async (tx, state) =>
      (
        await tx.videoJob.updateMany({
          where: casWhere(state.refundedAt),
          data: batchRetryResetData(),
        })
      ).count,
  });
  return outcome.requeued;
}

function batchOwnerResolver(batchId: string): () => Promise<string> {
  let ownerId: string | null = null;
  return async () => {
    if (ownerId) return ownerId;
    const batch = await db.batchJob.findUnique({
      where: { id: batchId },
      select: { userId: true },
    });
    if (!batch) throw new BatchNotFoundError();
    ownerId = batch.userId;
    return ownerId;
  };
}

export async function retryFailedBatchJobs(
  batchId: string,
  options: BatchRetryOptions = {},
): Promise<number> {
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
      quotaRefundedAt: true,
    },
  });
  /// 先重试不需要补扣的条目，再逐条补扣已返还的；额度扣不动就停在那里。
  const ordered = [...failed].sort(
    (a, b) => Number(!!a.quotaRefundedAt) - Number(!!b.quotaRefundedAt),
  );
  const resolveOwnerId = batchOwnerResolver(batchId);
  let quotaError: QuotaExceededError | null = null;
  let reset = 0;
  for (const job of ordered) {
    try {
      assertPersistedJobProviderReady(job);
    } catch {
      continue;
    }
    if (!isBillingSafeManualRetry(job)) continue;
    if (job.quotaRefundedAt && quotaError) continue;
    let requeued: boolean;
    try {
      requeued = await requeueFailedBatchJob({
        batchId,
        job,
        options,
        resolveOwnerId,
      });
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        quotaError = error;
        continue;
      }
      if (error instanceof QuotaRechargeUnavailableError) continue;
      throw error;
    }
    if (requeued) {
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
        statusReason: quotaError
          ? `重试 ${reset} 条失败任务；其余已返还额度的条目因本月额度不足未重试`
          : `重试 ${reset} 条失败任务（复用原素材与模板版本）`,
      },
    });
  }
  await syncBatchCounts(batchId);
  /// 一条都没重试成、且是额度挡住的：让路由按额度错误返回，而不是「重试了 0 条」。
  if (reset === 0 && quotaError) throw quotaError;
  return reset;
}

export type RetryFailedBatchJobResult =
  | { outcome: "retried" }
  | { outcome: "not_found" }
  | { outcome: "invalid_state" }
  | { outcome: "billing_unsafe" };

/**
 * 重试单条失败任务。已返还额度的条目先补扣（额度不足抛 QuotaExceededError，
 * 路由按额度错误返回）；脚本没有会话又需要补扣时按 billing_unsafe 拒绝。
 */
export async function retryFailedBatchJob(
  batchId: string,
  jobId: string,
  options: BatchRetryOptions = {},
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
      quotaRefundedAt: true,
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
  let requeued: boolean;
  try {
    requeued = await requeueFailedBatchJob({
      batchId,
      job: { ...job, id: jobId },
      options,
      resolveOwnerId: batchOwnerResolver(batchId),
    });
  } catch (error) {
    if (error instanceof QuotaRechargeUnavailableError) {
      return { outcome: "billing_unsafe" };
    }
    throw error;
  }
  if (!requeued) return { outcome: "invalid_state" };
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

const CANCELLED_IDEMPOTENCY_PREFIX = "cancelled:";

/// 取消即释放幂等键（铁律 §4.7）：改写成 cancelled:<批次id>:<原键>，同一份提交
/// 再来会新建批次，而不是 replay 一个已取消的批次。已改写过的不再改。
export function cancelledBatchIdempotencyKey(
  batchId: string,
  idempotencyKey: string,
): string {
  return idempotencyKey.startsWith(CANCELLED_IDEMPOTENCY_PREFIX)
    ? idempotencyKey
    : `${CANCELLED_IDEMPOTENCY_PREFIX}${batchId}:${idempotencyKey}`;
}

async function releaseBatchIdempotencyKey(batchId: string): Promise<void> {
  const batch = await db.batchJob.findUnique({
    where: { id: batchId },
    select: { idempotencyKey: true },
  });
  if (!batch?.idempotencyKey) return;
  const released = cancelledBatchIdempotencyKey(batchId, batch.idempotencyKey);
  if (released === batch.idempotencyKey) return;
  await db.batchJob.updateMany({
    where: { id: batchId, idempotencyKey: batch.idempotencyKey },
    data: { idempotencyKey: released },
  });
}

/**
 * 取消尚未开始的任务（排队 / 暂停）。已在生成的条目照常收尾，素材全部保留；
 * 取消的条目由清扫器里的对账按条返还额度（D1）。
 */
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
  if (result.count > 0) await releaseBatchIdempotencyKey(batchId);
  await syncBatchCounts(batchId);
  return result.count;
}

class UnauthorizedBatchCancelRace extends Error {}

/**
 * 额度授权失败（额度不足 / 授权事务失败）的批次不能卡在「展开中」：
 * CAS（仍是 EXPANDING 且从未授权）改为已取消、释放幂等键，名下排队任务一并取消
 * 并打上返还标记（从未授权，没有可返还的额度）。授权已经提交的批次 CAS 不命中，原样保留。
 */
export async function cancelUnauthorizedBatch(args: {
  batchId: string;
  userId: string;
  reason: string;
}): Promise<boolean> {
  const now = new Date();
  try {
    return await db.$transaction(async (tx) => {
      const batch = await tx.batchJob.findFirst({
        where: { id: args.batchId, userId: args.userId },
        select: { idempotencyKey: true, cancelledCount: true },
      });
      if (!batch) return false;
      const jobs = await tx.videoJob.updateMany({
        where: {
          batchJobId: args.batchId,
          status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED] },
        },
        data: {
          status: VideoJobStatus.CANCELLED,
          finishedAt: now,
          quotaRefundedAt: now,
          errorMessage: `额度授权未通过，批次未启动：${args.reason}`,
          userSafeError: "已取消：额度授权未通过，未计入额度",
        },
      });
      const cancelled = await tx.batchJob.updateMany({
        where: {
          id: args.batchId,
          userId: args.userId,
          status: BatchJobStatus.EXPANDING,
          quotaConsumedAt: null,
          idempotencyKey: batch.idempotencyKey,
        },
        data: {
          status: BatchJobStatus.CANCELLED,
          idempotencyKey: cancelledBatchIdempotencyKey(
            args.batchId,
            batch.idempotencyKey,
          ),
          statusReason: args.reason,
          queuedCount: 0,
          pausedCount: 0,
          runningCount: 0,
          cancelledCount: batch.cancelledCount + jobs.count,
          finishedAt: now,
        },
      });
      /// 授权已在并发请求里提交（或批次已不在展开中）：整体回滚，任务原样保留。
      if (cancelled.count !== 1) throw new UnauthorizedBatchCancelRace();
      return true;
    });
  } catch (error) {
    if (error instanceof UnauthorizedBatchCancelRace) return false;
    throw error;
  }
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
          storyboardRun: {
            select: {
              id: true,
              status: true,
              approvalPolicy: true,
              frames: {
                where: { isCurrent: true },
                orderBy: { ordinal: "asc" },
                select: {
                  id: true,
                  ordinal: true,
                  status: true,
                  outputUrl: true,
                  outputAsset: { select: { url: true } },
                },
              },
            },
          },
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
    storyboard: {
      id: string;
      status: string;
      approvalPolicy: string;
      frames: Array<{
        id: string;
        ordinal: number;
        status: string;
        imageUrl: string | null;
      }>;
    } | null;
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
        : batch.status === BatchJobStatus.CANCELLED
          ? "批次已取消：已完成的视频保留，未交付的条目不计额度。"
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
      storyboard: job.storyboardRun
        ? {
            id: job.storyboardRun.id,
            status: String(job.storyboardRun.status),
            approvalPolicy: String(job.storyboardRun.approvalPolicy),
            frames: job.storyboardRun.frames.map((frame) => ({
              id: frame.id,
              ordinal: frame.ordinal,
              status: String(frame.status),
              imageUrl: customerHttpUrl(
                frame.outputAsset?.url ?? frame.outputUrl,
              ),
            })),
          }
        : null,
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
  retryRecoverableBatchFrames,
  settleDeadStoryboardBatchJobs,
  prepareBatchStoryboards,
  __setVideoProviderFactoryForTests(
    factory: ((job: Pick<VideoJob, "provider">) => VideoProviderAdapter) | null,
  ): void {
    videoProviderFactoryOverride = factory;
  },
};
