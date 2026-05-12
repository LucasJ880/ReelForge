import { execFile } from "child_process";
import { promisify } from "util";
import { copyFile, mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { db } from "@/lib/db";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

/**
 * Stitch Service —— 多段 Seedance 段拼接为完整 MP4 的状态机。
 *
 * 架构（2026-05 重构）：
 *
 *   - Vercel Serverless 不带 ffmpeg 二进制，强行 spawn 必然 ENOENT；因此把真实的
 *     ffmpeg 拼接搬到 GitHub Actions runner（自带 apt ffmpeg）执行。
 *   - 本文件保留三类 entrypoint：
 *       1) stitchFinalVideo(id) —— 本地 / dev 环境直接跑 ffmpeg；生产环境只「占位」
 *          （标记 awaiting external stitcher），不实际拼接，等外部 runner 拉。
 *       2) claimStitchTask() —— 外部 runner（GH Action）通过 internal API 拉一个
 *          就绪任务（PENDING + 所有段 SUCCEEDED），CAS 转 STITCHING 并返回段 URL 列表。
 *       3) finishStitchTask(...) —— 外部 runner 拼接 + 上传 Blob 完成后回调，写
 *          stitchedVideoUrl + status=READY/FAILED。
 *
 *   - 运行模式判定（stitchRuntimeMode）：
 *       STITCH_RUNTIME=local      → 本地跑 ffmpeg（dev 调试 / 手动脚本）
 *       STITCH_RUNTIME=external   → 显式走外部 runner（即使本机有 ffmpeg）
 *       未设置：NODE_ENV=production → external，否则 → local。
 *
 *   - 失败处理：拼接失败累计 stitchAttempts；>=3 不再自动重试，UI 暴露重试按钮。
 *
 *   - 兼容性：
 *       * 单段（segmentCount === 1）直接复用首段 URL，不走外部 runner。
 *       * ENABLE_VIDEO_STITCHING=false 演示模式同上。
 *       * Sunny Shutter 旧 brief（finalVideoId IS NULL）不进入本服务。
 */

const MAX_STITCH_ATTEMPTS = 3;
const AWAITING_EXTERNAL_STITCHER = "awaiting external stitcher";

export interface StitchResult {
  finalVideoId: string;
  ok: boolean;
  status: FinalVideoStatus;
  stitchedVideoUrl?: string | null;
  error?: string | null;
  skipped?: boolean;
  /// 仅在生产环境（external runner）下置为 true：表示已记录占位，等 GH Action 拉
  awaitingExternal?: boolean;
}

export interface ClaimedStitchTask {
  finalVideoId: string;
  segmentUrls: string[];
  aspectRatio: string;
  targetDurationSec: number;
}

/**
 * 拾取并处理所有 ready-to-stitch 的 FinalVideo（旧 cron 调用）。
 * 生产环境下每条只做「占位」（不真实拼接）；本地 dev 下会真实拼接。
 */
export async function processPendingFinalVideos(limit = 5): Promise<{
  scanned: number;
  stitched: number;
  failed: number;
  skipped: number;
  awaiting: number;
}> {
  const candidates = await db.finalVideo.findMany({
    where: {
      status: FinalVideoStatus.PENDING,
      stitchAttempts: { lt: MAX_STITCH_ATTEMPTS },
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  let stitched = 0;
  let failed = 0;
  let skipped = 0;
  let awaiting = 0;
  for (const fv of candidates) {
    const result = await stitchFinalVideo(fv.id);
    if (result.awaitingExternal) awaiting++;
    else if (result.skipped) skipped++;
    else if (result.ok) stitched++;
    else failed++;
  }
  return { scanned: candidates.length, stitched, failed, skipped, awaiting };
}

/**
 * 拼接一个 FinalVideo：状态机入口。
 *
 * - 单段：复用首段 URL → status=READY（无需外部 runner）
 * - ENABLE_VIDEO_STITCHING=false：演示模式复用首段
 * - 多段 + local runtime：在本进程跑 ffmpeg
 * - 多段 + external runtime（生产默认）：只记录占位，等 GH Action 拉
 */
export async function stitchFinalVideo(
  finalVideoId: string,
): Promise<StitchResult> {
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      brief: { select: { id: true } },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
  });
  if (!fv) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: "FinalVideo 不存在",
    };
  }

  if (fv.status !== FinalVideoStatus.PENDING) {
    return { finalVideoId, ok: false, status: fv.status, skipped: true };
  }

  /// 段必须齐 + 全 SUCCEEDED，否则跳过（等下一轮 cron）
  const allSucceeded =
    fv.segments.length === fv.segmentCount &&
    fv.segments.every(
      (s) => s.status === VideoJobStatus.SUCCEEDED && !!s.outputVideoUrl,
    );
  if (!allSucceeded) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.PENDING,
      skipped: true,
    };
  }

  /// Phase 2：如果 brief 有 unified VideoGenerationPlan（assemblyPlan 描述了
  /// AI clips + uploaded clips + end card 的完整顺序），交给 assembly-executor 处理。
  /// 旧 brief（含 Sunny Shutter / 单纯 AI 多段无 unified plan）继续走下面 legacy 路径。
  if (await briefHasUnifiedAssembly(fv.brief?.id)) {
    /// external runtime 仍然不在本进程跑 ffmpeg —— 保留占位让外部 runner 拉
    if (stitchRuntimeMode() === "external") {
      await db.finalVideo.updateMany({
        where: { id: fv.id, status: FinalVideoStatus.PENDING },
        data: { ffmpegError: AWAITING_EXTERNAL_STITCHER },
      });
      return {
        finalVideoId,
        ok: false,
        status: FinalVideoStatus.PENDING,
        awaitingExternal: true,
        error: AWAITING_EXTERNAL_STITCHER,
      };
    }
    const { executeAssembly } = await import(
      "@/lib/video-generation/assembly-executor"
    );
    const r = await executeAssembly(finalVideoId);
    return {
      finalVideoId,
      ok: r.ok,
      status: r.status,
      stitchedVideoUrl: r.stitchedVideoUrl ?? null,
      error: r.error ?? null,
      awaitingExternal: r.awaitingExternal,
      skipped: r.skipped,
    };
  }

  /// 单段：直接复用首段 URL，不走外部拼接
  if (fv.segmentCount === 1) {
    const single = fv.segments[0];
    await db.finalVideo.update({
      where: { id: fv.id },
      data: {
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: single.outputVideoUrl,
        thumbnailUrl: single.outputThumbUrl,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    if (fv.brief) await markBriefReady(fv.brief.id);
    return {
      finalVideoId,
      ok: true,
      status: FinalVideoStatus.READY,
      stitchedVideoUrl: single.outputVideoUrl,
    };
  }

  /// 演示模式：跳过真实 ffmpeg，把第一段 URL 当成片
  if (process.env.ENABLE_VIDEO_STITCHING === "false") {
    const first = fv.segments[0];
    await db.finalVideo.update({
      where: { id: fv.id },
      data: {
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: first.outputVideoUrl,
        thumbnailUrl: first.outputThumbUrl,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    if (fv.brief) await markBriefReady(fv.brief.id);
    return {
      finalVideoId,
      ok: true,
      status: FinalVideoStatus.READY,
      stitchedVideoUrl: first.outputVideoUrl,
    };
  }

  /// 生产模式：不在本进程跑 ffmpeg，只「占位」等外部 runner 拉
  if (stitchRuntimeMode() === "external") {
    await db.finalVideo.updateMany({
      where: { id: fv.id, status: FinalVideoStatus.PENDING },
      data: { ffmpegError: AWAITING_EXTERNAL_STITCHER },
    });
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.PENDING,
      awaitingExternal: true,
      error: AWAITING_EXTERNAL_STITCHER,
    };
  }

  /// 本地 / dev 模式：CAS PENDING → STITCHING，在本进程跑 ffmpeg
  const claim = await db.finalVideo.updateMany({
    where: { id: fv.id, status: FinalVideoStatus.PENDING },
    data: {
      status: FinalVideoStatus.STITCHING,
      startedAt: new Date(),
      ffmpegError: null,
    },
  });
  if (claim.count === 0) {
    return {
      finalVideoId,
      ok: false,
      status: fv.status,
      skipped: true,
    };
  }

  const segmentUrls = fv.segments.map((s) => s.outputVideoUrl as string);
  const thumbnailUrl: string | null = fv.segments[0]?.outputThumbUrl ?? null;
  /// legacy 路径：不知道 aspectRatio 就用 brief.aspectRatio（旧 brief 也有该字段）
  const briefAspect = await briefAspectRatio(fv.brief?.id);

  let stitchedUrl: string | null = null;
  let error: string | null = null;
  try {
    stitchedUrl = await runFfmpegConcat(fv.id, segmentUrls, briefAspect);
  } catch (err) {
    error = (err as Error).message;
  }

  if (stitchedUrl) {
    await db.finalVideo.update({
      where: { id: fv.id },
      data: {
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: stitchedUrl,
        thumbnailUrl,
        finishedAt: new Date(),
        stitchAttempts: fv.stitchAttempts + 1,
      },
    });
    if (fv.brief) await markBriefReady(fv.brief.id);
    return {
      finalVideoId,
      ok: true,
      status: FinalVideoStatus.READY,
      stitchedVideoUrl: stitchedUrl,
    };
  }

  await db.finalVideo.update({
    where: { id: fv.id },
    data: {
      status: FinalVideoStatus.FAILED,
      ffmpegError: error,
      finishedAt: new Date(),
      stitchAttempts: fv.stitchAttempts + 1,
    },
  });
  return {
    finalVideoId,
    ok: false,
    status: FinalVideoStatus.FAILED,
    error,
  };
}

/**
 * 外部 runner（GH Action）拉取一个就绪任务：
 *   - 找一个 PENDING + 所有段 SUCCEEDED + stitchAttempts < MAX 的 FinalVideo
 *   - CAS PENDING → STITCHING（防多 runner 抢同一条）
 *   - 返回段 URL 列表 + aspectRatio + targetDurationSec
 *
 * 返回 null 表示当前没有可拼任务，runner 可以直接退出。
 */
export async function claimStitchTask(): Promise<ClaimedStitchTask | null> {
  const candidates = await db.finalVideo.findMany({
    where: {
      status: FinalVideoStatus.PENDING,
      stitchAttempts: { lt: MAX_STITCH_ATTEMPTS },
    },
    take: 10,
    orderBy: { updatedAt: "asc" },
    include: {
      brief: { select: { aspectRatio: true } },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
  });

  for (const fv of candidates) {
    const allSucceeded =
      fv.segments.length === fv.segmentCount &&
      fv.segments.every(
        (s) => s.status === VideoJobStatus.SUCCEEDED && !!s.outputVideoUrl,
      );
    if (!allSucceeded) continue;
    if (fv.segmentCount <= 1) continue; // 单段不需要外部 runner

    /// CAS：从 PENDING → STITCHING；若已被别的 runner 抢走则跳过下一个
    const claim = await db.finalVideo.updateMany({
      where: { id: fv.id, status: FinalVideoStatus.PENDING },
      data: {
        status: FinalVideoStatus.STITCHING,
        startedAt: new Date(),
        ffmpegError: null,
      },
    });
    if (claim.count === 0) continue;

    return {
      finalVideoId: fv.id,
      segmentUrls: fv.segments.map((s) => s.outputVideoUrl as string),
      aspectRatio: fv.brief?.aspectRatio ?? "9:16",
      targetDurationSec: fv.targetDurationSec,
    };
  }
  return null;
}

/**
 * 外部 runner（GH Action）完成拼接后的回调：
 *   - 成功：写 stitchedVideoUrl + thumbnailUrl + status=READY
 *   - 失败：写 ffmpegError + status=FAILED（stitchAttempts++）
 *   - 同时推进 brief → QA_PENDING（仅成功时）
 */
export async function finishStitchTask(args: {
  finalVideoId: string;
  stitchedVideoUrl?: string | null;
  thumbnailUrl?: string | null;
  error?: string | null;
}): Promise<StitchResult> {
  const { finalVideoId, stitchedVideoUrl, thumbnailUrl, error } = args;
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: { brief: { select: { id: true } } },
  });
  if (!fv) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: "FinalVideo 不存在",
    };
  }

  if (error || !stitchedVideoUrl) {
    await db.finalVideo.update({
      where: { id: fv.id },
      data: {
        status: FinalVideoStatus.FAILED,
        ffmpegError: error ?? "external stitcher returned no URL",
        finishedAt: new Date(),
        stitchAttempts: fv.stitchAttempts + 1,
      },
    });
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: error ?? "external stitcher returned no URL",
    };
  }

  await db.finalVideo.update({
    where: { id: fv.id },
    data: {
      status: FinalVideoStatus.READY,
      stitchedVideoUrl,
      thumbnailUrl: thumbnailUrl ?? fv.thumbnailUrl,
      finishedAt: new Date(),
      stitchAttempts: fv.stitchAttempts + 1,
      ffmpegError: null,
    },
  });
  if (fv.brief) await markBriefReady(fv.brief.id);
  return {
    finalVideoId,
    ok: true,
    status: FinalVideoStatus.READY,
    stitchedVideoUrl,
  };
}

/**
 * 重置 FinalVideo 拼接状态以便再次尝试（不重新提交 Seedance）。
 * 用户在「合成失败」UI 上点重试时调用。
 */
export async function retryStitch(finalVideoId: string) {
  const fv = await db.finalVideo.findUnique({ where: { id: finalVideoId } });
  if (!fv) throw new Error("FinalVideo 不存在");
  await db.finalVideo.update({
    where: { id: finalVideoId },
    data: {
      status: FinalVideoStatus.PENDING,
      ffmpegError: null,
    },
  });
  return stitchFinalVideo(finalVideoId);
}

async function markBriefReady(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { finalVideoId: true, finalVideo: true },
  });
  if (!brief?.finalVideo) return;
  await db.videoBrief.update({
    where: { id: briefId },
    data: {
      status: VideoBriefStatus.QA_PENDING,
      finalVideoUrl: brief.finalVideo.stitchedVideoUrl,
      finalThumbnailUrl: brief.finalVideo.thumbnailUrl,
    },
  });
  await ensureQAPendingStub(briefId);
}

async function ensureQAPendingStub(briefId: string) {
  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: briefId, status: "PENDING" },
  });
  if (existing) return;
  await db.qAReview.create({
    data: { videoBriefId: briefId, status: "PENDING" },
  });
}

/**
 * 运行时模式判定：
 *   STITCH_RUNTIME=local     → 本地直接跑 ffmpeg
 *   STITCH_RUNTIME=external  → 显式走外部 runner（GH Action）
 *   未设置且 NODE_ENV=production → external（Vercel 函数没有 ffmpeg，必须委托外部）
 *   未设置且非 production         → local（dev / 测试 / 手动脚本方便）
 */
function stitchRuntimeMode(): "local" | "external" {
  const explicit = (process.env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "external") return "external";
  return process.env.NODE_ENV === "production" ? "external" : "local";
}

/**
 * 用 ffmpeg concat demuxer 把 N 段 mp4 拼成 1 段。
 * 仅 stitchRuntimeMode() === "local" 时走这条路径。
 *
 * 旧 legacy 入口（无 unified plan 的 brief 走这里）。新 brief 走
 * runFfmpegNormalizeAndConcat（aspect-aware + 支持 trim）。
 */
async function runFfmpegConcat(
  finalVideoId: string,
  urls: string[],
  aspectRatio: string,
): Promise<string> {
  return runFfmpegNormalizeAndConcat({
    finalVideoId,
    aspectRatio,
    clips: urls.map((u) => ({ url: u, intendedDurationSec: null, trimToFit: false })),
  });
}

interface AspectDimensions {
  width: number;
  height: number;
}

const ASPECT_RESOLUTION: Record<string, AspectDimensions> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

function resolveAspectResolution(aspectRatio: string): AspectDimensions {
  return ASPECT_RESOLUTION[aspectRatio] ?? ASPECT_RESOLUTION["9:16"];
}

export interface NormalizeAndConcatClip {
  url: string;
  /// 期望该 clip 在最终视频里的时长；非 null 时配合 trimToFit 决定是否截断
  intendedDurationSec: number | null;
  /// true = 该 clip 长度可能超出，按 intendedDurationSec 裁剪；false = 用原长
  trimToFit: boolean;
}

/**
 * Phase 2 · L4 — aspect-aware normalize + concat。
 *
 * 输入混合 URL（http(s)/file://）+ 期望时长，输出 stitched MP4 的 Blob URL。
 * 每个 clip：
 *   1. download/copy 到本地 tmp
 *   2. ffmpeg scale+pad 到 target resolution（按 aspectRatio 决定 1080x1920/1920x1080/1080x1080）
 *   3. （trimToFit 且 intendedDurationSec）→ -t N 强制截断；缺音轨补 anullsrc
 *   4. 全部 normalized 后 concat demuxer 拼成最终 MP4
 *   5. persistStitchedFile 上传 Blob 返回 URL
 */
export async function runFfmpegNormalizeAndConcat(params: {
  finalVideoId: string;
  aspectRatio: string;
  clips: NormalizeAndConcatClip[];
}): Promise<string> {
  const { finalVideoId, aspectRatio, clips } = params;
  const { width, height } = resolveAspectResolution(aspectRatio);
  const tmpDir = path.join(
    os.tmpdir(),
    `aivora-stitch-${finalVideoId}-${Date.now()}`,
  );
  await mkdir(tmpDir, { recursive: true });

  try {
    const normalizedFiles: string[] = [];
    for (const [i, clip] of clips.entries()) {
      const ext = path.extname(safePathFromUrl(clip.url) ?? ".mp4") || ".mp4";
      const localInput = path.join(tmpDir, `in-${i}${ext}`);
      const normalized = path.join(tmpDir, `seg-${i}.mp4`);
      await downloadToFile(clip.url, localInput);

      const args: string[] = [
        "-y",
        "-loglevel",
        "error",
        "-i",
        localInput,
        /// 静音 anullsrc 兜底：如果输入没有音轨也保证输出有，方便 concat
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-filter_complex",
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v];[0:a?][1:a]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
      ];
      if (clip.trimToFit && clip.intendedDurationSec) {
        args.push("-t", String(Math.max(1, clip.intendedDurationSec)));
      }
      args.push("-shortest", normalized);

      try {
        await execFileAsync(FFMPEG_BIN, args, {
          maxBuffer: 1024 * 1024 * 50,
          timeout: 60_000,
        });
      } catch (err) {
        /// amerge 在「输入完全没有音轨」时也会报错（没有 a? 流）；
        /// 重试一次：丢弃原音、强制 anullsrc 充当静音轨
        const fallbackArgs: string[] = [
          "-y",
          "-loglevel",
          "error",
          "-i",
          localInput,
          "-f",
          "lavfi",
          "-t",
          String(Math.max(1, clip.intendedDurationSec ?? 60)),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          "-c:a",
          "aac",
          "-ar",
          "44100",
          "-ac",
          "2",
        ];
        if (clip.trimToFit && clip.intendedDurationSec) {
          fallbackArgs.push("-t", String(Math.max(1, clip.intendedDurationSec)));
        }
        fallbackArgs.push("-shortest", normalized);
        try {
          await execFileAsync(FFMPEG_BIN, fallbackArgs, {
            maxBuffer: 1024 * 1024 * 50,
            timeout: 60_000,
          });
        } catch (innerErr) {
          throw new Error(
            `ffmpeg normalize failed for clip #${i} (${clip.url.slice(0, 80)}): ${(innerErr as Error).message || (err as Error).message}`,
          );
        }
      }
      normalizedFiles.push(normalized);
    }

    const concatList = path.join(tmpDir, "concat.txt");
    await writeFile(
      concatList,
      normalizedFiles
        .map((s) => `file '${s.replaceAll("'", "'\\''")}'`)
        .join("\n"),
      "utf8",
    );
    const finalOut = path.join(tmpDir, "final.mp4");
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatList,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        finalOut,
      ],
      { maxBuffer: 1024 * 1024 * 50, timeout: 120_000 },
    );

    const url = await persistStitchedFile(
      finalOut,
      `final-videos/${finalVideoId}/${Date.now()}.mp4`,
    );
    return url;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function safePathFromUrl(url: string): string | null {
  try {
    if (url.startsWith("file://")) return fileURLToPath(url);
    const u = new URL(url);
    return u.pathname;
  } catch {
    return null;
  }
}

/**
 * 支持 http(s) 和 file:// 两种 URL：
 *  - http(s) → fetch 下载到 dest
 *  - file:// → copyFile 复制到 dest（dev/local mock 路径常用）
 */
async function downloadToFile(url: string, dest: string) {
  if (url.startsWith("file://")) {
    const localPath = fileURLToPath(url);
    await copyFile(localPath, dest);
    return;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `下载段失败 (${res.status} ${res.statusText}) URL=${url.slice(0, 80)}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

/**
 * 检查 brief 是否带有 unified VideoGenerationPlan.assemblyPlan，是 → 走 assembly-executor。
 * 旧 Sunny Shutter / 没经过 unified-input dispatch 的 brief 返回 false → 走 legacy stitch。
 */
async function briefAspectRatio(
  briefId: string | null | undefined,
): Promise<string> {
  if (!briefId) return "9:16";
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { aspectRatio: true },
  });
  return brief?.aspectRatio || "9:16";
}

async function briefHasUnifiedAssembly(briefId: string | null | undefined): Promise<boolean> {
  if (!briefId) return false;
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { videoGenerationPlan: true },
  });
  const plan = brief?.videoGenerationPlan as
    | { assemblyPlan?: { clips?: unknown[] } }
    | null
    | undefined;
  return Array.isArray(plan?.assemblyPlan?.clips) && (plan?.assemblyPlan?.clips?.length ?? 0) > 0;
}

/**
 * 把本地 mp4 上传到 Vercel Blob，返回公网 URL。
 * 强约束：缺 BLOB_READ_WRITE_TOKEN → 直接 throw，绝不再回退到 file:// 静默兜底
 * （旧逻辑会写 `file:///tmp/...mp4` 进数据库，导致前端永远播不出）。
 */
async function persistStitchedFile(
  filePath: string,
  blobPath: string,
): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN not configured; refusing to silently persist to file://",
    );
  }
  const { put } = await import("@vercel/blob");
  const buffer = await readFile(filePath);
  const blob = await put(blobPath, buffer, {
    access: "public",
    contentType: "video/mp4",
    token,
  });
  return blob.url;
}

/// 仅供测试导入
export const __test__ = {
  stitchRuntimeMode,
  persistStitchedFile,
  AWAITING_EXTERNAL_STITCHER,
  resolveAspectResolution,
  briefHasUnifiedAssembly,
  briefAspectRatio,
};
