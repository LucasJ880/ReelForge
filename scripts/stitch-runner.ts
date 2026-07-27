/**
 * Standalone stitch runner —— 在 GitHub Action runner / Cloud Run / Lambda 上跑。
 *
 * 这是一个「无 Next / 无 Prisma」的独立脚本：仅依赖 Node 内置 + `@vercel/blob`，
 * 通过 Aivora 后端的 internal API 拉任务、做拼接、写回结果。
 *
 * 流程（最多循环 LOOP_LIMIT 次，每次处理一条 FinalVideo）：
 *   1. GET  $APP_URL/api/internal/stitch/claim   → { task: {finalVideoId, attemptToken, segmentUrls[], aspectRatio, ...} | null }
 *   2. 下载所有段 mp4 到 tmp 目录
 *   3. 用本地 ffmpeg（GH Action runner 自带）转码 + concat 成最终 mp4
 *   4. 按持久化快照生成字幕/混音，再抽取 JPEG 预览帧并上传成片与可选 SRT
 *   5. POST $APP_URL/api/internal/stitch/complete
 *      { finalVideoId, attemptToken, stitchedVideoUrl, thumbnailUrl, subtitleFileUrl? }
 *   6. 任何步骤失败 → POST complete 写 error，不抛错（让循环继续处理下一个）
 *
 * Env 要求：
 *   APP_URL                 — e.g. https://aivora.vercel.app（不带尾斜杠）
 *   CRON_SECRET             — 与 Vercel 环境一致
 *   BLOB_READ_WRITE_TOKEN   — Vercel Blob R/W token
 *
 * 注意：只允许 import 零运行时依赖的纯函数模块；不要引入 Next / Prisma。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BGM_TRACKS,
  buildAudioFilterPlan,
  buildDeterministicCues,
  renderAssCaptions,
  renderSrtCaptions,
} from "../src/lib/video-generation/audio-post-production";

const execFileAsync = promisify(execFile);

const LOOP_LIMIT = Number(process.env.STITCH_RUNNER_LOOP_LIMIT ?? "5");
const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? "";

class StaleStitchAttemptError extends Error {
  constructor() {
    super("stitch attempt is no longer active");
    this.name = "StaleStitchAttemptError";
  }
}

class StitchRunnerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StitchRunnerError";
  }
}

interface StitchTask {
  finalVideoId: string;
  attemptToken: string;
  segmentUrls: string[];
  aspectRatio: string;
  targetDurationSec: number;
  postProduction: PostProductionSnapshot | null;
}

interface PostProductionSnapshot {
  audio: {
    voiceover: {
      enabled: boolean;
      voiceId: string;
      language: string;
      script: string;
    };
    bgm: {
      trackId: "none" | "wholesome";
      volume: number;
    };
  };
  captions: {
    enabled: boolean;
    style: "word_by_word" | "karaoke" | "plain";
    language: string;
    position: "top" | "center" | "bottom";
    exportSrt: boolean;
  };
}

async function main() {
  if (!APP_URL || !CRON_SECRET || !BLOB_READ_WRITE_TOKEN) {
    console.error(
      "[stitch-runner] missing env: APP_URL / CRON_SECRET / BLOB_READ_WRITE_TOKEN are all required",
    );
    process.exit(1);
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < LOOP_LIMIT; i++) {
    const task = await claim();
    if (!task) {
      console.log(`[stitch-runner] no pending tasks; iter=${i}; exiting`);
      break;
    }
    console.log(
      `[stitch-runner] claimed task finalVideoId=${task.finalVideoId} segments=${task.segmentUrls.length}`,
    );

    let output: {
      stitchedVideoUrl: string;
      thumbnailUrl: string;
      subtitleFileUrl?: string;
    };
    try {
      output = await stitchOne(task);
    } catch (err) {
      const message = safeFailureMessage(err);
      console.error(
        `[stitch-runner] ✗ finalVideoId=${task.finalVideoId} error=${message}`,
      );
      try {
        await complete({
          finalVideoId: task.finalVideoId,
          attemptToken: task.attemptToken,
          error: message.slice(0, 500),
        });
      } catch (postErr) {
        if (postErr instanceof StaleStitchAttemptError) {
          console.warn(
            `[stitch-runner] stale failure ignored finalVideoId=${task.finalVideoId}`,
          );
        } else {
          console.error(
            "[stitch-runner] failed to POST /complete (giving up):",
            safeFailureMessage(postErr),
          );
        }
      }
      failed++;
      continue;
    }

    try {
      await complete({
        finalVideoId: task.finalVideoId,
        attemptToken: task.attemptToken,
        stitchedVideoUrl: output.stitchedVideoUrl,
        thumbnailUrl: output.thumbnailUrl,
        subtitleFileUrl: output.subtitleFileUrl,
      });
      console.log(
        `[stitch-runner] ✓ finalVideoId=${task.finalVideoId} mediaUploaded=true`,
      );
      processed++;
    } catch (err) {
      if (err instanceof StaleStitchAttemptError) {
        console.warn(
          `[stitch-runner] stale completion ignored finalVideoId=${task.finalVideoId}`,
        );
        continue;
      }
      console.error(
        `[stitch-runner] completion callback failed finalVideoId=${task.finalVideoId}:`,
        safeFailureMessage(err),
      );
      // The media has already been stitched and uploaded. A callback transport
      // failure is not a rendering failure: leave this attempt STITCHING so a
      // retry/sweeper can reconcile it without overwriting a newer claim.
      failed++;
    }
  }

  console.log(
    `[stitch-runner] done: processed=${processed} failed=${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

async function claim(): Promise<StitchTask | null> {
  const res = await fetch(`${APP_URL}/api/internal/stitch/claim`, {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    throw new StitchRunnerError(`claim_failed_http_${res.status}`);
  }
  const body = (await res.json()) as { task: StitchTask | null };
  return body.task ?? null;
}

async function complete(args: {
  finalVideoId: string;
  attemptToken: string;
  stitchedVideoUrl?: string;
  thumbnailUrl?: string;
  subtitleFileUrl?: string;
  error?: string;
}) {
  const res = await fetch(`${APP_URL}/api/internal/stitch/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CRON_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (res.status === 409) {
    throw new StaleStitchAttemptError();
  }
  if (!res.ok) {
    throw new StitchRunnerError(`complete_failed_http_${res.status}`);
  }
  if (!args.error) {
    const payload = (await res.json()) as { ok?: boolean };
    if (payload.ok !== true) {
      throw new Error("complete endpoint did not accept successful output");
    }
  }
}

async function stitchOne(task: StitchTask): Promise<{
  stitchedVideoUrl: string;
  thumbnailUrl: string;
  subtitleFileUrl?: string;
}> {
  const tmpDir = path.join(
    os.tmpdir(),
    `stitch-${task.finalVideoId}-${Date.now()}`,
  );
  await mkdir(tmpDir, { recursive: true });
  try {
    const { width, height } = aspectToDimensions(task.aspectRatio);
    const padFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

    const normalized: string[] = [];
    for (const [i, url] of task.segmentUrls.entries()) {
      const localInput = path.join(tmpDir, `seg-${i}.input`);
      const out = path.join(tmpDir, `seg-${i}.mp4`);
      await downloadToFile(url, localInput);
      await runFfmpeg(
        "ffmpeg",
        [
          "-y",
          "-i",
          localInput,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-r",
          "30",
          "-vf",
          padFilter,
          out,
        ],
        "segment_normalization_failed",
      );
      normalized.push(out);
    }

    const concatList = path.join(tmpDir, "concat.txt");
    await writeFile(
      concatList,
      normalized
        .map((s) => `file '${s.replaceAll("'", "'\\''")}'`)
        .join("\n"),
      "utf8",
    );
    const finalOut = path.join(tmpDir, "final.mp4");
    await runFfmpeg(
      "ffmpeg",
      [
        "-y",
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
        "-movflags",
        "+faststart",
        finalOut,
      ],
      "stitch_concat_failed",
    );

    const postProduced = await applyPostProduction({
      task,
      inputPath: finalOut,
      tmpDir,
    });
    const timestamp = Date.now();
    const thumbnailOut = path.join(tmpDir, "thumbnail.jpg");
    await extractThumbnail(
      postProduced.videoPath,
      thumbnailOut,
      task.targetDurationSec,
    );

    const videoBlobPath = `final-videos/${task.finalVideoId}/${timestamp}.mp4`;
    const thumbnailBlobPath = `final-videos/${task.finalVideoId}/${timestamp}.jpg`;
    const [stitchedVideoUrl, thumbnailUrl, subtitleFileUrl] = await Promise.all([
      uploadToBlob(postProduced.videoPath, videoBlobPath, "video/mp4"),
      uploadToBlob(thumbnailOut, thumbnailBlobPath, "image/jpeg"),
      postProduced.srtPath
        ? uploadToBlob(
            postProduced.srtPath,
            `final-videos/${task.finalVideoId}/${timestamp}.srt`,
            "text/plain",
          )
        : Promise.resolve(undefined),
    ]);
    return { stitchedVideoUrl, thumbnailUrl, subtitleFileUrl };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function probeDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("invalid duration");
    }
    return duration;
  } catch {
    throw new StitchRunnerError("duration_probe_failed");
  }
}

function escapeFfmpegFilterPath(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

/**
 * Applies the same deterministic planner used by local assembly. Native speech
 * is retained while sidechaincompress ducks the licensed music bed beneath it.
 */
async function applyPostProduction(args: {
  task: StitchTask;
  inputPath: string;
  tmpDir: string;
}): Promise<{ videoPath: string; srtPath?: string }> {
  const snapshot = args.task.postProduction;
  if (!snapshot) return { videoPath: args.inputPath };
  const script = snapshot.audio.voiceover.script.trim();
  const captionsEnabled = snapshot.captions.enabled && Boolean(script);
  const bgm = BGM_TRACKS.find(
    (track) => track.id === snapshot.audio.bgm.trackId,
  );
  if (!bgm) throw new StitchRunnerError("post_production_bgm_unknown");
  const bgmEnabled =
    bgm.path !== null && snapshot.audio.bgm.volume > 0;
  if (
    !captionsEnabled &&
    !bgmEnabled &&
    !snapshot.audio.voiceover.enabled
  ) {
    return { videoPath: args.inputPath };
  }

  const actualDurationSec = await probeDuration(args.inputPath);
  let assPath: string | undefined;
  let srtPath: string | undefined;
  if (captionsEnabled) {
    const cues = buildDeterministicCues(script, actualDurationSec);
    assPath = path.join(args.tmpDir, "captions.ass");
    await writeFile(
      assPath,
      renderAssCaptions(cues, {
        aspectRatio:
          args.task.aspectRatio === "16:9" || args.task.aspectRatio === "1:1"
            ? args.task.aspectRatio
            : "9:16",
        position: snapshot.captions.position,
        style: snapshot.captions.style,
      }),
      "utf8",
    );
    if (snapshot.captions.exportSrt) {
      srtPath = path.join(args.tmpDir, "captions.srt");
      await writeFile(srtPath, renderSrtCaptions(cues), "utf8");
    }
  }

  const audioPlan = buildAudioFilterPlan({
    bgmVolume: bgmEnabled ? snapshot.audio.bgm.volume : 0,
    hasNativeAudio: snapshot.audio.voiceover.enabled,
    durationSec: actualDurationSec,
  });
  const outputPath = path.join(args.tmpDir, "post-produced.mp4");
  const ffmpegArgs = ["-y", "-i", args.inputPath];
  if (bgmEnabled && bgm.path) {
    ffmpegArgs.push(
      ...audioPlan.bgmInputArgs,
      "-i",
      path.resolve(process.cwd(), bgm.path),
    );
  }

  const filterParts: string[] = [];
  if (assPath) {
    filterParts.push(
      `[0:v]ass=filename='${escapeFfmpegFilterPath(assPath)}'[vout]`,
    );
  }
  if (audioPlan.filterComplex) {
    filterParts.push(audioPlan.filterComplex);
  }
  if (filterParts.length > 0) {
    ffmpegArgs.push("-filter_complex", filterParts.join(";"));
  }
  ffmpegArgs.push("-map", assPath ? "[vout]" : "0:v:0");
  if (audioPlan.outputLabel) {
    ffmpegArgs.push("-map", audioPlan.outputLabel);
  } else {
    ffmpegArgs.push("-map", "0:a?");
  }
  if (assPath) {
    ffmpegArgs.push(
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
    );
  } else {
    ffmpegArgs.push("-c:v", "copy");
  }
  if (audioPlan.outputLabel) {
    ffmpegArgs.push("-c:a", "aac", "-b:a", "192k");
  } else {
    ffmpegArgs.push("-c:a", "copy");
  }
  ffmpegArgs.push("-movflags", "+faststart", "-shortest", outputPath);
  await runFfmpeg(
    "ffmpeg",
    ffmpegArgs,
    "post_production_failed",
  );
  return { videoPath: outputPath, srtPath };
}

async function downloadToFile(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new StitchRunnerError(`download_segment_failed_http_${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function uploadToBlob(
  filePath: string,
  blobPath: string,
  contentType: "video/mp4" | "image/jpeg" | "text/plain",
): Promise<string> {
  /// 动态 import 避免 stitch-runner.ts 在 type check 时强依赖 @vercel/blob
  /// （CI runner 通过 npx -y @vercel/blob 或 npm i 临时装即可）
  const { put } = (await import("@vercel/blob")) as typeof import("@vercel/blob");
  const buffer = await readFile(filePath);
  try {
    const blob = await put(blobPath, buffer, {
      access: "public",
      contentType,
      token: BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  } catch {
    throw new StitchRunnerError(
      contentType === "image/jpeg"
        ? "thumbnail_upload_failed"
        : contentType === "text/plain"
          ? "subtitle_upload_failed"
        : "stitched_video_upload_failed",
    );
  }
}

async function extractThumbnail(
  videoPath: string,
  thumbnailPath: string,
  targetDurationSec: number,
) {
  /// Prefer a frame just after the opening transition. Clamp the seek point so
  /// short clips still have a valid candidate and long videos do not require a
  /// deep seek. If metadata/duration is inaccurate, fall back to ffmpeg's
  /// representative-frame selector instead of completing without a preview.
  const safeDuration = Number.isFinite(targetDurationSec)
    ? Math.max(0, targetDurationSec)
    : 0;
  const seekSeconds = Math.min(2, Math.max(0.25, safeDuration * 0.1));

  try {
    await runFfmpeg(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-ss",
        seekSeconds.toFixed(3),
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2",
        "-q:v",
        "2",
        thumbnailPath,
      ],
      "thumbnail_seek_failed",
    );
  } catch {
    await runFfmpeg(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-vf",
        "thumbnail=30,scale=480:-2",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        thumbnailPath,
      ],
      "thumbnail_extraction_failed",
    );
  }
}

async function runFfmpeg(
  executable: "ffmpeg",
  args: string[],
  errorCode: string,
) {
  try {
    await execFileAsync(executable, args, { maxBuffer: 1024 * 1024 * 50 });
  } catch {
    throw new StitchRunnerError(errorCode);
  }
}

function aspectToDimensions(aspectRatio: string): { width: number; height: number } {
  /// 默认 1080×1920；其它常见比例做兜底转换
  switch (aspectRatio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "4:5":
      return { width: 1080, height: 1350 };
    default:
      return { width: 1080, height: 1920 };
  }
}

function safeFailureMessage(err: unknown): string {
  if (err instanceof StitchRunnerError) return err.code;
  if (err instanceof StaleStitchAttemptError) return "stale_stitch_attempt";
  return "stitch_runner_unexpected_failure";
}

main().catch((err) => {
  console.error("[stitch-runner] fatal:", safeFailureMessage(err));
  process.exit(1);
});
