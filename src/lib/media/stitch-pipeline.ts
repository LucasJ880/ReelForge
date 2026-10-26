/**
 * 成片合成管线（C3：生产与开发只有这一套合成实现）。
 *
 * 输入：已下载到本地的片段（AI 段 / 客户上传片段 / 尾卡 / b-roll 素材 + 配音）+ 后期快照。
 * 输出：本地成片 MP4（+ 可选 SRT、缩略图），上传与落库由调用方负责。
 * 不读写数据库、不碰对象存储——/api/health/media 直接调用 composeTimeline，
 * 探针测的就是拼接器真正跑的那条路径（同一个函数、同一套滤镜与编码参数）。
 *
 * 单遍合成（2026-10-25 起）：一次 ffmpeg 调用、只编码一次画面——
 *   1. 逐段（滤镜内）：lanczos 缩放 + pad + setsar=1 + 统一帧率；按帧数精确截断
 *      （trimToFit / AI 段语音安全裁尾 / b-roll 口播时长）。音轨按实测：有声音就重采样成
 *      44.1k 立体声并补静音到段长，没有就补静音轨；b-roll 用配音文件替换素材原声。
 *   2. concat 滤镜把各段接起来（不落中间文件）。
 *   3. 后期：字幕 ass 烧录 + 原生音轨 / BGM 闪避混音 + 响度归一。
 *   4. 编码一次（CRF 18，与改造前的成片画质目标一致），再从成片抽缩略图。
 * 改造前是「逐段 ultrafast → concat 再编码 → 字幕再编码」三代转码；且 ffmpeg 6.x 不认
 * 旧滤镜里的 `[0:a?]`，主路径必然失败、回退分支把片段原生音轨（口播）换成了静音。
 *
 * 时间预算：每步超时随片长放大，但封顶在调用方给的 deadline 之内（专用函数 maxDuration
 * 300s）。预算不够开始下一步 → StitchBudgetExceededError，由调用方把任务放回 PENDING。
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PostProductionPlan } from "@/types/video-generation";
import {
  BGM_TRACKS,
  buildAudioFilterPlan,
  buildDeterministicCues,
  buildTimedCues,
  buildWindowedCues,
  captionWindowsFromSegments,
  parseCaptionWords,
  renderAssCaptions,
  renderSrtCaptions,
  splitScriptByWindows,
  type CaptionCue,
  type CaptionWord,
} from "@/lib/video-generation/audio-post-production";
import { measureSpeechSafeTailTrim } from "@/lib/video-generation/tail-trim";
import { probeMedia, runFfmpeg, type MediaProbe } from "./ffmpeg-bin";
import { pickStitchFrameRate } from "./frame-rate";
import { ensureMediaFonts } from "./media-fonts";

// ---------------------------------------------------------------------------
// 编码参数
// ---------------------------------------------------------------------------

/// 画质目标与改造前的成片一致：CRF 18。preset 用 veryfast——只编码一次之后，
/// 同 CRF 下主观画质持平、编码时间可控（本地实测见 C3 交付报告）。
export const STITCH_VIDEO_CRF = "18";
export const STITCH_X264_PRESET = "veryfast";
export const STITCH_AUDIO_RATE = 44100;
export const STITCH_AUDIO_BITRATE = "192k";

interface AspectDimensions {
  width: number;
  height: number;
}

const ASPECT_RESOLUTION: Record<string, AspectDimensions> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

export function resolveAspectResolution(aspectRatio: string): AspectDimensions {
  return ASPECT_RESOLUTION[aspectRatio] ?? ASPECT_RESOLUTION["9:16"];
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export const STITCH_TIME_BUDGET_EXCEEDED = "STITCH_TIME_BUDGET_EXCEEDED";

/** 剩余预算不够安全地跑完下一步（或某步被预算封顶的超时杀掉）。调用方应放回 PENDING。 */
export class StitchBudgetExceededError extends Error {
  readonly code = STITCH_TIME_BUDGET_EXCEEDED;
  constructor(readonly step: string) {
    super(`${STITCH_TIME_BUDGET_EXCEEDED}: not enough function time left for ${step}`);
    this.name = "StitchBudgetExceededError";
  }
}

/** 合成输入或环境不满足、重跑也不会好的失败；code 是稳定的机器码，message 给运维看。 */
export class StitchCompositionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "StitchCompositionError";
  }
}

// ---------------------------------------------------------------------------
// 时间预算
// ---------------------------------------------------------------------------

export interface MediaBudget {
  /** epoch ms；null = 没有截止时间（只用随片长放大的单步超时兜住卡死） */
  deadlineAt: number | null;
  /** 最后一步 ffmpeg 之后要留给上传 + 落库的时间 */
  reserveMs: number;
  now: () => number;
}

export function createMediaBudget(
  opts: { deadlineAt?: number | null; reserveMs?: number; now?: () => number } = {},
): MediaBudget {
  return {
    deadlineAt: opts.deadlineAt ?? null,
    reserveMs: opts.reserveMs ?? 20_000,
    now: opts.now ?? Date.now,
  };
}

const MIN_STEP_MS = 3_000;

export type StitchStep =
  | "probe"
  | "silence"
  | "encode"
  | "thumbnail"
  | "download"
  | "broll_compose";

/**
 * 随片长放大的单步超时（防 ffmpeg 卡死），按 1 vCPU 函数上的最慢情况留余量。
 * 真正的上限由 deadline 封顶，见 stepTimeout。
 */
export function scaledStepTimeoutMs(step: StitchStep, mediaSec: number): number {
  const sec = Math.max(1, Number.isFinite(mediaSec) ? mediaSec : 1);
  switch (step) {
    case "probe":
      return 30_000;
    case "silence":
      return 15_000 + Math.round(500 * sec);
    case "encode":
    case "broll_compose":
      return 45_000 + Math.round(6_000 * sec);
    case "thumbnail":
      return 20_000;
    case "download":
      return 60_000;
  }
}

/**
 * 本步实际超时 = min(放大后的超时, deadline - now - reserve)。
 * 剩余不足 MIN_STEP_MS 直接抛预算异常（不开始注定被杀的一步）。
 */
export function stepTimeout(
  budget: MediaBudget | undefined,
  step: StitchStep,
  mediaSec: number,
): { timeoutMs: number; capped: boolean } {
  const scaled = scaledStepTimeoutMs(step, mediaSec);
  if (!budget || budget.deadlineAt === null) return { timeoutMs: scaled, capped: false };
  const available = budget.deadlineAt - budget.now() - budget.reserveMs;
  if (available < MIN_STEP_MS) throw new StitchBudgetExceededError(step);
  return available < scaled
    ? { timeoutMs: available, capped: true }
    : { timeoutMs: scaled, capped: false };
}

type ExecFailure = Error & { killed?: boolean; signal?: string | null; stderr?: string };

function stderrTail(err: unknown): string {
  const failure = err as ExecFailure;
  const source =
    typeof failure?.stderr === "string" && failure.stderr.trim()
      ? failure.stderr
      : failure instanceof Error
        ? failure.message
        : String(err);
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" | ")
    .slice(0, 400);
}

/** 跑一步 ffmpeg：超时被预算封顶时转成 StitchBudgetExceededError（放回 PENDING 而不是判失败）。 */
export async function runStitchStep(
  args: string[],
  opts: {
    step: StitchStep;
    label: string;
    mediaSec: number;
    budget?: MediaBudget;
    maxBuffer?: number;
  },
) {
  const { timeoutMs, capped } = stepTimeout(opts.budget, opts.step, opts.mediaSec);
  try {
    return await runFfmpeg(args, {
      timeoutMs,
      maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 50,
      /// 超时必须准时停：SIGTERM 下 ffmpeg 会尝试优雅收尾，卡在无限流上时迟迟不退
      killSignal: "SIGKILL",
    });
  } catch (err) {
    const failure = err as ExecFailure;
    if (failure?.killed || failure?.signal === "SIGKILL" || failure?.signal === "SIGTERM") {
      if (capped) throw new StitchBudgetExceededError(opts.step);
      throw new Error(
        `ffmpeg ${opts.label} timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    throw new Error(`ffmpeg ${opts.label} failed: ${stderrTail(err)}`);
  }
}

// ---------------------------------------------------------------------------
// 片段
// ---------------------------------------------------------------------------

export type TimelineClipRole =
  | "ai_generated"
  | "uploaded"
  | "end_card"
  | "broll"
  | "other";

export interface TimelineClip {
  /** 本地文件路径（已下载） */
  path: string;
  /** 期望在成片里的时长；配合 trimToFit 决定是否截断 */
  intendedDurationSec: number | null;
  trimToFit: boolean;
  role?: TimelineClipRole;
  /**
   * 请求的语音安全裁尾秒数（只给 AI 生成段：Seedance/Shuyu 常在最后一秒幻觉出
   * 假名片 / 乱码电话）。b-roll、客户上传片段、尾卡一律不传。
   */
  tailTrimSec?: number;
  /** 必须带真实音轨（b-roll 配音）；探测不到音轨直接失败，绝不交付哑片 */
  requireAudio?: boolean;
  /** 不背字幕（尾卡 / CTA 卡）：字幕窗口按实际时长自动扣掉这些片段 */
  excludeFromCaptions?: boolean;
  /** 音轨取自这个文件（b-roll 的 TTS 配音），片段自身原声丢弃 */
  audioPath?: string;
  /** 画面循环补长（b-roll 素材短于口播） */
  loopVideo?: boolean;
  /** 显式输出时长（秒）：给了就不按源时长 / 裁尾推算（b-roll 由配音时长驱动） */
  targetDurationSec?: number;
  /**
   * 该段口播的逐词时间戳（毫秒，相对本段起点；来自 VideoJob.assignedAssets.voiceover.words）。
   * 有它字幕按词对齐；没有按段窗口铺（P04-B）。Phase 1 还没有供应商会写它。
   */
  voiceoverWords?: CaptionWord[] | null;
}

export interface TimelineClipReport {
  index: number;
  role: TimelineClipRole;
  sourceDurationSec: number | null;
  durationSec: number;
  frames: number;
  hasAudio: boolean;
  tailTrimmedSec: number;
  speechLimited: boolean;
}

export async function probeClip(
  filePath: string,
  budget?: MediaBudget,
): Promise<MediaProbe> {
  const { timeoutMs } = stepTimeout(budget, "probe", 1);
  return probeMedia(filePath, { timeoutMs });
}

/**
 * 纯函数：保留时长。null = 用原长。
 *   - trimToFit：截到期望时长（下限 1s，与改造前一致）
 *   - AI 段语音安全裁尾：截到 tailKeepSec
 */
export function resolveClipKeepSec(args: {
  sourceDurationSec: number | null;
  intendedDurationSec: number | null;
  trimToFit: boolean;
  tailKeepSec: number | null;
}): number | null {
  const candidates: number[] = [];
  if (args.trimToFit && args.intendedDurationSec) {
    candidates.push(Math.max(1, args.intendedDurationSec));
  }
  if (args.tailKeepSec !== null && args.tailKeepSec > 0) {
    candidates.push(args.tailKeepSec);
  }
  if (candidates.length === 0) return null;
  const keep = Math.min(...candidates);
  if (args.sourceDurationSec !== null && keep >= args.sourceDurationSec - 0.001) {
    return null;
  }
  return Math.round(keep * 1000) / 1000;
}

/** "24" / "30000/1001" / "23.976" → 数值帧率 */
export function frameRateValue(fps: string): number {
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(fps.trim());
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const value = Number(fps);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

/** 纯函数：时长量化到整帧（视频按帧截断、音频按同一时长截采样，段内音画严格等长）。 */
export function quantizeToFrames(
  durationSec: number,
  fps: string,
): { frames: number; durationSec: number; samples: number } {
  const rate = frameRateValue(fps);
  const frames = Math.max(1, Math.round(durationSec * rate));
  const quantized = frames / rate;
  return {
    frames,
    durationSec: Math.round(quantized * 1_000_000) / 1_000_000,
    samples: Math.max(1, Math.round(quantized * STITCH_AUDIO_RATE)),
  };
}

// ---------------------------------------------------------------------------
// 单遍滤镜图（纯函数，可测）
// ---------------------------------------------------------------------------

export interface PlannedTimelineClip {
  /** 画面输入序号 */
  videoInput: number;
  /** 音频输入序号（null = 没有音轨，补静音） */
  audioInput: number | null;
  frames: number;
  samples: number;
}

function escapeFfmpegFilterPath(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

/**
 * 纯函数：单遍合成的 filter_complex。
 *   [v_i] = 缩放/pad/setsar/帧率 → 末帧克隆兜底 → 按帧数截断
 *   [a_i] = 重采样立体声 → 补静音 → 按采样数截断（无音轨：静音源按采样数截断）
 *   concat → [vcat][acat] → 字幕（ass）→ 混音计划（BGM 闪避 + 响度归一）
 */
export function buildTimelineFilterGraph(args: {
  clips: PlannedTimelineClip[];
  width: number;
  height: number;
  fps: string;
  ass: { path: string; fontsDir: string } | null;
  /** buildAudioFilterPlan 的 filterComplex（以 [acat] 为原生音轨）；null = 不混音直接用 [acat] */
  audioPlanFilter: string | null;
  audioPlanOutput: string | null;
}): { filterComplex: string; videoLabel: string; audioLabel: string } {
  const { width, height, fps } = args;
  const parts: string[] = [];
  const audioFormat = `aresample=${STITCH_AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  args.clips.forEach((clip, i) => {
    parts.push(
      `[${clip.videoInput}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${clip.frames},setpts=PTS-STARTPTS[v${i}]`,
    );
    parts.push(
      clip.audioInput === null
        ? `anullsrc=channel_layout=stereo:sample_rate=${STITCH_AUDIO_RATE},` +
            `atrim=end_sample=${clip.samples},asetpts=PTS-STARTPTS[a${i}]`
        : `[${clip.audioInput}:a:0]${audioFormat},apad,` +
            `atrim=end_sample=${clip.samples},asetpts=PTS-STARTPTS[a${i}]`,
    );
  });
  const concatInputs = args.clips.map((_, i) => `[v${i}][a${i}]`).join("");
  parts.push(`${concatInputs}concat=n=${args.clips.length}:v=1:a=1[vcat][acat]`);
  let videoLabel = "[vcat]";
  if (args.ass) {
    parts.push(
      `[vcat]ass=filename='${escapeFfmpegFilterPath(args.ass.path)}':fontsdir='${escapeFfmpegFilterPath(args.ass.fontsDir)}'[vout]`,
    );
    videoLabel = "[vout]";
  }
  let audioLabel = "[acat]";
  if (args.audioPlanFilter && args.audioPlanOutput) {
    parts.push(args.audioPlanFilter);
    audioLabel = args.audioPlanOutput;
  }
  return { filterComplex: parts.join(";"), videoLabel, audioLabel };
}

// ---------------------------------------------------------------------------
// 缩略图（与 scripts/stitch-runner.ts 同一规则）
// ---------------------------------------------------------------------------

/** 纯函数：开场过渡之后的一帧；短片也有合法候选，长片不深 seek。 */
export function thumbnailSeekSeconds(durationSec: number | null): number {
  const safe = durationSec !== null && Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  return Math.min(2, Math.max(0.25, safe * 0.1));
}

export async function extractFinalThumbnail(args: {
  videoPath: string;
  outputPath: string;
  durationSec: number | null;
  budget?: MediaBudget;
}): Promise<void> {
  const seek = thumbnailSeekSeconds(args.durationSec);
  try {
    await runStitchStep(
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        args.videoPath,
        "-ss",
        seek.toFixed(3),
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2",
        "-q:v",
        "2",
        args.outputPath,
      ],
      { step: "thumbnail", label: "thumbnail", mediaSec: 1, budget: args.budget },
    );
  } catch (err) {
    if (err instanceof StitchBudgetExceededError) throw err;
    /// 元数据时长不准时退到代表帧选择器，绝不在没有预览图的情况下完成
    await runStitchStep(
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        args.videoPath,
        "-vf",
        "thumbnail=30,scale=480:-2",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        args.outputPath,
      ],
      { step: "thumbnail", label: "thumbnail fallback", mediaSec: 1, budget: args.budget },
    );
  }
}

// ---------------------------------------------------------------------------
// 整条时间线
// ---------------------------------------------------------------------------

export interface ComposeTimelineInput {
  clips: TimelineClip[];
  aspectRatio: string;
  postProduction: PostProductionPlan | null;
  /**
   * 字幕窗口（秒）。显式传入优先（品牌封装：主片时长）；不传时若有 excludeFromCaptions
   * 片段，按量化后的实际时长 = 总长 - 被排除片段时长。
   */
  captionWindowSec?: number | null;
  workDir: string;
  /** 强制帧率（b-roll：30）；不传 = 主片（第一段）源帧率 */
  frameRate?: string;
  budget?: MediaBudget;
  /** 每个重步骤之前调用（任务被取消 / 被清扫器收回时抛错中止） */
  checkpoint?: () => Promise<void>;
  extractThumbnail?: boolean;
  /** 健康探针用 info 拿 libass 选字体日志；拼接器默认 error */
  logLevel?: "error" | "info";
  outputName?: string;
}

export interface ComposeTimelineOutput {
  videoPath: string;
  srtPath: string | null;
  thumbnailPath: string | null;
  durationSec: number;
  captionWindowSec: number | null;
  applied: { captions: boolean; audioMix: boolean; bgm: boolean };
  clips: TimelineClipReport[];
  timings: Record<string, number>;
  /** 主编码的 ffmpeg stderr（logLevel=info 时含 libass 日志） */
  stderr: string;
}

/** 纯函数：字幕窗口 = 显式值，或「总长 - 尾卡类片段时长」（无尾卡类片段 → null = 铺满）。 */
export function resolveCaptionWindowSec(args: {
  explicit: number | null | undefined;
  clips: Array<{ durationSec: number; excludeFromCaptions?: boolean }>;
}): number | null {
  if (args.explicit && args.explicit > 0) return args.explicit;
  const excluded = args.clips
    .filter((clip) => clip.excludeFromCaptions)
    .reduce((sum, clip) => sum + clip.durationSec, 0);
  if (excluded <= 0) return null;
  const total = args.clips.reduce((sum, clip) => sum + clip.durationSec, 0);
  const main = total - excluded;
  return main > 0 ? Math.round(main * 1000) / 1000 : null;
}

/** 纯函数：后期快照里哪些处理会生效（与改造前 applyLocalPostProduction 的判定一致）。 */
export function resolvePostProductionEffects(snapshot: PostProductionPlan | null): {
  active: boolean;
  captions: boolean;
  bgmPath: string | null;
  bgmVolume: number;
  script: string;
} {
  if (!snapshot) {
    return { active: false, captions: false, bgmPath: null, bgmVolume: 0, script: "" };
  }
  const script = snapshot.audio.voiceover.script.trim();
  const captions = snapshot.captions.enabled && Boolean(script);
  const bgm = BGM_TRACKS.find((track) => track.id === snapshot.audio.bgm.trackId);
  if (!bgm) throw new StitchCompositionError("BGM_TRACK_UNKNOWN", "Unknown licensed BGM track");
  const bgmEnabled = bgm.path !== null && snapshot.audio.bgm.volume > 0;
  return {
    active: captions || bgmEnabled || snapshot.audio.voiceover.enabled,
    captions,
    bgmPath: bgmEnabled ? bgm.path : null,
    bgmVolume: bgmEnabled ? snapshot.audio.bgm.volume : 0,
    script,
  };
}

/**
 * 纯函数（P04-B）：字幕时间轴怎么定。
 *   1. 有持久化逐词时间戳 —— 整片一份（postProduction.captions.words）优先；否则把各 AI 段
 *      自己的词按该段在成片里的累计偏移平移后拼起来 —— 用 buildTimedCues 按词对齐。
 *   2. 否则有 AI 段：口播稿按各段时长加权切成每段一句（与派发时同一规则），每段只在自己的
 *      窗口里铺字幕（buildWindowedCues）。
 *   3. 都没有（b-roll / 全是上传片段）：整片按字重均分（1025 之前的行为）。
 * 窗口 / 词都裁到字幕窗口（尾卡不背字幕）。
 */
export function planCaptionCues(args: {
  script: string;
  /** 已量化的段序列（成片顺序） */
  clips: ReadonlyArray<{
    durationSec: number;
    role: TimelineClipRole;
    voiceoverWords?: CaptionWord[] | null;
  }>;
  captionSpanSec: number;
  /** postProduction.captions.words（毫秒，相对成片起点） */
  filmWords?: unknown;
}): { cues: CaptionCue[]; source: "words" | "windows" | "uniform" } {
  const captionSpanMs = Math.max(1, Math.round(args.captionSpanSec * 1_000));
  const filmWords = parseCaptionWords(args.filmWords);
  if (filmWords) {
    return { cues: buildTimedCues(filmWords, { maxEndMs: captionSpanMs }), source: "words" };
  }
  const shifted: CaptionWord[] = [];
  let offsetMs = 0;
  for (const clip of args.clips) {
    const durationMs = Math.max(0, Math.round(clip.durationSec * 1_000));
    const words = clip.role === "ai_generated" ? parseCaptionWords(clip.voiceoverWords) : null;
    if (words) {
      for (const word of words) {
        /// 裁尾 / trimToFit 截掉的那段里的词不进字幕
        if (word.startMs >= durationMs) continue;
        shifted.push({
          text: word.text,
          startMs: offsetMs + word.startMs,
          endMs: offsetMs + Math.min(word.endMs, durationMs),
        });
      }
    }
    offsetMs += durationMs;
  }
  if (shifted.length > 0) {
    return { cues: buildTimedCues(shifted, { maxEndMs: captionSpanMs }), source: "words" };
  }
  const windows = captionWindowsFromSegments(
    args.clips.map((clip) => ({ durationSec: clip.durationSec, captioned: clip.role === "ai_generated" })),
    captionSpanMs,
  );
  if (windows.length > 0) {
    return {
      cues: buildWindowedCues(splitScriptByWindows(args.script, windows), windows),
      source: "windows",
    };
  }
  return { cues: buildDeterministicCues(args.script, args.captionSpanSec), source: "uniform" };
}

interface PlannedClipState {
  clip: TimelineClip;
  role: TimelineClipRole;
  probe: MediaProbe;
  hasAudio: boolean;
  frames: number;
  samples: number;
  durationSec: number;
  tailTrimmedSec: number;
  speechLimited: boolean;
}

export async function composeTimeline(
  input: ComposeTimelineInput,
): Promise<ComposeTimelineOutput> {
  if (input.clips.length === 0) {
    throw new StitchCompositionError("NO_CLIPS", "no clips to compose");
  }
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = (timings[name] ?? 0) + (Date.now() - started);
    }
  };
  const { width, height } = resolveAspectResolution(input.aspectRatio);
  await mkdir(input.workDir, { recursive: true });
  const effects = resolvePostProductionEffects(input.postProduction);

  // ---- 第一遍：探测 + 定每段时长（不编码） ----
  const states: PlannedClipState[] = [];
  let targetFps: string | null = input.frameRate ?? null;
  for (const [index, clip] of input.clips.entries()) {
    await input.checkpoint?.();
    const role = clip.role ?? "other";
    const probe = await timed("probe", () => probeClip(clip.path, input.budget)).catch(
      (err: unknown) => {
        if (err instanceof StitchBudgetExceededError) throw err;
        throw new StitchCompositionError(
          "CLIP_UNREADABLE",
          `clip #${index} could not be probed: ${(err as Error).message}`,
        );
      },
    );
    if (!probe.hasVideo) {
      throw new StitchCompositionError("CLIP_HAS_NO_VIDEO", `clip #${index} has no video stream`);
    }
    let hasAudio = probe.hasAudio;
    if (clip.audioPath) {
      const audioProbe = await timed("probe", () =>
        probeClip(clip.audioPath as string, input.budget),
      ).catch((err: unknown) => {
        if (err instanceof StitchBudgetExceededError) throw err;
        throw new StitchCompositionError(
          "CLIP_AUDIO_UNREADABLE",
          `clip #${index} audio could not be probed: ${(err as Error).message}`,
        );
      });
      hasAudio = audioProbe.hasAudio;
    }
    if (clip.requireAudio && !hasAudio) {
      throw new StitchCompositionError(
        "BROLL_VOICE_TRACK_MISSING",
        `clip #${index} must carry its voice track but has no audio stream`,
      );
    }
    /// 保留主片（第一段）的源帧率，不强转 30fps（Shuyu 原片 24fps）；其余片段归一到同一帧率。
    if (targetFps === null) targetFps = pickStitchFrameRate([probe.fps]);

    let tailTrimmedSec = 0;
    let speechLimited = false;
    let durationSec: number;
    if (clip.targetDurationSec && clip.targetDurationSec > 0) {
      durationSec = clip.targetDurationSec;
    } else {
      if (!probe.durationSec || !Number.isFinite(probe.durationSec)) {
        throw new StitchCompositionError(
          "CLIP_DURATION_UNKNOWN",
          `clip #${index} has no readable duration`,
        );
      }
      let tailKeepSec: number | null = null;
      if ((clip.tailTrimSec ?? 0) > 0 && !clip.audioPath) {
        const plan = await timed("silence", async () =>
          measureSpeechSafeTailTrim(clip.path, {
            requestedTailSec: clip.tailTrimSec ?? 0,
            durationSec: probe.durationSec ?? undefined,
            hasAudio: probe.hasAudio,
            timeoutMs: stepTimeout(input.budget, "silence", probe.durationSec ?? 15).timeoutMs,
          }),
        );
        speechLimited = plan.speechLimited;
        if (plan.trimSec > 0) {
          tailTrimmedSec = plan.trimSec;
          tailKeepSec = plan.keepSec;
        }
      }
      durationSec =
        resolveClipKeepSec({
          sourceDurationSec: probe.durationSec,
          intendedDurationSec: clip.intendedDurationSec,
          trimToFit: clip.trimToFit,
          tailKeepSec,
        }) ?? probe.durationSec;
    }
    states.push({
      clip,
      role,
      probe,
      hasAudio,
      frames: 0,
      samples: 0,
      durationSec,
      tailTrimmedSec,
      speechLimited,
    });
  }
  const fps = targetFps ?? "30";
  for (const state of states) {
    const quantized = quantizeToFrames(state.durationSec, fps);
    state.frames = quantized.frames;
    state.samples = quantized.samples;
    state.durationSec = quantized.durationSec;
  }

  /// 要口播的成片：AI 段一条音轨都没有 = 供应商把口播弄丢了。改造前生产 runner 在这里
  /// 会因为引用不存在的音轨而失败；补静音后要显式守住，不能静默交付哑片。
  const aiStates = states.filter((state) => state.role === "ai_generated");
  if (
    input.postProduction?.audio.voiceover.enabled &&
    aiStates.length > 0 &&
    !aiStates.some((state) => state.hasAudio)
  ) {
    throw new StitchCompositionError(
      "VOICEOVER_TRACK_MISSING",
      "voiceover was requested but none of the AI-generated segments carries an audio track",
    );
  }

  const totalSec =
    Math.round(states.reduce((sum, state) => sum + state.durationSec, 0) * 1000) / 1000;
  const captionWindowSec = resolveCaptionWindowSec({
    explicit: input.captionWindowSec,
    clips: states.map((state) => ({
      durationSec: state.durationSec,
      excludeFromCaptions: state.clip.excludeFromCaptions,
    })),
  });

  // ---- 字幕（时长在编码前就已确定：按帧量化后的总长 / 字幕窗口） ----
  let ass: { path: string; fontsDir: string } | null = null;
  let srtPath: string | null = null;
  if (effects.captions && input.postProduction) {
    /// 函数运行时没有系统字体：fontsdir 让 libass 直接加载打包的 Noto Sans SC，
    /// FONTCONFIG_FILE（runFfmpeg 注入）兜住 fontconfig 回退。缺字体 = fail closed。
    const { fontDir } = ensureMediaFonts();
    if (!fontDir) {
      throw new StitchCompositionError(
        "CAPTION_FONT_MISSING",
        "bundled CJK caption font is missing in this runtime; refusing to burn tofu captions",
      );
    }
    /// 台词只属于口播所在的主片段：窗口外（尾卡/静帧英雄镜头）不背字幕。
    const captionSpanSec =
      captionWindowSec && captionWindowSec > 0 ? Math.min(totalSec, captionWindowSec) : totalSec;
    /// P04-B：有逐词时间戳按词；否则按 AI 段窗口（段时长已按帧量化）；都没有才整片均分
    const { cues } = planCaptionCues({
      script: effects.script,
      clips: states.map((state) => ({
        durationSec: state.durationSec,
        role: state.role,
        voiceoverWords: state.clip.voiceoverWords,
      })),
      captionSpanSec,
      filmWords: input.postProduction.captions.words,
    });
    const assPath = path.join(input.workDir, "captions.ass");
    const aspectRatio =
      input.aspectRatio === "16:9" || input.aspectRatio === "1:1" ? input.aspectRatio : "9:16";
    await writeFile(
      assPath,
      renderAssCaptions(cues, {
        aspectRatio,
        position: input.postProduction.captions.position,
        style: input.postProduction.captions.style,
        language: input.postProduction.captions.language,
      }),
      "utf8",
    );
    ass = { path: assPath, fontsDir: fontDir };
    if (input.postProduction.captions.exportSrt) {
      srtPath = path.join(input.workDir, "captions.srt");
      await writeFile(srtPath, renderSrtCaptions(cues), "utf8");
    }
  }

  // ---- 输入 ----
  const inputArgs: string[] = [];
  let nextInput = 0;
  const planned: PlannedTimelineClip[] = states.map((state) => {
    if (state.clip.loopVideo) inputArgs.push("-stream_loop", "-1");
    inputArgs.push("-i", state.clip.path);
    const videoInput = nextInput++;
    let audioInput: number | null = null;
    if (state.clip.audioPath) {
      inputArgs.push("-i", state.clip.audioPath);
      const index = nextInput++;
      audioInput = state.hasAudio ? index : null;
    } else if (state.hasAudio) {
      audioInput = videoInput;
    }
    return { videoInput, audioInput, frames: state.frames, samples: state.samples };
  });

  /// Shuyu 口播属于生成模型的原生音轨（b-roll 是烘进去的配音），拼接只负责保留 / 标准化
  /// 并与 BGM 闪避混音，绝不叠另一家 TTS。concat 之后每段都有音轨（真实或补的静音），
  /// 原生音轨恒存在，不会再出现「判成无口播 → 人声被换成纯音乐」。
  let audioPlanFilter: string | null = null;
  let audioPlanOutput: string | null = null;
  if (effects.active) {
    /// BGM 是最后一个输入（序号 = 当前 nextInput）
    const plan = buildAudioFilterPlan({
      bgmVolume: effects.bgmVolume,
      hasNativeAudio: true,
      durationSec: totalSec,
      sourceAudioLabel: "[acat]",
      bgmInputIndex: effects.bgmPath ? nextInput : undefined,
    });
    if (effects.bgmPath) {
      inputArgs.push(
        ...plan.bgmInputArgs,
        "-i",
        /// turbopackIgnore：动态路径会让文件追踪把整个项目打进每个引用本模块的函数
        /// （4.7 体积核算实测 ~180MB）；BGM 由 next.config.ts 按路由精确打包。
        path.resolve(/*turbopackIgnore: true*/ process.cwd(), effects.bgmPath),
      );
      nextInput += 1;
    }
    audioPlanFilter = plan.filterComplex || null;
    audioPlanOutput = plan.outputLabel;
  }

  const graph = buildTimelineFilterGraph({
    clips: planned,
    width,
    height,
    fps,
    ass,
    audioPlanFilter,
    audioPlanOutput,
  });

  // ---- 唯一一次编码 ----
  await input.checkpoint?.();
  const outputPath = path.join(input.workDir, input.outputName ?? "composed.mp4");
  const ffmpegArgs = [
    "-y",
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-loglevel",
    input.logLevel ?? "error",
    ...inputArgs,
    "-filter_complex",
    graph.filterComplex,
    "-map",
    graph.videoLabel,
    "-map",
    graph.audioLabel,
    "-c:v",
    "libx264",
    "-preset",
    STITCH_X264_PRESET,
    "-crf",
    STITCH_VIDEO_CRF,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    STITCH_AUDIO_BITRATE,
    "-ar",
    String(STITCH_AUDIO_RATE),
    "-ac",
    "2",
    /// 所有流本身都是有限的（按帧 / 采样截断）；-t 只是防无限流卡死的保险丝
    "-t",
    (totalSec + 1).toFixed(3),
    "-movflags",
    "+faststart",
    outputPath,
  ];
  const { stderr } = await timed("encode", () =>
    runStitchStep(ffmpegArgs, {
      step: "encode",
      label: "timeline encode",
      mediaSec: totalSec,
      budget: input.budget,
    }),
  );

  /// 成片已经编好：收尾的探测 / 抽缩略图可以动用一部分「上传预留」，
  /// 不能因为编码刚好贴着预算结束就把做完的成片放回 PENDING。
  const tailBudget: MediaBudget | undefined = input.budget
    ? { ...input.budget, reserveMs: Math.min(input.budget.reserveMs, 5_000) }
    : undefined;
  const finalProbe = await probeClip(outputPath, tailBudget);
  const durationSec = finalProbe.durationSec ?? totalSec;

  let thumbnailPath: string | null = null;
  if (input.extractThumbnail) {
    thumbnailPath = path.join(input.workDir, "thumbnail.jpg");
    await timed("thumbnail", () =>
      extractFinalThumbnail({
        videoPath: outputPath,
        outputPath: thumbnailPath as string,
        durationSec,
        budget: tailBudget,
      }),
    );
  }

  return {
    videoPath: outputPath,
    srtPath,
    thumbnailPath,
    durationSec,
    captionWindowSec,
    applied: {
      captions: Boolean(ass),
      audioMix: Boolean(audioPlanOutput),
      bgm: Boolean(effects.bgmPath),
    },
    clips: states.map((state, index) => ({
      index,
      role: state.role,
      sourceDurationSec: state.probe.durationSec,
      durationSec: state.durationSec,
      frames: state.frames,
      hasAudio: state.hasAudio,
      tailTrimmedSec: state.tailTrimmedSec,
      speechLimited: state.speechLimited,
    })),
    timings,
    stderr,
  };
}
