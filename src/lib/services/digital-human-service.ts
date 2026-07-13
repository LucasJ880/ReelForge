/**
 * 数字人探店广告 · 任务状态机服务
 * ==================================================================
 *
 * 与 stitch-service 同构的「外部 runner + claim/complete」模式：
 *   - createDigitalHumanAdJob：商家创建任务（QUEUED）
 *   - claimDigitalHumanAdJob：外部 GH Action runner CAS 领取一条 QUEUED → RENDERING
 *   - completeDigitalHumanAdJob：runner 出片后回调，写 outputVideoUrl + SUCCEEDED/FAILED
 *
 * Vercel 函数不跑 ffmpeg/长任务；真正出片由 scripts/digital-human-runner.ts 在
 * GitHub Actions runner（带 ffmpeg）里跑完整管线（store-ad-pipeline）。
 */
import { DigitalHumanAdJobStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertDigitalHumanFeatureEnabled } from "@/lib/features/digital-human";

export const MAX_DH_ATTEMPTS = 3;

export interface CreateDigitalHumanAdJobInput {
  adminUserId: string;
  avatarAssetUri: string;
  voiceType: string;
  voiceResourceId?: string;
  storeImageUrls: string[];
  industry: string;
  storeDescription?: string | null;
  sellingPoints?: string[];
  cta?: string | null;
  brandName?: string | null;
  durationSec: number;
  aspectRatio?: string;
  deliveryOrderId?: string | null;
}

export async function createDigitalHumanAdJob(
  input: CreateDigitalHumanAdJobInput,
) {
  assertDigitalHumanFeatureEnabled();
  return db.digitalHumanAdJob.create({
    data: {
      adminUserId: input.adminUserId,
      deliveryOrderId: input.deliveryOrderId ?? null,
      avatarAssetUri: input.avatarAssetUri,
      voiceType: input.voiceType,
      voiceResourceId: input.voiceResourceId ?? "seed-tts-2.0",
      storeImageUrls: input.storeImageUrls,
      industry: input.industry,
      storeDescription: input.storeDescription ?? null,
      sellingPoints: input.sellingPoints ?? [],
      cta: input.cta ?? null,
      brandName: input.brandName ?? null,
      durationSec: input.durationSec,
      aspectRatio: input.aspectRatio ?? "9:16",
      status: DigitalHumanAdJobStatus.QUEUED,
    },
  });
}

/** 任务 DTO（前端轮询用，不暴露内部 error 细节） */
export interface DigitalHumanAdJobDTO {
  id: string;
  status: DigitalHumanAdJobStatus;
  outputVideoUrl: string | null;
  outputThumbnailUrl: string | null;
  userSafeError: string | null;
  attempts: number;
  industry: string;
  durationSec: number;
  createdAt: string;
  finishedAt: string | null;
}

export async function getDigitalHumanAdJobForUser(
  id: string,
  adminUserId: string,
  isInternal = false,
): Promise<DigitalHumanAdJobDTO | null> {
  const job = await db.digitalHumanAdJob.findUnique({ where: { id } });
  if (!job) return null;
  if (!isInternal && job.adminUserId !== adminUserId) return null;
  return {
    id: job.id,
    status: job.status,
    outputVideoUrl: job.outputVideoUrl,
    outputThumbnailUrl: job.outputThumbnailUrl,
    userSafeError: job.userSafeError,
    attempts: job.attempts,
    industry: job.industry,
    durationSec: job.durationSec,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function listDigitalHumanAdJobsForUser(adminUserId: string, take = 20) {
  return db.digitalHumanAdJob.findMany({
    where: { adminUserId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export interface ClaimedDigitalHumanAdJob {
  jobId: string;
  avatarAssetUri: string;
  voiceType: string;
  storeImageUrls: string[];
  industry: string;
  storeDescription: string | null;
  sellingPoints: string[];
  cta: string | null;
  brandName: string | null;
  durationSec: number;
  aspectRatio: string;
}

/**
 * 外部 runner 领取一条就绪任务：QUEUED + attempts<MAX，CAS 转 RENDERING。
 * 返回 null 表示当前没有可处理任务。
 */
export async function claimDigitalHumanAdJob(): Promise<ClaimedDigitalHumanAdJob | null> {
  assertDigitalHumanFeatureEnabled();
  const candidates = await db.digitalHumanAdJob.findMany({
    where: {
      status: DigitalHumanAdJobStatus.QUEUED,
      attempts: { lt: MAX_DH_ATTEMPTS },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  for (const job of candidates) {
    const claim = await db.digitalHumanAdJob.updateMany({
      where: { id: job.id, status: DigitalHumanAdJobStatus.QUEUED },
      data: {
        status: DigitalHumanAdJobStatus.RENDERING,
        claimedAt: new Date(),
        startedAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
        userSafeError: null,
      },
    });
    if (claim.count === 0) continue; // 被别的 runner 抢走

    return {
      jobId: job.id,
      avatarAssetUri: job.avatarAssetUri,
      voiceType: job.voiceType,
      storeImageUrls: job.storeImageUrls,
      industry: job.industry,
      storeDescription: job.storeDescription,
      sellingPoints: job.sellingPoints,
      cta: job.cta,
      brandName: job.brandName,
      durationSec: job.durationSec,
      aspectRatio: job.aspectRatio,
    };
  }
  return null;
}

export async function completeDigitalHumanAdJob(args: {
  jobId: string;
  outputVideoUrl?: string | null;
  outputThumbnailUrl?: string | null;
  storyboard?: unknown;
  error?: string | null;
}): Promise<{ ok: boolean; status: DigitalHumanAdJobStatus }> {
  assertDigitalHumanFeatureEnabled();
  const job = await db.digitalHumanAdJob.findUnique({ where: { id: args.jobId } });
  if (!job) return { ok: false, status: DigitalHumanAdJobStatus.FAILED };

  if (args.error || !args.outputVideoUrl) {
    /// 还能重试 → 退回 QUEUED 等下一轮 runner；attempts 已用尽 → FAILED
    const canRetry = job.attempts < MAX_DH_ATTEMPTS;
    await db.digitalHumanAdJob.update({
      where: { id: job.id },
      data: {
        status: canRetry
          ? DigitalHumanAdJobStatus.QUEUED
          : DigitalHumanAdJobStatus.FAILED,
        lastError: args.error ?? "runner 未返回成片 URL",
        userSafeError: "生成失败了，系统会自动重试；多次失败请稍后重新发起或联系客服。",
        finishedAt: canRetry ? null : new Date(),
      },
    });
    return {
      ok: false,
      status: canRetry
        ? DigitalHumanAdJobStatus.QUEUED
        : DigitalHumanAdJobStatus.FAILED,
    };
  }

  await db.digitalHumanAdJob.update({
    where: { id: job.id },
    data: {
      status: DigitalHumanAdJobStatus.SUCCEEDED,
      outputVideoUrl: args.outputVideoUrl,
      outputThumbnailUrl: args.outputThumbnailUrl ?? null,
      storyboard: (args.storyboard ?? undefined) as Prisma.InputJsonValue | undefined,
      lastError: null,
      userSafeError: null,
      finishedAt: new Date(),
    },
  });
  return { ok: true, status: DigitalHumanAdJobStatus.SUCCEEDED };
}
