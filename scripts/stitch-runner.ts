/**
 * Standalone stitch runner —— 在 GitHub Action runner / Cloud Run / Lambda 上跑。
 *
 * 这是一个「无 Next / 无 Prisma」的独立脚本：仅依赖 Node 内置 + `@vercel/blob`，
 * 通过 Aivora 后端的 internal API 拉任务、做拼接、写回结果。
 *
 * C3（2026-10-25）起这是回滚路径：生产默认 STITCH_RUNTIME=inprocess，由应用内合成器在
 * /api/cron/stitch-dispatch 函数里合成，claim 路由在该模式下一律返回 task=null。
 * 回滚 = Vercel 设 STITCH_RUNTIME=external，stitch-dispatch 恢复派发本 workflow。
 *
 * 流程（最多循环 LOOP_LIMIT 次，每次处理一条 FinalVideo）：
 *   1. POST $APP_URL/api/internal/stitch/claim   → { task: {finalVideoId, attemptToken, segmentUrls[], aspectRatio, ...} | null }
 *      （认领有副作用，只接受 POST；GET 返回 405）
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
import {
  brollSegmentDurationSec,
  buildBrollComposeArgs,
  type BrollClaimSegment,
} from "../src/lib/video-generation/broll-segment-compose";
/// 纯函数模块（零依赖）。runner 用 apt ffmpeg，绝不引用 src/lib/media/ffmpeg-bin / ffmpeg-static。
import { pickStitchFrameRate } from "../src/lib/media/frame-rate";
/// 只用 node 内置模块：解析打包的 Noto Sans SC（workflow 里 npm 装同一版本）并生成 fonts.conf。
import { ensureMediaFonts } from "../src/lib/media/media-fonts";

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

export interface StitchTask {
  finalVideoId: string;
  attemptToken: string;
  segmentUrls: string[];
  aspectRatio: string;
  targetDurationSec: number;
  postProduction: PostProductionSnapshot | null;
  /// b-roll 任务：段 = 图库素材 + TTS 音频输入，runner 先合成再拼接。
  brollSegments?: BrollClaimSegment[] | null;
}

export interface PostProductionSnapshot {
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
    method: "POST",
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

/// 导出给运维脚本复用（scripts/ops/reburn-final-video-captions.ts）：与生产 runner 同一条合成管线，自身不写库。
export async function stitchOne(task: StitchTask): Promise<{
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
    /// lanczos + setsar=1：与应用内合成器同一缩放（720P 母片放到 1080 时 bicubic 偏糊）
    const padFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

    const normalized: string[] = [];
    if (task.brollSegments && task.brollSegments.length > 0) {
      /// b-roll 分支：素材 + TTS → 段合成（时长由 TTS 实测驱动）。
      /// 合成参数与服务端共用 broll-segment-compose，两端不漂移。
      const ordered = [...task.brollSegments].sort(
        (a, b) => a.segmentIndex - b.segmentIndex,
      );
      for (const seg of ordered) {
        const i = seg.segmentIndex;
        const clipPath = path.join(tmpDir, `broll-clip-${i}.mp4`);
        const ttsPath = path.join(tmpDir, `broll-tts-${i}.mp3`);
        await downloadToFile(seg.clipUrl, clipPath);
        await downloadToFile(seg.ttsAudioUrl, ttsPath);
        const ttsDuration = await probeDuration(ttsPath);
        const out = path.join(tmpDir, `seg-${i}.mp4`);
        await runFfmpeg(
          "ffmpeg",
          buildBrollComposeArgs({
            clipPath,
            ttsPath,
            outPath: out,
            width,
            height,
            targetDurationSec: brollSegmentDurationSec(ttsDuration),
          }),
          "broll_segment_compose_failed",
        );
        normalized.push(out);
      }
    } else {
      /// 保留主片（第一段）的源帧率，不再强转 30fps；其余段归一到同一帧率供 concat
      let targetFps: string | null = null;
      let silentSegments = 0;
      for (const [i, url] of task.segmentUrls.entries()) {
        const localInput = path.join(tmpDir, `seg-${i}.input`);
        const out = path.join(tmpDir, `seg-${i}.mp4`);
        await downloadToFile(url, localInput);
        targetFps ??= pickStitchFrameRate([await probeFrameRate(localInput)]);
        const silentPadSec = await silentPadDuration(localInput);
        if (silentPadSec !== null) silentSegments += 1;
        await runFfmpeg(
          "ffmpeg",
          buildRunnerNormalizeArgs({
            input: localInput,
            output: out,
            targetFps,
            padFilter,
            silentPadSec,
          }),
          "segment_normalization_failed",
        );
        normalized.push(out);
      }
      /// 补静音不能把「要口播却一条音轨都没有」变成静默交付哑片（与应用内合成器同一规则）
      if (
        task.postProduction?.audio.voiceover.enabled &&
        task.segmentUrls.length > 0 &&
        silentSegments === task.segmentUrls.length
      ) {
        throw new StitchRunnerError("voiceover_track_missing");
      }
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

/** b-roll 合成段一定带配音（apad 到段长）；探测不到或探测失败都说明管线出了问题，失败而不是交付哑片。 */
async function requireBrollVoiceTrack(videoPath: string): Promise<true> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      videoPath,
    ]));
  } catch {
    throw new StitchRunnerError("audio_probe_failed");
  }
  if (!stdout.trim()) throw new StitchRunnerError("broll_voice_track_missing");
  return true;
}

/**
 * 纯函数：runner 的单段归一化参数。没有音轨的段补一条与画面等长的静音轨——concat 时
 * 各段流结构必须一致，缺音轨的段会让后面的段音画错位、后期混音引用不到音轨。
 * silentPadSec = null：段自带音轨（或探测失败），参数与改造前一致。
 */
export function buildRunnerNormalizeArgs(args: {
  input: string;
  output: string;
  targetFps: string;
  padFilter: string;
  silentPadSec: number | null;
}): string[] {
  const { targetFps } = args;
  const pad = args.silentPadSec !== null && args.silentPadSec > 0;
  return [
    "-y",
    "-i",
    args.input,
    ...(pad
      ? [
          "-f",
          "lavfi",
          "-t",
          (args.silentPadSec as number).toFixed(3),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
        ]
      : []),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-r",
    targetFps,
    "-vf",
    args.padFilter,
    ...(pad ? ["-shortest"] : []),
    args.output,
  ];
}

/** 段没有音轨时返回要补的静音时长（= 段时长）；有音轨或探测失败返回 null（不补，保持旧行为）。 */
async function silentPadDuration(videoPath: string): Promise<number | null> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      videoPath,
    ]));
  } catch {
    return null;
  }
  if (stdout.trim()) return null;
  try {
    return await probeDuration(videoPath);
  } catch {
    return null;
  }
}

/** 源帧率（r_frame_rate，如 "24/1"）；探测失败返回 null，由 pickStitchFrameRate 兜底 30 */
async function probeFrameRate(videoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=r_frame_rate",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

/** 要烧字幕但打包的中文字体不在 → 任务失败（caption_font_missing），绝不交付豆腐块。 */
export function requireCaptionFontDir(fontDir: string | null): string {
  if (!fontDir) {
    console.error("::error::bundled CJK caption font missing on runner; failing the task instead of burning tofu captions");
    throw new StitchRunnerError("caption_font_missing");
  }
  return fontDir;
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

  /// 1025：b-roll 的配音已烤进每个合成段，voiceover.enabled 恒为 false——原来照它判，开了背景音乐的
  /// 实拍成片只剩音乐、口播被整段替换（生产交付物实测与 BGM 相关 0.97、与配音 0.08）。
  /// 只对 b-roll 改为实测音轨，且没有音轨就报错（不交付哑片）；其余成片保持原判据不变
  /// （复审：对普通成片改成实测会把「要口播却无音轨」从失败变成静默交付，并在 BGM 下截短视频）。
  const hasNativeAudio = args.task.brollSegments?.length
    ? await requireBrollVoiceTrack(args.inputPath)
    : snapshot.audio.voiceover.enabled;
  const audioPlan = buildAudioFilterPlan({
    bgmVolume: bgmEnabled ? snapshot.audio.bgm.volume : 0,
    hasNativeAudio,
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
    /// 1025 真机验收：生产成片的中文字幕全是豆腐块——runner 是 Ubuntu + apt ffmpeg，系统里没有
    /// 任何中文字体，这里也没传 fontsdir。与应用同一份打包字体：fontsdir 直给 libass，
    /// fonts.conf（runFfmpeg 注入 FONTCONFIG_FILE）兜住回退。
    const { fontDir } = ensureMediaFonts();
    /// C3：缺字体直接判失败（清晰机器码），不再只打 ::warning:: 然后交付豆腐块字幕。
    const fontsDirOption = `:fontsdir='${escapeFfmpegFilterPath(requireCaptionFontDir(fontDir))}'`;
    filterParts.push(
      `[0:v]ass=filename='${escapeFfmpegFilterPath(assPath)}'${fontsDirOption}[vout]`,
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
    const { fontconfigFile } = ensureMediaFonts();
    await execFileAsync(executable, args, {
      maxBuffer: 1024 * 1024 * 50,
      env: fontconfigFile ? { ...process.env, FONTCONFIG_FILE: fontconfigFile } : process.env,
    });
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

/// 只在直接运行时进认领循环；被运维脚本 import 时不认领任何任务。
if (require.main === module) {
  main().catch((err) => {
    console.error("[stitch-runner] fatal:", safeFailureMessage(err));
    process.exit(1);
  });
}
