"use client";

/**
 * Brand Lock 合成器 —— 在浏览器端用 ffmpeg.wasm 对 raw 视频做品牌硬叠加。
 *
 * 设计目标：
 * - 对商家承诺：不管 AI 怎么生成，最终视频 100% 有 logo / 产品 / 品牌文字
 * - 同一套代码被 Pro 通道（Seedance 完成后调用）和 Free 通道（合成时顺手调用）共用
 * - 全部在浏览器执行，Vercel Serverless 零压力
 *
 * 当前支持的模板：
 * - corner_watermark：右下角/其他角持续 logo 水印
 * - intro_outro：片头 1.5s 全屏产品图 + 片尾 2s 全屏产品图（保留 AI 视频中段）
 * - full_package：角标水印 + 片头/片尾闪帧 + 可选 Slogan 叠加
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export type BrandLockTemplate =
  | "none"
  | "corner_watermark"
  | "intro_outro"
  | "full_package";

export type BrandLockPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

export interface BrandLockConfig {
  template: BrandLockTemplate;
  /** 角标 / 片头片尾用到的 logo 图 URL。优先使用 project.logoUrl，否则 primaryImageUrl。 */
  logoUrl?: string;
  /** 片头/片尾闪帧用到的产品图（通常就是 primaryImageUrl）。 */
  productImageUrl?: string;
  /** 角标位置 */
  position: BrandLockPosition;
  /** 水印不透明度 0–100 */
  opacity: number;
  /** 叠加的品牌文字（full_package 使用） */
  slogan?: string;
}

export type ProgressCallback = (pct: number, message?: string) => void;

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } finally {
    ffmpegLoadPromise = null;
  }
}

/**
 * 角标位置 → overlay filter 坐标表达式。
 * margin 相对于画面宽度的百分比，保证不同分辨率下视觉一致。
 */
function positionToOverlayExpr(
  position: BrandLockPosition,
  marginRatio = 0.025,
): string {
  const margin = `W*${marginRatio}`;
  switch (position) {
    case "bottom-right":
      return `W-w-${margin}:H-h-${margin}`;
    case "bottom-left":
      return `${margin}:H-h-${margin}`;
    case "top-right":
      return `W-w-${margin}:${margin}`;
    case "top-left":
      return `${margin}:${margin}`;
  }
}

/**
 * 生成 corner_watermark filter_complex 片段。
 *
 * 逻辑：
 *   [1:v] scale 到画面宽度 12% → format=rgba → 乘上不透明度 → [lg]
 *   [0:v][lg] overlay=位置
 */
function buildCornerWatermarkFilter(cfg: BrandLockConfig): string {
  const alpha = Math.max(0, Math.min(100, cfg.opacity)) / 100;
  const overlayPos = positionToOverlayExpr(cfg.position);
  return (
    `[1:v]scale=iw*0.14:-1,format=rgba,colorchannelmixer=aa=${alpha.toFixed(2)}[lg];` +
    `[0:v][lg]overlay=${overlayPos}:format=auto`
  );
}

/**
 * 通过站内 proxy 抓远程资源（避开 CORS）
 */
function proxy(url: string): string {
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `/api/proxy-video?url=${encodeURIComponent(url)}`;
}

/**
 * 入口：对 raw 视频执行 Brand Lock 合成，返回 branded Blob。
 */
export async function applyBrandLock(
  rawVideoUrl: string,
  cfg: BrandLockConfig,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  if (cfg.template === "none") {
    throw new Error("Brand Lock template is 'none', nothing to compose");
  }

  onProgress?.(1, "加载 FFmpeg 核心...");
  const ffmpeg = await getFFmpeg();
  onProgress?.(8, "FFmpeg 就绪");

  onProgress?.(12, "下载视频和品牌素材...");
  const videoData = await fetchFile(proxy(rawVideoUrl));
  await ffmpeg.writeFile("raw.mp4", videoData);

  if (cfg.template === "corner_watermark") {
    return await runCornerWatermark(ffmpeg, cfg, onProgress);
  }

  // TODO: intro_outro / full_package 在 Commit D 实现
  throw new Error(
    `Brand Lock template "${cfg.template}" 暂未实现，当前仅支持 corner_watermark`,
  );
}

async function runCornerWatermark(
  ffmpeg: FFmpeg,
  cfg: BrandLockConfig,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const logoSource = cfg.logoUrl || cfg.productImageUrl;
  if (!logoSource) {
    throw new Error("Brand Lock 合成失败：未提供 logo 或产品图");
  }

  onProgress?.(18, "下载 Logo 素材...");
  const logoData = await fetchFile(proxy(logoSource));
  // ffmpeg.wasm 需要识别后缀来选解码器；PNG/JPG 都按 .png 写入没问题（libpng 通用）
  const logoExt = guessImageExt(logoSource);
  const logoFile = `logo.${logoExt}`;
  await ffmpeg.writeFile(logoFile, logoData);

  const filter = buildCornerWatermarkFilter(cfg);

  onProgress?.(25, "叠加品牌水印...");
  ffmpeg.on("progress", ({ progress }) => {
    const pct = Math.max(0, Math.min(1, progress));
    onProgress?.(25 + Math.floor(pct * 65));
  });

  await ffmpeg.exec([
    "-i", "raw.mp4",
    "-i", logoFile,
    "-filter_complex", filter,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "branded.mp4",
  ]);

  onProgress?.(92, "读取成品...");
  const data = await ffmpeg.readFile("branded.mp4");
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  for (const f of ["raw.mp4", logoFile, "branded.mp4"]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {
      /* ignore */
    }
  }

  onProgress?.(100, "品牌合成完成");

  return new Blob([bytes as unknown as BlobPart], { type: "video/mp4" });
}

function guessImageExt(url: string): "png" | "jpg" | "webp" {
  const lower = url.toLowerCase();
  if (lower.includes(".webp")) return "webp";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "jpg";
  return "png";
}

/**
 * 便利函数：从 Project 字段转成合成器配置。
 */
export function buildBrandLockConfig(project: {
  logoUrl?: string | null;
  primaryImageUrl?: string | null;
  brandLockEnabled?: boolean | null;
  brandLockTemplate?: string | null;
  brandLockPosition?: string | null;
  brandLockOpacity?: number | null;
  brandLockSlogan?: string | null;
}): BrandLockConfig | null {
  if (project.brandLockEnabled === false) return null;

  const template = (project.brandLockTemplate ||
    "corner_watermark") as BrandLockTemplate;
  if (template === "none") return null;

  const logoUrl = project.logoUrl || project.primaryImageUrl || undefined;
  if (!logoUrl) return null;

  const position = (project.brandLockPosition ||
    "bottom-right") as BrandLockPosition;

  return {
    template,
    logoUrl,
    productImageUrl: project.primaryImageUrl || undefined,
    position,
    opacity: typeof project.brandLockOpacity === "number"
      ? project.brandLockOpacity
      : 85,
    slogan: project.brandLockSlogan || undefined,
  };
}
