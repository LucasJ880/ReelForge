/**
 * 静帧运动镜头 — 把一张高分产品静帧渲染成短运动 clip（Ken Burns 平移）。
 *
 * 用途：品牌 logo 英雄镜头。I2V 模型逐帧重绘画面，印在产品上的字标
 * 必然被重画/涂花（brand-logo 0804 验收实锤：真 lockup 被换成另一套
 * 金字，中景直接成乱码）。唯一保真的做法是让 logo 特写不经过生成模型：
 * 直接取已验收的印 logo 静帧，原生像素裁窗 + 缓慢漂移，后期拼进成片。
 * 2K 静帧裁 1080x1920 窗口后通常是全片最锐的一镜。
 *
 * 实现用 crop 的逐帧 x/y 表达式而不是 zoompan：恒定窗口 + 线性平移
 * 没有 zoompan 的亚像素抖动问题。
 */

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type StillMotionSpec = {
  stillPath: string;
  outputPath: string;
  /** 裁窗（源图像素坐标），w/h 恒定；输出 lanczos 缩放到 outWidth/outHeight */
  crop: { width: number; height: number; x: number; y: number };
  /** 整段时长内的平移量（像素，可负；漂移轨迹必须始终落在源图内） */
  drift?: { dx?: number; dy?: number };
  durationSeconds?: number;
  fps?: number;
  outWidth?: number;
  outHeight?: number;
};

async function probeImageSize(
  path: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    path,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  if (!width || !height) throw new Error(`ffprobe size failed for ${path}`);
  return { width, height };
}

/** 渲染无声运动镜头（音轨由 stitch 归一化时补静音），返回 outputPath。 */
export async function renderStillMotionClip(
  spec: StillMotionSpec,
): Promise<string> {
  const duration = spec.durationSeconds ?? 2;
  const fps = spec.fps ?? 30;
  const outW = spec.outWidth ?? 1080;
  const outH = spec.outHeight ?? 1920;
  const { width, height, x, y } = spec.crop;
  const dx = spec.drift?.dx ?? 0;
  const dy = spec.drift?.dy ?? 0;

  const image = await probeImageSize(spec.stillPath);
  const minX = Math.min(x, x + dx);
  const maxX = Math.max(x, x + dx);
  const minY = Math.min(y, y + dy);
  const maxY = Math.max(y, y + dy);
  if (minX < 0 || minY < 0 || maxX + width > image.width || maxY + height > image.height) {
    throw new Error(
      `still-motion crop out of bounds: crop=${width}x${height}@(${x},${y}) drift=(${dx},${dy}) image=${image.width}x${image.height}`,
    );
  }

  const xExpr = dx === 0 ? String(x) : `${x}+${(dx / duration).toFixed(4)}*t`;
  const yExpr = dy === 0 ? String(y) : `${y}+${(dy / duration).toFixed(4)}*t`;
  mkdirSync(dirname(spec.outputPath), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-loop", "1",
    "-framerate", String(fps),
    "-i", spec.stillPath,
    "-t", duration.toFixed(3),
    "-vf",
    `crop=${width}:${height}:${xExpr}:${yExpr},scale=${outW}:${outH}:flags=lanczos,setsar=1,format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "17",
    "-movflags", "+faststart",
    spec.outputPath,
  ]);
  return spec.outputPath;
}
