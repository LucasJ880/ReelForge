import { execFile } from "child_process";
import { promisify } from "util";
import { rm } from "fs/promises";
import path from "path";
import {
  Prisma,
  WizardRenderJobMode,
  WizardRenderJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  parseWizardTimeline,
  type WizardClip,
  type WizardTimeline,
} from "@/lib/schemas/wizard-render";
import { requireClientBrief } from "./client-project-service";
import {
  decideWizardRenderMode,
  persistWizardRenderedFile,
  renderWizardTimelineWithFFmpeg,
} from "./wizard-ffmpeg-adapter";
import {
  WIZARD_FALLBACK,
  fallbackReasonWithError,
} from "./wizard-fallback-messages";

const execFileAsync = promisify(execFile);

/**
 * Wizard Render Service —— Phase 2 step 6 的核心。
 *
 * 设计原则（Phase 1.5 强制）：
 * - 不强制真 FFmpeg 成功，否则 wizard 整条线就跑不通；
 * - 三档模式 REAL / DRAFT / MOCK，UI 必须明示当前是哪一档；
 * - 输入是 ScenePlan + Script + RawAsset + ClientBrief 派生出的 timeline，
 *   service 内部把 timeline 持久化到 WizardRenderJob.timeline，便于复盘；
 * - 渲染失败不抛错穿透，而是降级到 DRAFT 或 MOCK，并在 fallbackReason 中说明。
 */

let ffmpegAvailablePromise: Promise<boolean> | null = null;

export async function isFfmpegAvailable(): Promise<boolean> {
  ffmpegAvailablePromise ??= execFileAsync("ffmpeg", ["-version"], {
    maxBuffer: 1024 * 1024,
  })
    .then(() => true)
    .catch(() => false);
  return ffmpegAvailablePromise;
}

/**
 * 决策：当前环境/数据是否允许真 FFmpeg 渲染。
 * 任何一项不满足就降级到 DRAFT。
 *
 * 内部委托给纯函数 decideWizardRenderMode（adapter 中），便于无 IO 单测。
 */
export async function decideRenderMode(params: {
  hasUsableClips: boolean;
  hasAnyClips: boolean;
}): Promise<WizardRenderJobMode> {
  const mode = decideWizardRenderMode({
    hasAnyClips: params.hasAnyClips,
    hasUsableClips: params.hasUsableClips,
    realFlagOn: process.env.ENABLE_WIZARD_FFMPEG_RENDER === "true",
    ffmpegOk: await isFfmpegAvailable(),
  });
  return WizardRenderJobMode[mode];
}

export interface CreateWizardRenderJobInput {
  deliveryOrderId: string;
  /// 客户在 wizard 上选的比例
  aspectRatio?: "9:16" | "1:1" | "16:9";
  /// 选填：调用方已有 timeline 直接传入，否则由 service 从数据库构建
  timeline?: WizardTimeline;
}

/**
 * 入口 1：从 DeliveryOrder 直接创建一个新的 wizard render job 并立即执行。
 * Wizard step 6 的 API 只需要调用这个函数。
 */
export async function createAndRunWizardRender(
  input: CreateWizardRenderJobInput,
) {
  const { deliveryOrderId } = input;
  const brief = await requireClientBrief(deliveryOrderId);

  const aspectRatio = input.aspectRatio ?? defaultAspectRatioFor(brief.targetPlatforms[0]);
  const timeline = input.timeline ?? (await buildTimelineForOrder({
    deliveryOrderId,
    aspectRatio,
  }));

  const validatedTimeline = parseWizardTimeline(timeline);
  const job = await db.wizardRenderJob.create({
    data: {
      deliveryOrderId,
      status: WizardRenderJobStatus.QUEUED,
      mode: WizardRenderJobMode.DRAFT,
      aspectRatio: validatedTimeline.aspectRatio,
      durationSec: Math.max(1, Math.round(validatedTimeline.totalDurationMs / 1000)),
      timeline: validatedTimeline as unknown as Prisma.InputJsonValue,
      briefSnapshot: brief as unknown as Prisma.InputJsonValue,
    },
  });

  return runWizardRenderJob(job.id);
}

/**
 * 入口 2：执行/重试已存在的 job。
 */
export async function runWizardRenderJob(jobId: string) {
  const job = await db.wizardRenderJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("WizardRenderJob 不存在");

  const timeline = parseWizardTimeline(job.timeline);
  const usableClips = timeline.clips.filter((c) => !c.placeholder && c.sourceUrl);
  const mode = await decideRenderMode({
    hasAnyClips: timeline.clips.length > 0,
    hasUsableClips: usableClips.length > 0,
  });

  await db.wizardRenderJob.update({
    where: { id: jobId },
    data: {
      status: WizardRenderJobStatus.RUNNING,
      mode,
      startedAt: new Date(),
      errorMessage: null,
      fallbackReason: null,
    },
  });

  try {
    const result = await executeByMode(mode, { jobId, timeline, usableClips });
    return db.wizardRenderJob.update({
      where: { id: jobId },
      data: {
        status: result.status,
        mode,
        outputVideoUrl: result.outputVideoUrl,
        outputThumbnailUrl: result.outputThumbnailUrl,
        manifestUrl: result.manifestUrl,
        fallbackReason: result.fallbackReason,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    /// 任何阶段抛错都降级到 DRAFT，UI 仍然能看到 manifest，避免 wizard 卡住
    const fallback = await renderDraft(timeline, usableClips, jobId, {
      reasonOverride: fallbackReasonWithError(WIZARD_FALLBACK.renderRealFailedPrefix, err),
    });
    return db.wizardRenderJob.update({
      where: { id: jobId },
      data: {
        status: WizardRenderJobStatus.DRAFT_READY,
        mode: WizardRenderJobMode.DRAFT,
        outputVideoUrl: fallback.outputVideoUrl,
        outputThumbnailUrl: fallback.outputThumbnailUrl,
        manifestUrl: fallback.manifestUrl,
        fallbackReason: fallback.fallbackReason,
        errorMessage: (err as Error).message,
        finishedAt: new Date(),
      },
    });
  }
}

interface RenderResult {
  status: WizardRenderJobStatus;
  outputVideoUrl: string | null;
  outputThumbnailUrl: string | null;
  manifestUrl: string | null;
  fallbackReason: string | null;
}

async function executeByMode(
  mode: WizardRenderJobMode,
  ctx: { jobId: string; timeline: WizardTimeline; usableClips: WizardClip[] },
): Promise<RenderResult> {
  switch (mode) {
    case WizardRenderJobMode.REAL:
      return renderReal(ctx.timeline, ctx.usableClips, ctx.jobId);
    case WizardRenderJobMode.DRAFT:
      return renderDraft(ctx.timeline, ctx.usableClips, ctx.jobId);
    case WizardRenderJobMode.MOCK:
    default:
      return renderMock(ctx.timeline, ctx.jobId);
  }
}

/**
 * Phase 3D：真 FFmpeg 渲染。
 *
 * 流程：
 *   1. 校验有可用 clip；
 *   2. 调用 wizard-ffmpeg-adapter 渲染本地 mp4；
 *   3. 持久化到 Vercel Blob（缺 token 时返回 file:// 路径，仍可在 server-side smoke 验证）；
 *   4. 同时也写一份 manifest（便于回溯 timeline）；
 *   5. 任意阶段抛错 —— 直接 throw 给 caller (runWizardRenderJob)，
 *      由其 catch 后调用 renderDraft 完成 DRAFT_READY 兜底。
 */
async function renderReal(
  timeline: WizardTimeline,
  usableClips: WizardClip[],
  jobId: string,
): Promise<RenderResult> {
  if (usableClips.length === 0) {
    return renderDraft(timeline, usableClips, jobId, {
      reasonOverride: WIZARD_FALLBACK.renderRealNoUsableClips,
    });
  }

  const ffmpegOut = await renderWizardTimelineWithFFmpeg(timeline);
  let videoUrl: string | null = null;
  try {
    videoUrl = await persistWizardRenderedFile(
      ffmpegOut.outputPath,
      `wizard-renders/${jobId}.mp4`,
    );
  } finally {
    /// 无论持久化成功与否，临时目录都清掉
    await rm(path.dirname(ffmpegOut.outputPath), {
      recursive: true,
      force: true,
    }).catch(() => {});
  }

  /// REAL 模式也写 manifest（与 DRAFT 同结构），UI 可以一直可靠地查看 timeline
  const manifest = buildManifest({
    jobId,
    timeline,
    reason: `REAL 模式渲染成功：${ffmpegOut.segmentCount} 个 segment，输出 ${ffmpegOut.aspectRatio}`,
  });
  const manifestUrl = await persistManifest(jobId, manifest);

  return {
    status: WizardRenderJobStatus.SUCCEEDED,
    outputVideoUrl: videoUrl,
    outputThumbnailUrl: null,
    manifestUrl,
    fallbackReason: null,
  };
}

async function renderDraft(
  timeline: WizardTimeline,
  usableClips: WizardClip[],
  jobId: string,
  options?: { reasonOverride?: string },
): Promise<RenderResult> {
  const reason = options?.reasonOverride ?? WIZARD_FALLBACK.renderDraftDefault;
  const manifest = buildManifest({ jobId, timeline, reason });
  const manifestUrl = await persistManifest(jobId, manifest);
  return {
    status: WizardRenderJobStatus.DRAFT_READY,
    outputVideoUrl: usableClips[0]?.sourceUrl ?? null,
    outputThumbnailUrl: null,
    manifestUrl,
    fallbackReason: reason,
  };
}

async function renderMock(
  timeline: WizardTimeline,
  jobId: string,
): Promise<RenderResult> {
  const reason = WIZARD_FALLBACK.renderMockNoAssets;
  const manifest = buildManifest({ jobId, timeline, reason });
  const manifestUrl = await persistManifest(jobId, manifest);
  return {
    status: WizardRenderJobStatus.MOCK,
    outputVideoUrl: null,
    outputThumbnailUrl: null,
    manifestUrl,
    fallbackReason: reason,
  };
}

interface ManifestShape {
  kind: "aivora_wizard_render_manifest";
  jobId: string;
  generatedAt: string;
  reason: string;
  aspectRatio: string;
  totalDurationMs: number;
  timeline: WizardTimeline;
}

function buildManifest(params: {
  jobId: string;
  timeline: WizardTimeline;
  reason: string;
}): ManifestShape {
  return {
    kind: "aivora_wizard_render_manifest",
    jobId: params.jobId,
    generatedAt: new Date().toISOString(),
    reason: params.reason,
    aspectRatio: params.timeline.aspectRatio,
    totalDurationMs: params.timeline.totalDurationMs,
    timeline: params.timeline,
  };
}

/**
 * Manifest 持久化：
 * - 优先 Vercel Blob；
 * - 没有 BLOB_READ_WRITE_TOKEN 时降级为 data: URL —— 仍然可在 UI 直接打开看 JSON。
 */
async function persistManifest(
  jobId: string,
  manifest: ManifestShape,
): Promise<string> {
  const json = JSON.stringify(manifest, null, 2);
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
  }
  /// 动态 import，避免没装/没配 token 时也能跑测试
  try {
    const { put } = await import("@vercel/blob");
    const blob = await put(`wizard-renders/${jobId}.json`, json, {
      access: "public",
      contentType: "application/json",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  } catch {
    return `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
  }
}

/**
 * 从 DeliveryOrder 当前的 ScenePlan + RawAsset + Script + ClientBrief 派生 timeline。
 *
 * 规则：
 * - 按 ScenePlan.sceneIndex 升序排列；
 * - 每个 ScenePlan 优先匹配同 deliveryOrder.rawAssets 里 matchedShotId === scenePlan.id 的素材；
 * - 没匹配到就放占位 clip（placeholder=true，sourceUrl=null），保证 UI 仍能看到结构；
 * - 总时长由 ScenePlan.durationMs 累加。
 */
export async function buildTimelineForOrder(params: {
  deliveryOrderId: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
}): Promise<WizardTimeline> {
  const order = await db.deliveryOrder.findUnique({
    where: { id: params.deliveryOrderId },
    include: {
      rawAssets: true,
      rounds: {
        include: {
          angles: {
            include: {
              videoBrief: {
                include: {
                  scripts: { where: { isCurrent: true }, take: 1 },
                },
              },
            },
          },
        },
        orderBy: { roundIndex: "desc" },
        take: 1,
      },
      selectedCreativeCard: true,
    },
  });
  if (!order) throw new Error("DeliveryOrder 不存在");

  const brief = await requireClientBrief(params.deliveryOrderId);

  /// 找到当前 round 下任一带 script 的 angle，再取它的 ScenePlan
  const round = order.rounds[0];
  const scriptId = round?.angles
    ?.flatMap((angle) => angle.videoBrief?.scripts ?? [])
    ?.find((s) => s)?.id;

  const scenePlans = scriptId
    ? await db.scenePlan.findMany({
        where: { scriptId },
        orderBy: { sceneIndex: "asc" },
      })
    : [];

  /// 把 RawAsset 按 matchedShotId 分组
  type RawAssetRow = (typeof order.rawAssets)[number];
  const assetsByShot = new Map<string, RawAssetRow[]>();
  for (const ra of order.rawAssets) {
    if (!ra.matchedShotId) continue;
    const list = assetsByShot.get(ra.matchedShotId) ?? [];
    list.push(ra);
    assetsByShot.set(ra.matchedShotId, list);
  }

  const fallbackAssets = order.rawAssets.filter(
    (ra: RawAssetRow) => !ra.matchedShotId && ra.url,
  );

  let cursorMs = 0;
  let placeholderCount = 0;
  const clips = scenePlans.length
    ? scenePlans.map((s, idx) => {
        const matched = assetsByShot.get(s.id)?.[0];
        const fallback = fallbackAssets[idx];
        const asset = matched ?? fallback;
        const durationMs = (s.durationSec ?? 4) * 1000;
        const startMs = cursorMs;
        cursorMs += durationMs;
        if (!asset) placeholderCount += 1;
        return {
          sceneIndex: s.sceneIndex,
          rawAssetId: asset?.id ?? null,
          sourceUrl: asset?.url ?? null,
          startMs,
          endMs: cursorMs,
          durationMs,
          captionText: undefined,
          placeholder: !asset,
        };
      })
    : [
        {
          sceneIndex: 1,
          rawAssetId: null,
          sourceUrl: null,
          startMs: 0,
          endMs: (brief.videoLengthSec ?? 30) * 1000,
          durationMs: (brief.videoLengthSec ?? 30) * 1000,
          captionText: brief.keyMessage ?? undefined,
          placeholder: true,
        },
      ];

  if (scenePlans.length === 0) placeholderCount = 1;

  return {
    aspectRatio: params.aspectRatio,
    totalDurationMs:
      cursorMs > 0 ? cursorMs : (brief.videoLengthSec ?? 30) * 1000,
    language: "en",
    clips,
    brand: {
      logoUrl: brief.brandAssets.logoUrl,
      primaryColor: brief.brandAssets.primaryColor,
      accentColor: brief.brandAssets.accentColor,
      ctaText: brief.brandAssets.ctaText,
      websiteUrl: brief.brandAssets.websiteUrl,
      phone: brief.brandAssets.phone,
    },
    voiceoverText: undefined,
    ctaText: brief.brandAssets.ctaText,
    placeholderClipCount: placeholderCount,
  };
}

function defaultAspectRatioFor(platform: string | undefined): "9:16" | "1:1" | "16:9" {
  switch (platform) {
    case "instagram_feed":
      return "1:1";
    case "youtube":
    case "facebook":
    case "website":
      return "16:9";
    case "tiktok":
    case "instagram_reels":
    case "youtube_shorts":
    default:
      return "9:16";
  }
}

/**
 * 工具函数（导出供测试 / API 重用）：直接给定 timeline，决定 mode 并返回 result，但不写库。
 * 用于测试 mode decision 与 manifest 生成是否正确。
 */
export async function dryRunRender(timeline: WizardTimeline) {
  const usableClips = timeline.clips.filter((c) => !c.placeholder && c.sourceUrl);
  const mode = await decideRenderMode({
    hasAnyClips: timeline.clips.length > 0,
    hasUsableClips: usableClips.length > 0,
  });
  const result = await executeByMode(mode, {
    jobId: "dry-run",
    timeline,
    usableClips,
  });
  return { mode, result };
}
