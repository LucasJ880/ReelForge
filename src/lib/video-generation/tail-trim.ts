/**
 * 裁尾 — 品牌包装前砍掉 AI 原片最后 0.5–1s。
 *
 * 背景：Seedance 常在最后一秒幻觉出假名片/花体品牌字/乱码电话。
 * 平台策略是真尾卡一律后期拼接，所以拼接前先把原片尾部裁掉，
 * 幻觉内容永远到不了客户手里。
 *
 * 2026-08-05 起裁尾对语音安全：先探测音频活动的结束点，请求的裁尾量
 * 会切进人声时自动缩短甚至放弃（brand-logo 0804 验收实锤：口播讲到
 * 14.8s / 全片 15.0s，盲裁 0.8s 把收尾的 "need it." 物理切掉，
 * 而烧录字幕还写着这三个词）。宁可留 0.3s 可能的幻觉，不切一个字的人声。
 */

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_TAIL_TRIM_SECONDS = 0.8;
/** 裁完至少要剩这么长，防止把短片裁没 */
const MIN_KEEP_SECONDS = 5;
/** 音频活动结束点之后至少保留的缓冲 */
const SPEECH_PADDING_SECONDS = 0.15;
/** 低于此值的实际裁剪没有意义，直接放弃（省一次转码） */
const MIN_EFFECTIVE_TRIM_SECONDS = 0.05;
/** 口播/音效在 -30dB 以上视为活动；0.3s 以上的低电平才算真静音 */
const SILENCE_NOISE_FLOOR = "-30dB";
const SILENCE_MIN_DURATION_SECONDS = 0.3;

export async function probeDurationSeconds(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    path,
  ]);
  const parsed = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`ffprobe duration failed for ${path}`);
  }
  return parsed;
}

async function probeHasAudioStream(path: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    path,
  ]);
  return stdout.trim().length > 0;
}

/**
 * 音频活动（人声/音效）最后结束在第几秒。
 * - null：没有音轨，裁尾按纯视觉逻辑走。
 * - durationSec：声音一直响到文件结束（此时任何裁尾都会切声音）。
 */
export async function detectLastAudioActivityEndSeconds(
  path: string,
  durationSec: number,
): Promise<number | null> {
  if (!(await probeHasAudioStream(path))) return null;
  let stderr: string;
  try {
    const result = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-i", path,
        "-af", `silencedetect=noise=${SILENCE_NOISE_FLOOR}:d=${SILENCE_MIN_DURATION_SECONDS}`,
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 10 },
    );
    stderr = result.stderr ?? "";
  } catch {
    /// 探测失败按最保守处理：当作声音响到结尾，避免误裁。
    return durationSec;
  }

  /// silencedetect 事件成对出现；文件在静音中结束时最后一个 start 可能没有 end。
  const events = [...stderr.matchAll(/silence_(start|end): ([0-9.]+)/g)].map(
    (match) => ({ kind: match[1], at: Number.parseFloat(match[2]) }),
  );
  let openStart: number | null = null;
  let lastClosed: { start: number; end: number } | null = null;
  for (const event of events) {
    if (event.kind === "start") {
      openStart = event.at;
    } else if (openStart !== null) {
      lastClosed = { start: openStart, end: event.at };
      openStart = null;
    }
  }
  if (openStart !== null) return Math.min(openStart, durationSec);
  if (lastClosed && lastClosed.end >= durationSec - 0.2) {
    return Math.min(lastClosed.start, durationSec);
  }
  return durationSec;
}

/**
 * 纯决策：给定请求的裁尾量与音频活动结束点，算出真正可裁的秒数。
 * activityEndSec 为 null（无音轨）时按请求量盲裁。
 */
export function resolveSpeechSafeTailTrim(args: {
  durationSec: number;
  requestedTailSec: number;
  activityEndSec: number | null;
}): { trimSec: number; speechLimited: boolean } {
  const requested = Math.max(0, args.requestedTailSec);
  if (args.activityEndSec === null) {
    return { trimSec: requested, speechLimited: false };
  }
  const safeKeep = Math.min(
    args.durationSec,
    args.activityEndSec + SPEECH_PADDING_SECONDS,
  );
  const maxTrim = Math.max(0, args.durationSec - safeKeep);
  if (maxTrim >= requested) return { trimSec: requested, speechLimited: false };
  return { trimSec: maxTrim, speechLimited: true };
}

export type TailTrimOutcome = {
  path: string;
  /** 实际裁掉的秒数；0 = 没裁，path 就是原样的 sourcePath */
  trimmedSeconds: number;
  /** true = 为保住片尾语音而缩短/放弃了请求的裁尾量 */
  speechLimited: boolean;
};

/**
 * 语音安全裁尾：探测音频活动结束点后裁掉尾部（重编码，精确到帧）。
 * respectAudio=false 恢复旧的盲裁行为（仅限确认无口播的素材）。
 */
export async function trimVideoTailSpeechSafe(
  sourcePath: string,
  opts: {
    tailSeconds?: number;
    outputPath?: string;
    respectAudio?: boolean;
  } = {},
): Promise<TailTrimOutcome> {
  const requested = opts.tailSeconds ?? DEFAULT_TAIL_TRIM_SECONDS;
  const duration = await probeDurationSeconds(sourcePath);
  if (duration - requested < MIN_KEEP_SECONDS) {
    return { path: sourcePath, trimmedSeconds: 0, speechLimited: false };
  }

  const activityEnd =
    (opts.respectAudio ?? true)
      ? await detectLastAudioActivityEndSeconds(sourcePath, duration)
      : null;
  const { trimSec, speechLimited } = resolveSpeechSafeTailTrim({
    durationSec: duration,
    requestedTailSec: requested,
    activityEndSec: activityEnd,
  });
  if (trimSec < MIN_EFFECTIVE_TRIM_SECONDS) {
    return { path: sourcePath, trimmedSeconds: 0, speechLimited };
  }

  const target = duration - trimSec;
  const outputPath =
    opts.outputPath ??
    join(
      dirname(sourcePath),
      `trimmed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
    );
  mkdirSync(dirname(outputPath), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-v", "error",
    "-i", sourcePath,
    "-t", target.toFixed(3),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
    "-y",
  ]);
  return { path: outputPath, trimmedSeconds: trimSec, speechLimited };
}

/**
 * 兼容旧签名：只关心产物路径的调用方继续用它（同样语音安全）。
 * 视频太短不够裁时原样返回 sourcePath。
 */
export async function trimVideoTail(
  sourcePath: string,
  opts: { tailSeconds?: number; outputPath?: string } = {},
): Promise<string> {
  return (await trimVideoTailSpeechSafe(sourcePath, opts)).path;
}
