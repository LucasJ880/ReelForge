/**
 * 抖音发布包（2026-11-09）：成品库里一条已成片的单条视频 → 运营人工发抖音用的一份素材。
 *
 *   文案   起稿走 douyin-copy-service（fast 档 LLM），交给界面编辑；命中极限词不放行。
 *   成片   干净成片过同一个合成器再编码一次：烧入常驻「AI生成」角标；矩阵账号另加 Aivora 尾卡。
 *   封面   成片抽一帧 + 标题字，确定性合成（douyin-cover-compositor）。
 *   登记   发完回来登记账号，同一条成片只能登记给一个账号（publish-service）。
 *
 * 不花生成额度：不碰任何视频 / 出图供应商，只有一次 fast 档文本调用和本进程里的 ffmpeg。
 * 不落新表：素材传对象存储并把 URL 交还界面；唯一落库的是发布登记（PublishRecord）。
 * 每一步都可取消：界面中止请求 → signal 触发 → 合成在下一个检查点停手，已有素材不动。
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "@/lib/db";
import { checkAdLawCopy, type AdLawFieldHit } from "@/lib/compliance/ad-law-terms";
import {
  DOUYIN_PLATFORM,
  type DouyinCopy,
  type DouyinKitAssets,
  type DouyinKitErrorCode,
  type DouyinKitRegistration,
} from "@/lib/contracts/douyin-publish-kit";
import { AIVORA_MATRIX_END_CARD } from "@/lib/brand/brand-end-card-policy";
import { runFfmpeg } from "@/lib/media/ffmpeg-bin";
import { resolveAspectResolution, thumbnailSeekSeconds } from "@/lib/media/stitch-pipeline";
import { fetchMediaBytes } from "@/lib/storage/trusted-media-url";
import { composeDouyinCover } from "@/lib/video-generation/douyin-cover-compositor";
import type { BrandPackagingPlan } from "@/types/video-generation";
import type { PublishRegistrationRow } from "@/lib/services/publish-service";

export class DouyinKitError extends Error {
  constructor(
    readonly code: DouyinKitErrorCode,
    message: string,
    readonly hits: AdLawFieldHit[] = [],
  ) {
    super(message);
    this.name = "DouyinKitError";
  }
}

const MAX_SOURCE_VIDEO_BYTES = 250 * 1024 * 1024;

export interface DouyinKitContext {
  orderId: string;
  briefId: string;
  /** 商家对这条片的描述（成品库标题） */
  title: string;
  rawPrompt: string | null;
  voiceoverScript: string | null;
  /** 干净成片（没有角标 / 尾卡的那条） */
  cleanVideoUrl: string;
  thumbnailUrl: string | null;
  aspectRatio: string;
  durationSec: number | null;
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function readVoiceoverScript(postProduction: unknown): string | null {
  if (!postProduction || typeof postProduction !== "object") return null;
  const audio = (postProduction as Record<string, unknown>).audio;
  if (!audio || typeof audio !== "object") return null;
  return readString((audio as Record<string, unknown>).voiceover, "script");
}

/**
 * 取这条成片做发布包需要的信息。只认本人的单条订单；没成片 / 已下架 → null。
 * id = 成品库详情页的订单 id（与 /api/library/[id]/cancel 同一个口径）。
 */
export async function loadDouyinKitContext(
  userId: string,
  orderId: string,
): Promise<DouyinKitContext | null> {
  const order = await db.deliveryOrder.findFirst({
    where: { id: orderId, createdById: userId, productCategory: "unified_input" },
    select: {
      id: true,
      title: true,
      productInput: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              videoBrief: {
                select: {
                  id: true,
                  aspectRatio: true,
                  durationSec: true,
                  finalVideoUrl: true,
                  finalThumbnailUrl: true,
                  takedownAt: true,
                  finalVideo: {
                    select: {
                      status: true,
                      stitchedVideoUrl: true,
                      thumbnailUrl: true,
                      postProduction: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const brief = order?.rounds[0]?.angles[0]?.videoBrief ?? null;
  if (!order || !brief || brief.takedownAt) return null;
  /// 多段成片必须是 READY（在重拼 / 合成中的不拿半成品去发）；旧单段 brief 没有 FinalVideo，直接用 finalVideoUrl
  const cleanVideoUrl = brief.finalVideo
    ? brief.finalVideo.status === "READY"
      ? brief.finalVideo.stitchedVideoUrl
      : null
    : brief.finalVideoUrl;
  if (!cleanVideoUrl) return null;
  return {
    orderId: order.id,
    briefId: brief.id,
    title: order.title,
    rawPrompt: readString(order.productInput, "rawPrompt"),
    voiceoverScript: readVoiceoverScript(brief.finalVideo?.postProduction ?? null),
    cleanVideoUrl,
    thumbnailUrl: brief.finalVideo?.thumbnailUrl ?? brief.finalThumbnailUrl ?? null,
    aspectRatio: brief.aspectRatio || "9:16",
    durationSec: brief.durationSec ?? null,
  };
}

export function toKitRegistration(row: PublishRegistrationRow): DouyinKitRegistration {
  return {
    id: row.id,
    accountLabel: row.accountLabel,
    status: row.status,
    publishUrl: row.publishUrl,
    note: row.operatorNote,
    registeredAt: (row.publishedAt ?? row.createdAt).toISOString(),
  };
}

/** 矩阵账号的 Aivora 尾卡：只有品牌名和「主页看更多」，没有网址、联系方式、二维码。 */
export function aivoraMatrixEndCardPlan(): BrandPackagingPlan {
  return {
    mode: "auto_end_card",
    logoAssetId: null,
    endCardDurationSeconds: AIVORA_MATRIX_END_CARD.durationSeconds,
    brandName: AIVORA_MATRIX_END_CARD.brandName,
    slogan: null,
    cta: AIVORA_MATRIX_END_CARD.cta,
    contactLines: [],
    website: null,
    renderStrategy: "render_ffmpeg_overlay",
    warnings: [],
  } as BrandPackagingPlan;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DouyinKitError("CANCELLED", "已取消，之前生成的素材保留不动。");
}

async function uploadKitFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const { getStorageProvider } = await import("@/lib/storage");
  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    throw new DouyinKitError(
      "RENDER_FAILED",
      `对象存储（${storage.id}）没有配置，发布素材无处存放。`,
    );
  }
  const object = await storage.uploadBuffer("renders", buffer, {
    key,
    access: "public",
    contentType,
    overwrite: true,
  });
  return object.url;
}

/**
 * 产出导出素材：封面恒做；includeVideo 时再出发布版成片。
 * @throws DouyinKitError AD_LAW_TERMS（文案命中极限词，不产出任何素材）/ CANCELLED / RENDER_FAILED
 */
export async function renderDouyinKitAssets(args: {
  context: DouyinKitContext;
  copy: DouyinCopy;
  includeVideo: boolean;
  /** 矩阵账号才加 Aivora 尾卡（由路由按服务端名单判定后传入） */
  matrixAccount: boolean;
  signal?: AbortSignal;
}): Promise<DouyinKitAssets> {
  const { context, copy } = args;
  const adLaw = checkAdLawCopy(copy);
  if (!adLaw.ok) {
    throw new DouyinKitError(
      "AD_LAW_TERMS",
      `文案里有广告法极限词：${adLaw.terms.join("、")}。改掉之后才能导出。`,
      adLaw.hits,
    );
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "aivora-douyin-kit-"));
  const stamp = Date.now().toString(36);
  try {
    // 1) 干净成片下载一次：封面抽帧与发布版成片共用
    throwIfCancelled(args.signal);
    const sourcePath = path.join(workDir, "source.mp4");
    await writeFile(
      sourcePath,
      await fetchMediaBytes(context.cleanVideoUrl, {
        maxBytes: MAX_SOURCE_VIDEO_BYTES,
        followRedirects: true,
      }),
    );

    // 2) 封面：抽一帧（原分辨率）→ 叠标题字
    throwIfCancelled(args.signal);
    const framePath = path.join(workDir, "frame.png");
    await runFfmpeg(
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        thumbnailSeekSeconds(context.durationSec).toFixed(3),
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        framePath,
      ],
      { timeoutMs: 30_000, killSignal: "SIGKILL" },
    );
    const { width, height } = resolveAspectResolution(context.aspectRatio);
    const cover = await composeDouyinCover({
      frame: await readFile(framePath),
      title: copy.title,
      width,
      height,
    });
    const coverUrl = await uploadKitFile(
      `douyin-kits/${context.briefId}/cover-${stamp}.jpg`,
      cover.jpeg,
      "image/jpeg",
    );

    if (!args.includeVideo) return { videoUrl: null, coverUrl, endCard: false };

    // 3) 发布版成片：同一个合成器再编码一次，烧入常驻「AI生成」角标；矩阵账号接一张 Aivora 尾卡
    throwIfCancelled(args.signal);
    /// 动态 import：stitch-service 很重（Prisma + 合成器全家），只有真要出片时才加载
    const { composeAndPersistTimeline } = await import("@/lib/services/stitch-service");
    const clips: Parameters<typeof composeAndPersistTimeline>[0]["clips"] = [
      { url: pathToFileURL(sourcePath).href, intendedDurationSec: null, trimToFit: false },
    ];
    if (args.matrixAccount) {
      const { renderBrandEndCard } = await import("@/lib/video-generation/brand-end-card-renderer");
      const plan = aivoraMatrixEndCardPlan();
      const endCard = await renderBrandEndCard(
        { briefId: `douyin-kit-${context.briefId}`, plan, aspectRatio: context.aspectRatio },
        { forceLocal: true },
      );
      if (!endCard?.url) {
        throw new DouyinKitError(
          "RENDER_FAILED",
          `Aivora 尾卡渲染失败：${endCard?.warnings.at(-1) ?? "渲染器没有返回结果"}`,
        );
      }
      clips.push({
        url: endCard.url,
        intendedDurationSec: plan.endCardDurationSeconds,
        trimToFit: true,
        role: "end_card",
        excludeFromCaptions: true,
      });
    }
    const composed = await composeAndPersistTimeline({
      finalVideoId: `douyin-kit-${context.briefId}`,
      aspectRatio: context.aspectRatio,
      clips,
      postProduction: null,
      platform: DOUYIN_PLATFORM,
      aiBadge: true,
      checkpoint: async () => throwIfCancelled(args.signal),
    });
    return { videoUrl: composed.stitchedVideoUrl, coverUrl, endCard: args.matrixAccount };
  } catch (err) {
    if (err instanceof DouyinKitError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[douyin-kit] render failed", { briefId: context.briefId, error: detail });
    throw new DouyinKitError("RENDER_FAILED", `发布素材生成失败：${detail.slice(0, 200)}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
