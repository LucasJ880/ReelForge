import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  AngleType,
  DeliveryOrderStatus,
  FinalVideoStatus,
  RoundStatus,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import { postProductionPlanSchema } from "@/lib/schemas/unified-input";
import type { PostProductionPlan } from "@/types/video-generation";
import {
  buildBrollPlan,
  missingSegments,
  pickFootageForPlan,
  BrollPlanError,
  type BrollPick,
  type BrollPlan,
} from "@/lib/services/broll-plan-service";
import {
  isOpenAiTtsAvailable,
  synthesizeVoiceover,
} from "@/lib/providers/openai-tts";
import { isStockFootageAvailable } from "@/lib/providers/stock-footage";
import { runFfmpegNormalizeAndConcatWithPostProduction } from "@/lib/services/stitch-service";
import {
  brollAspectResolution,
  brollSegmentDurationSec,
  buildBrollComposeArgs,
} from "@/lib/video-generation/broll-segment-compose";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";

/**
 * b-roll 第三条线路 · 编排层（2026-08-02 接通，计划见
 * docs/roadmap/2026-08-02-broll-assembly-plan.md）。
 *
 * 口播稿 → 拆镜头段（broll-plan-service）→ 图库选片（Pexels/Pixabay）→
 * 逐段 TTS + ffmpeg 合成段 → 复用主线 stitch 后期（拼接/字幕/BGM 闪避/SRT）→
 * 建 DeliveryOrder→…→FinalVideo 数据链，成品库直接可见。
 *
 * 纪律：
 * - **先合成、后建链**：任何一步失败都不在库里留半截记录。
 * - **缺段即整单失败**（missingSegments）：绝不交付缺一段的片。
 * - 段音轨 = TTS，丢弃图库素材原声（环境声嘈杂 + 背景音乐版权风险）；
 *   BGM 由成片级后期做人声闪避混入，不在段内混。
 * - 段时长由口播驱动：max(2s, TTS 实测时长 + 呼吸间隙)。时长一律 ffprobe
 *   实测，不用语速估算（中英混排误差可达 ±40%）。
 */

export type BrollAspectRatio = "9:16" | "16:9";

export type ComposedBrollSegment = {
  order: number;
  narration: string;
  searchTerm: string;
  /// 已烘入 TTS 音轨、已按目标画幅归一化的段视频（Blob URL）
  url: string;
  durationSec: number;
  /// 素材溯源（图库许可虽不强制署名，被平台问「素材哪来的」要答得出）
  stock: {
    id: string;
    provider: string;
    creator: string | null;
    sourcePageUrl: string | null;
  };
};

export type ComposeBrollResult = {
  plan: BrollPlan;
  segments: ComposedBrollSegment[];
  /// 首段首帧，作成品缩略图
  thumbnailUrl: string | null;
};

export function isBrollRouteAvailable(): boolean {
  return isStockFootageAvailable() && isOpenAiTtsAvailable();
}

function aspectToStock(aspect: BrollAspectRatio): "portrait" | "landscape" {
  return aspect === "9:16" ? "portrait" : "landscape";
}

/// 与 runner 共用的纯模块统一供给（两端 ffmpeg 参数不漂移）
export const segmentDurationSec = brollSegmentDurationSec;

async function probeDurationSec(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe 读不到时长：${path.basename(filePath)}`);
  }
  return duration;
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`素材下载失败：HTTP ${res.status}`);
  }
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
}

/**
 * 单段合成：图库素材 + TTS 音轨 → 归一化段视频。
 *
 * `-stream_loop -1` 让素材短于口播时循环补长；`apad` 让音轨补齐到视频尾；
 * 输出统一 1080 档 / 30fps / H.264+AAC，与主线段规格一致，
 * 后续 stitch 的归一化因此几乎是直通。
 */
async function composeSegmentFile(args: {
  clipPath: string;
  ttsPath: string;
  outPath: string;
  aspect: BrollAspectRatio;
  targetDurationSec: number;
}): Promise<void> {
  const { width, height } = brollAspectResolution(args.aspect);
  await execFileAsync(
    FFMPEG_BIN,
    buildBrollComposeArgs({
      clipPath: args.clipPath,
      ttsPath: args.ttsPath,
      outPath: args.outPath,
      width,
      height,
      targetDurationSec: args.targetDurationSec,
    }),
    { maxBuffer: 1024 * 1024 * 50, timeout: 120_000 },
  );
}

async function extractThumbnail(
  segmentPath: string,
  outPath: string,
): Promise<void> {
  await execFileAsync(
    FFMPEG_BIN,
    ["-y", "-loglevel", "error", "-ss", "0.3", "-i", segmentPath, "-frames:v", "1", "-q:v", "3", outPath],
    { maxBuffer: 1024 * 1024 * 10, timeout: 30_000 },
  );
}

/**
 * 口播稿 → 已合成段清单（全部落 Blob）。
 * 纯合成，不碰数据库；失败抛错，调用方决定是否重试。
 */
export async function composeBrollSegments(args: {
  script: string;
  aspectRatio: BrollAspectRatio;
  voiceId?: string | null;
}): Promise<ComposeBrollResult> {
  if (!isOpenAiTtsAvailable()) {
    throw new BrollPlanError(
      "TTS 配音尚未接入（缺 OPENAI_API_KEY 的 tts 权限）",
      "footage_unavailable",
    );
  }

  const plan = await buildBrollPlan({
    script: args.script,
    aspect: aspectToStock(args.aspectRatio),
  });
  const picks = await pickFootageForPlan({ plan });
  const missing = missingSegments(picks);
  if (missing.length > 0) {
    throw new BrollPlanError(
      `第 ${missing.map((i) => i + 1).join("、")} 段没搜到可用素材，请调整口播稿或换个说法`,
      "footage_unavailable",
    );
  }

  const runId = randomUUID();
  const tmpDir = path.join(os.tmpdir(), `aivora-broll-${runId}`);
  await mkdir(tmpDir, { recursive: true });
  const storage = getStorageProvider();

  try {
    const segments: ComposedBrollSegment[] = [];
    let thumbnailUrl: string | null = null;

    for (const pick of picks as BrollPick[]) {
      const i = pick.segment.order;
      const clip = pick.candidates[0];

      const ttsPath = path.join(tmpDir, `tts-${i}.mp3`);
      const audio = await synthesizeVoiceover({
        text: pick.segment.narration,
        voiceId: args.voiceId,
      });
      await writeFile(ttsPath, audio);
      const ttsDuration = await probeDurationSec(ttsPath);
      const targetDuration = segmentDurationSec(ttsDuration);

      const clipExt = path.extname(new URL(clip.downloadUrl).pathname) || ".mp4";
      const clipPath = path.join(tmpDir, `clip-${i}${clipExt}`);
      await downloadToFile(clip.downloadUrl, clipPath);

      const outPath = path.join(tmpDir, `seg-${i}.mp4`);
      await composeSegmentFile({
        clipPath,
        ttsPath,
        outPath,
        aspect: args.aspectRatio,
        targetDurationSec: targetDuration,
      });

      const uploaded = await storage.uploadBuffer(
        "renders",
        await readFile(outPath),
        {
          key: `broll/${runId}/seg-${i}.mp4`,
          access: "public",
          contentType: "video/mp4",
          overwrite: true,
        },
      );

      if (i === 0) {
        const thumbPath = path.join(tmpDir, "thumb.jpg");
        await extractThumbnail(outPath, thumbPath);
        const thumb = await storage.uploadBuffer(
          "renders",
          await readFile(thumbPath),
          {
            key: `broll/${runId}/thumb.jpg`,
            access: "public",
            contentType: "image/jpeg",
            overwrite: true,
          },
        );
        thumbnailUrl = thumb.url;
      }

      segments.push({
        order: i,
        narration: pick.segment.narration,
        searchTerm: pick.segment.searchTerm,
        url: uploaded.url,
        durationSec: targetDuration,
        stock: {
          id: clip.id,
          provider: clip.provider,
          creator: clip.creator,
          sourcePageUrl: clip.sourcePageUrl,
        },
      });
    }

    return { plan, segments, thumbnailUrl };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function hasCjk(text: string): boolean {
  return /[一-鿿]/.test(text);
}

export function buildBrollPostProduction(args: {
  script: string;
  voiceId: string;
  bgmTrackId: "none" | "wholesome";
  captionsEnabled: boolean;
}): PostProductionPlan {
  return postProductionPlanSchema.parse({
    audio: {
      /// enabled=false 是刻意的：口播已烘进段音轨（成片的「原生音轨」），
      /// 后期绝不再叠一层 TTS —— 与 Shuyu 原生口播同一纪律。
      /// script 仍要写全：确定性字幕以它为文本源。
      voiceover: {
        enabled: false,
        voiceId: args.voiceId,
        language: hasCjk(args.script) ? "zh" : "en",
        script: args.script,
      },
      bgm: {
        trackId: args.bgmTrackId,
        volume: args.bgmTrackId === "none" ? 0 : 0.22,
      },
    },
    captions: {
      enabled: args.captionsEnabled,
      style: "plain",
      language: hasCjk(args.script) ? "zh" : "en",
      position: "bottom",
      exportSrt: true,
    },
  });
}

export type BrollDeliveryResult = {
  orderId: string;
  briefId: string;
  finalVideoId: string;
  stitchedVideoUrl: string;
  subtitleFileUrl: string | null;
  segmentCount: number;
  totalDurationSec: number;
};

/**
 * b-roll 全链交付：合成段 → 成片后期 → 数据链入库（成品库可见）。
 *
 * 记录链与主线一致（Order→Round→Angle→Brief→VideoJob→FinalVideo），
 * `productInput.source = "broll_route"` 供审计与赛马归因识别线路。
 * 整链在成片就绪后一次性建成（全 READY），没有中间态可卡。
 */
export async function createBrollDelivery(args: {
  userId: string;
  script: string;
  aspectRatio: BrollAspectRatio;
  title?: string;
  voiceId?: string;
  bgmTrackId?: "none" | "wholesome";
  captionsEnabled?: boolean;
}): Promise<BrollDeliveryResult> {
  const voiceId = args.voiceId ?? "warm-confident";
  const bgmTrackId = args.bgmTrackId ?? "none";
  const captionsEnabled = args.captionsEnabled ?? true;

  const composed = await composeBrollSegments({
    script: args.script,
    aspectRatio: args.aspectRatio,
    voiceId,
  });
  const totalDurationSec = Math.round(
    composed.segments.reduce((sum, seg) => sum + seg.durationSec, 0),
  );

  const postProduction = buildBrollPostProduction({
    script: args.script,
    voiceId,
    bgmTrackId,
    captionsEnabled,
  });

  /// FinalVideo id 预生成：后期函数用它命名 Blob 路径，建链时按同 id 落库。
  const finalVideoId = `broll_${randomUUID()}`;
  const { stitchedVideoUrl, subtitleFileUrl } =
    await runFfmpegNormalizeAndConcatWithPostProduction({
      finalVideoId,
      aspectRatio: args.aspectRatio,
      clips: composed.segments.map((seg) => ({
        url: seg.url,
        intendedDurationSec: seg.durationSec,
        /// 段在合成时已精确到目标时长，这里不再截断
        trimToFit: false,
      })),
      postProduction,
    });

  const title =
    args.title?.trim() ||
    `${composed.segments[0]?.narration.slice(0, 40) ?? "b-roll"}（实拍图库）`;

  const now = new Date();
  const created = await db.$transaction(async (tx) => {
    const order = await tx.deliveryOrder.create({
      data: {
        title,
        status: DeliveryOrderStatus.ROUND_ACTIVE,
        productCategory: "unified_input",
        targetPlatform: "generic",
        targetCountry: hasCjk(args.script) ? "CN" : "US",
        targetLanguage: hasCjk(args.script) ? "zh" : "en",
        productInput: {
          source: "broll_route",
          requestOrigin: "service",
          rawPrompt: args.script,
          stockAttribution: composed.segments.map((seg) => seg.stock),
        },
        maxRounds: 3,
        createdById: args.userId,
      },
    });

    const round = await tx.round.create({
      data: {
        deliveryOrderId: order.id,
        roundIndex: 1,
        status: RoundStatus.ANGLES_READY,
        optimizationSlots: 1,
        explorationSlots: 0,
        startedAt: now,
      },
    });

    const angle = await tx.contentAngle.create({
      data: {
        roundId: round.id,
        sortOrder: 0,
        type: AngleType.OPTIMIZATION,
        title: title.slice(0, 200),
        hook: composed.segments[0]?.narration ?? args.script.slice(0, 200),
        narrative: args.script,
        localeNotes: { route: "broll" },
      },
    });

    const finalVideo = await tx.finalVideo.create({
      data: {
        id: finalVideoId,
        targetDurationSec: totalDurationSec,
        segmentCount: composed.segments.length,
        status: FinalVideoStatus.READY,
        stitchedVideoUrl,
        thumbnailUrl: composed.thumbnailUrl,
        subtitleFileUrl,
        postProduction: postProduction as unknown as object,
        startedAt: now,
        finishedAt: new Date(),
      },
    });

    const brief = await tx.videoBrief.create({
      data: {
        contentAngleId: angle.id,
        status: VideoBriefStatus.QA_PENDING,
        durationSec: totalDurationSec,
        targetDurationSec: totalDurationSec,
        aspectRatio: args.aspectRatio,
        tone: voiceId,
        finalVideoId: finalVideo.id,
        finalVideoUrl: stitchedVideoUrl,
        finalThumbnailUrl: composed.thumbnailUrl,
      },
    });

    for (const seg of composed.segments) {
      await tx.videoJob.create({
        data: {
          videoBriefId: brief.id,
          finalVideoId: finalVideo.id,
          segmentIndex: seg.order,
          segmentDurationSec: Math.round(seg.durationSec),
          provider: VideoProvider.FFMPEG_EDIT,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: seg.url,
          promptText: seg.narration,
          assignedAssets: { stock: seg.stock, searchTerm: seg.searchTerm },
          finishedAt: now,
        },
      });
    }

    return { orderId: order.id, briefId: brief.id };
  });

  return {
    orderId: created.orderId,
    briefId: created.briefId,
    finalVideoId,
    stitchedVideoUrl,
    subtitleFileUrl,
    segmentCount: composed.segments.length,
    totalDurationSec,
  };
}

/* ────────────────────────────────────────────────────────────────
 * 异步链（创作页 UI 通道，2026-08-02 二期）：
 * Vercel 函数没有 ffmpeg/ffprobe，所以提交层只做纯 HTTP 工作
 * （拆段 / 选片 / TTS / 上传），ffmpeg 全量活交给 stitch runner 的
 * broll 分支（外部 GH Action）或本地 dev 的进程内分支。
 * ──────────────────────────────────────────────────────────────── */

export type PreparedBrollSegment = {
  order: number;
  narration: string;
  searchTerm: string;
  /// 图库素材原片 URL（未合成）
  clipUrl: string;
  /// 该段口播 TTS 音频（已上传 Blob）
  ttsAudioUrl: string;
  stock: ComposedBrollSegment["stock"];
};

/**
 * 提交层准备（Vercel 安全：无 ffmpeg / 无 ffprobe）。
 * 段时长在合成端用 ffprobe 实测，这里不估不猜。
 */
export async function prepareBrollInputs(args: {
  script: string;
  aspectRatio: BrollAspectRatio;
  voiceId?: string | null;
}): Promise<{ runId: string; plan: BrollPlan; prepared: PreparedBrollSegment[] }> {
  if (!isOpenAiTtsAvailable()) {
    throw new BrollPlanError(
      "TTS 配音尚未接入（缺 OPENAI_API_KEY 的 tts 权限）",
      "footage_unavailable",
    );
  }
  const plan = await buildBrollPlan({
    script: args.script,
    aspect: aspectToStock(args.aspectRatio),
  });
  const picks = await pickFootageForPlan({ plan });
  const missing = missingSegments(picks);
  if (missing.length > 0) {
    throw new BrollPlanError(
      `第 ${missing.map((i) => i + 1).join("、")} 段没搜到可用素材，请调整口播稿或换个说法`,
      "footage_unavailable",
    );
  }

  const runId = randomUUID();
  const storage = getStorageProvider();
  const prepared: PreparedBrollSegment[] = [];
  for (const pick of picks) {
    const clip = pick.candidates[0];
    const audio = await synthesizeVoiceover({
      text: pick.segment.narration,
      voiceId: args.voiceId,
    });
    const uploaded = await storage.uploadBuffer("renders", audio, {
      key: `broll/${runId}/tts-${pick.segment.order}.mp3`,
      access: "public",
      contentType: "audio/mpeg",
      overwrite: true,
    });
    prepared.push({
      order: pick.segment.order,
      narration: pick.segment.narration,
      searchTerm: pick.segment.searchTerm,
      clipUrl: clip.downloadUrl,
      ttsAudioUrl: uploaded.url,
      stock: {
        id: clip.id,
        provider: clip.provider,
        creator: clip.creator,
        sourcePageUrl: clip.sourcePageUrl,
      },
    });
  }
  return { runId, plan, prepared };
}

/// 提交时的展示估算：中文口播约 4.5 字/秒。真实时长由合成端 ffprobe 实测。
export function estimateSegmentSec(narration: string): number {
  return Math.max(2, Math.ceil(narration.length / 4.5));
}

export type StartBrollDeliveryResult = {
  orderId: string;
  briefId: string;
  finalVideoId: string;
  segmentCount: number;
  estimatedDurationSec: number;
};

/**
 * UI 提交入口：准备输入 → 建 PENDING 数据链 → 交给 stitch 状态机。
 *
 * 建链后立即返回；合成由 stitchFinalVideo 推进（本地 dev 进程内跑，
 * 生产等 stitch-dispatch cron 派 GH runner）。成品库「生产线上」段
 * 立刻可见，取消走 cancelBrollDelivery。
 */
export async function startBrollDelivery(args: {
  userId: string;
  script: string;
  aspectRatio: BrollAspectRatio;
  title?: string;
  voiceId?: string;
  bgmTrackId?: "none" | "wholesome";
  captionsEnabled?: boolean;
}): Promise<StartBrollDeliveryResult> {
  const voiceId = args.voiceId ?? "warm-confident";
  const bgmTrackId = args.bgmTrackId ?? "none";
  const captionsEnabled = args.captionsEnabled ?? true;

  const { prepared } = await prepareBrollInputs({
    script: args.script,
    aspectRatio: args.aspectRatio,
    voiceId,
  });
  const estimatedDurationSec = prepared.reduce(
    (sum, seg) => sum + estimateSegmentSec(seg.narration),
    0,
  );
  const postProduction = buildBrollPostProduction({
    script: args.script,
    voiceId,
    bgmTrackId,
    captionsEnabled,
  });
  const title =
    args.title?.trim() ||
    `${prepared[0]?.narration.slice(0, 40) ?? "b-roll"}（实拍图库）`;
  const finalVideoId = `broll_${randomUUID()}`;
  const now = new Date();

  const created = await db.$transaction(async (tx) => {
    const order = await tx.deliveryOrder.create({
      data: {
        title,
        status: DeliveryOrderStatus.ROUND_ACTIVE,
        productCategory: "unified_input",
        targetPlatform: "generic",
        targetCountry: hasCjk(args.script) ? "CN" : "US",
        targetLanguage: hasCjk(args.script) ? "zh" : "en",
        productInput: {
          source: "broll_route",
          requestOrigin: "web_app",
          rawPrompt: args.script,
          stockAttribution: prepared.map((seg) => seg.stock),
        },
        maxRounds: 3,
        createdById: args.userId,
      },
    });
    const round = await tx.round.create({
      data: {
        deliveryOrderId: order.id,
        roundIndex: 1,
        status: RoundStatus.ANGLES_READY,
        optimizationSlots: 1,
        explorationSlots: 0,
        startedAt: now,
      },
    });
    const angle = await tx.contentAngle.create({
      data: {
        roundId: round.id,
        sortOrder: 0,
        type: AngleType.OPTIMIZATION,
        title: title.slice(0, 200),
        hook: prepared[0]?.narration ?? args.script.slice(0, 200),
        narrative: args.script,
        localeNotes: { route: "broll" },
      },
    });
    const finalVideo = await tx.finalVideo.create({
      data: {
        id: finalVideoId,
        targetDurationSec: estimatedDurationSec,
        segmentCount: prepared.length,
        status: FinalVideoStatus.PENDING,
        postProduction: postProduction as unknown as object,
      },
    });
    const brief = await tx.videoBrief.create({
      data: {
        contentAngleId: angle.id,
        status: VideoBriefStatus.RENDER_SUCCEEDED,
        durationSec: estimatedDurationSec,
        targetDurationSec: estimatedDurationSec,
        aspectRatio: args.aspectRatio,
        tone: voiceId,
        videoRouteSnapshot: "broll",
        finalVideoId: finalVideo.id,
      },
    });
    for (const seg of prepared) {
      await tx.videoJob.create({
        data: {
          videoBriefId: brief.id,
          finalVideoId: finalVideo.id,
          segmentIndex: seg.order,
          segmentDurationSec: estimateSegmentSec(seg.narration),
          provider: VideoProvider.FFMPEG_EDIT,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: seg.clipUrl,
          promptText: seg.narration,
          assignedAssets: {
            broll: {
              ttsAudioUrl: seg.ttsAudioUrl,
              narration: seg.narration,
              searchTerm: seg.searchTerm,
              stock: seg.stock,
            },
          },
          finishedAt: now,
        },
      });
    }
    return { orderId: order.id, briefId: brief.id };
  });

  /// 本地 dev：进程内直接推进（fire-and-forget，dev server 常驻）。
  /// 生产：stitch-dispatch cron 会派 GH runner，这里不阻塞请求。
  if (process.env.NODE_ENV !== "production") {
    const { stitchFinalVideo } = await import("@/lib/services/stitch-service");
    void stitchFinalVideo(finalVideoId).catch((err) => {
      console.error("[broll] 本地 stitch 推进失败:", (err as Error).message);
    });
  }

  return {
    orderId: created.orderId,
    briefId: created.briefId,
    finalVideoId,
    segmentCount: prepared.length,
    estimatedDurationSec,
  };
}

/** VideoJob.assignedAssets 里的 broll 输入标记。 */
export function readBrollJobInput(assignedAssets: unknown): {
  ttsAudioUrl: string;
  narration: string;
} | null {
  if (!assignedAssets || typeof assignedAssets !== "object") return null;
  const broll = (assignedAssets as { broll?: unknown }).broll;
  if (!broll || typeof broll !== "object") return null;
  const value = broll as { ttsAudioUrl?: unknown; narration?: unknown };
  if (typeof value.ttsAudioUrl !== "string" || !value.ttsAudioUrl) return null;
  return {
    ttsAudioUrl: value.ttsAudioUrl,
    narration: typeof value.narration === "string" ? value.narration : "",
  };
}

/**
 * 本地运行时的 b-roll 合成（stitchFinalVideo 的 broll 分支调用；
 * 调用方负责 PENDING→STITCHING 的 CAS 与结果落库）。
 * 逐段：下载素材+TTS → ffprobe 实测 → 合成；然后走既有拼接后期。
 * 合成段以 file:// 直通拼接（downloadToFile 原生支持），不重复上传。
 */
export async function stitchBrollLocally(args: {
  finalVideoId: string;
  aspectRatio: string;
  postProduction: PostProductionPlan | null;
  segments: Array<{
    segmentIndex: number;
    clipUrl: string;
    ttsAudioUrl: string;
  }>;
}): Promise<{
  stitchedVideoUrl: string;
  subtitleFileUrl: string | null;
  thumbnailUrl: string | null;
}> {
  const aspect: BrollAspectRatio =
    args.aspectRatio === "16:9" ? "16:9" : "9:16";
  const tmpDir = path.join(
    os.tmpdir(),
    `aivora-broll-local-${args.finalVideoId}`,
  );
  await mkdir(tmpDir, { recursive: true });
  try {
    const clips: Array<{ url: string; intendedDurationSec: number | null; trimToFit: boolean }> = [];
    let thumbnailUrl: string | null = null;
    const ordered = [...args.segments].sort(
      (a, b) => a.segmentIndex - b.segmentIndex,
    );
    for (const seg of ordered) {
      const i = seg.segmentIndex;
      const ttsPath = path.join(tmpDir, `tts-${i}.mp3`);
      const clipPath = path.join(tmpDir, `clip-${i}.mp4`);
      await downloadToFile(seg.ttsAudioUrl, ttsPath);
      await downloadToFile(seg.clipUrl, clipPath);
      const ttsDuration = await probeDurationSec(ttsPath);
      const targetDuration = segmentDurationSec(ttsDuration);
      const outPath = path.join(tmpDir, `seg-${i}.mp4`);
      await composeSegmentFile({
        clipPath,
        ttsPath,
        outPath,
        aspect,
        targetDurationSec: targetDuration,
      });
      if (clips.length === 0) {
        const thumbPath = path.join(tmpDir, "thumb.jpg");
        await extractThumbnail(outPath, thumbPath);
        const storage = getStorageProvider();
        const thumb = await storage.uploadBuffer(
          "renders",
          await readFile(thumbPath),
          {
            key: `broll/${args.finalVideoId}/thumb.jpg`,
            access: "public",
            contentType: "image/jpeg",
            overwrite: true,
          },
        );
        thumbnailUrl = thumb.url;
      }
      clips.push({
        url: `file://${outPath}`,
        intendedDurationSec: targetDuration,
        trimToFit: false,
      });
    }

    const result = await runFfmpegNormalizeAndConcatWithPostProduction({
      finalVideoId: args.finalVideoId,
      aspectRatio: aspect,
      clips,
      postProduction: args.postProduction,
    });
    return { ...result, thumbnailUrl };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export type CancelBrollResult =
  | { ok: true; state: "cancelled" }
  | { ok: false; reason: "not_found" | "not_broll" | "already_finished" };

/**
 * 取消（铁律 #7）：素材与已上传输入全部保留，只终止合成。
 * FinalVideo 置 FAILED（原因写明用户取消，无 CANCELLED 枚举——只加不改的
 * 数据库纪律下留待下次加列）；段任务置 CANCELLED 使 claim 永不再认领。
 */
export async function cancelBrollDelivery(args: {
  userId: string;
  briefId: string;
}): Promise<CancelBrollResult> {
  const brief = await db.videoBrief.findFirst({
    where: {
      id: args.briefId,
      contentAngle: {
        round: { deliveryOrder: { createdById: args.userId } },
      },
    },
    select: {
      id: true,
      videoRouteSnapshot: true,
      finalVideoId: true,
      finalVideo: { select: { id: true, status: true } },
    },
  });
  if (!brief?.finalVideo) return { ok: false, reason: "not_found" };
  if (brief.videoRouteSnapshot !== "broll") {
    return { ok: false, reason: "not_broll" };
  }
  if (
    brief.finalVideo.status === FinalVideoStatus.READY ||
    brief.finalVideo.status === FinalVideoStatus.FAILED
  ) {
    return { ok: false, reason: "already_finished" };
  }

  await db.$transaction([
    db.finalVideo.update({
      where: { id: brief.finalVideo.id },
      data: {
        status: FinalVideoStatus.FAILED,
        ffmpegError: "用户取消（素材与口播音频已保留，可重新提交）",
        finishedAt: new Date(),
      },
    }),
    db.videoJob.updateMany({
      where: { finalVideoId: brief.finalVideo.id },
      data: { status: VideoJobStatus.CANCELLED },
    }),
  ]);
  return { ok: true, state: "cancelled" };
}
