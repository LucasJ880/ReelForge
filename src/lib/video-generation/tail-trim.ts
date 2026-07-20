/**
 * 裁尾 — 品牌包装前砍掉 AI 原片最后 0.5–1s。
 *
 * 背景：Seedance 常在最后一秒幻觉出假名片/花体品牌字/乱码电话。
 * 平台策略是真尾卡一律后期拼接，所以拼接前先把原片尾部裁掉，
 * 幻觉内容永远到不了客户手里。
 */

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_TAIL_TRIM_SECONDS = 0.8;
/** 裁完至少要剩这么长，防止把短片裁没 */
const MIN_KEEP_SECONDS = 5;

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

/**
 * 裁掉尾部 tailSeconds，返回裁剪后文件路径（重编码，保证精确到帧）。
 * 视频太短不够裁时原样返回 sourcePath。
 */
export async function trimVideoTail(
  sourcePath: string,
  opts: { tailSeconds?: number; outputPath?: string } = {},
): Promise<string> {
  const tail = opts.tailSeconds ?? DEFAULT_TAIL_TRIM_SECONDS;
  const duration = await probeDurationSeconds(sourcePath);
  const target = duration - tail;
  if (target < MIN_KEEP_SECONDS) return sourcePath;

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
  return outputPath;
}
