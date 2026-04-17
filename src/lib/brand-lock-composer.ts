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
import { toBlobURL } from "@ffmpeg/util";

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
let lastLogLines: string[] = [];

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    ffmpeg.on("log", ({ message }) => {
      lastLogLines.push(message);
      if (lastLogLines.length > 30) lastLogLines.shift();
    });
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

function resetFFmpeg() {
  try {
    ffmpegInstance?.terminate();
  } catch {
    /* ignore */
  }
  ffmpegInstance = null;
  ffmpegLoadPromise = null;
  lastLogLines = [];
}

async function safeFetchBytes(url: string, label: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `[${label}] 下载失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok) {
    let detail = res.statusText;
    if (ct.includes("application/json")) {
      try {
        const j = (await res.json()) as {
          error?: string;
          reason?: string;
        };
        detail = `${j.error ?? ""} ${j.reason ?? ""}`.trim() || res.statusText;
      } catch {
        /* ignore */
      }
    }
    throw new Error(`[${label}] HTTP ${res.status} - ${detail}`);
  }
  if (ct.includes("application/json") || ct.includes("text/html")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[${label}] 上游返回 ${ct} 而非二进制：${text.slice(0, 200)}`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(`[${label}] 响应体为空`);
  }
  return buf;
}

async function execWithGuard(
  ffmpeg: FFmpeg,
  args: string[],
  stepLabel: string,
  onProgress?: (pct: number) => void,
) {
  lastLogLines = [];
  const h = ({ progress }: { progress: number }) => {
    onProgress?.(Math.max(0, Math.min(1, progress)) * 100);
  };
  ffmpeg.on("progress", h);
  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) {
      const tail = lastLogLines.slice(-8).join("\n");
      throw new Error(`[${stepLabel}] ffmpeg 退出码 ${code}\n${tail}`);
    }
  } catch (err) {
    const tail = lastLogLines.slice(-8).join("\n");
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`[${stepLabel}] ${detail}${tail ? `\n${tail}` : ""}`);
  } finally {
    ffmpeg.off("progress", h);
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
  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFFmpeg();
  } catch (err) {
    throw new Error(
      `FFmpeg 核心加载失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  onProgress?.(8, "FFmpeg 就绪");

  try {
    onProgress?.(12, "下载视频和品牌素材...");
    const videoData = await safeFetchBytes(proxy(rawVideoUrl), "AI 原版视频");
    // 清残留
    try {
      await ffmpeg.deleteFile("raw.mp4");
    } catch {
      /* ignore */
    }
    await ffmpeg.writeFile("raw.mp4", videoData);

    if (cfg.template === "corner_watermark") {
      return await runCornerWatermark(ffmpeg, cfg, onProgress);
    }

    if (cfg.template === "intro_outro") {
      return await runIntroOutro(ffmpeg, cfg, onProgress);
    }

    if (cfg.template === "full_package") {
      return await runFullPackage(ffmpeg, cfg, onProgress);
    }

    throw new Error(`Brand Lock template "${cfg.template}" 暂未实现`);
  } catch (err) {
    // 失败重置，保证下次重试干净
    resetFFmpeg();
    throw err;
  }
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
  const logoData = await safeFetchBytes(proxy(logoSource), "品牌 Logo");
  const logoExt = guessImageExt(logoSource);
  const logoFile = `logo.${logoExt}`;
  try {
    await ffmpeg.deleteFile(logoFile);
  } catch {
    /* ignore */
  }
  await ffmpeg.writeFile(logoFile, logoData);

  const filter = buildCornerWatermarkFilter(cfg);

  onProgress?.(25, "叠加品牌水印...");
  await execWithGuard(
    ffmpeg,
    [
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
    ],
    "品牌角标叠加",
    (pct) => {
      onProgress?.(25 + Math.floor((pct / 100) * 65));
    },
  );

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

/**
 * intro_outro 模板：
 *   raw 视频 → 保持完整播放
 *   片头额外塞 1.5s 全屏产品图 static clip
 *   片尾额外塞 2s 全屏产品图 + Slogan static clip
 *
 * 实现：先做两段静态 clip，再和 raw 视频 concat。
 * 为了兼容 concat demuxer，所有段必须同编码/尺寸/帧率，
 * 所以每段都过一次 libx264/yuv420p/30fps，并规范到 1080x1920。
 */
async function runIntroOutro(
  ffmpeg: FFmpeg,
  cfg: BrandLockConfig,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const productImage = cfg.productImageUrl || cfg.logoUrl;
  if (!productImage) {
    throw new Error("Brand Lock intro_outro 需要产品图或 Logo");
  }

  onProgress?.(18, "下载产品素材...");
  const imgData = await safeFetchBytes(proxy(productImage), "产品素材");
  const imgExt = guessImageExt(productImage);
  const imgFile = `product.${imgExt}`;
  for (const f of [imgFile, "main.mp4", "intro.mp4", "outro.mp4", "list.txt", "branded.mp4"]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {
      /* ignore */
    }
  }
  await ffmpeg.writeFile(imgFile, imgData);

  onProgress?.(25, "规范原视频到 1080x1920...");
  await execWithGuard(
    ffmpeg,
    [
      "-i", "raw.mp4",
      "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "main.mp4",
    ],
    "规范原视频",
  );

  onProgress?.(45, "生成片头 (1.5s)...");
  await execWithGuard(
    ffmpeg,
    [
      "-loop", "1", "-i", imgFile,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t", "1.5",
      "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-shortest",
      "-movflags", "+faststart",
      "intro.mp4",
    ],
    "生成片头",
  );

  onProgress?.(65, "生成片尾 (2s)...");
  const outroFilter = cfg.slogan
    ? `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,drawtext=text='${escapeDrawText(cfg.slogan)}':fontcolor=white:fontsize=52:box=1:boxcolor=black@0.5:boxborderw=20:x=(w-text_w)/2:y=h-text_h-140,setsar=1,fps=30`
    : `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`;

  await execWithGuard(
    ffmpeg,
    [
      "-loop", "1", "-i", imgFile,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t", "2",
      "-vf", outroFilter,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-shortest",
      "-movflags", "+faststart",
      "outro.mp4",
    ],
    "生成片尾",
  );

  onProgress?.(82, "拼接 intro + main + outro...");
  const list = "file 'intro.mp4'\nfile 'main.mp4'\nfile 'outro.mp4'\n";
  await ffmpeg.writeFile("list.txt", new TextEncoder().encode(list));
  await execWithGuard(
    ffmpeg,
    [
      "-f", "concat", "-safe", "0",
      "-i", "list.txt",
      "-c", "copy",
      "-movflags", "+faststart",
      "branded.mp4",
    ],
    "拼接 intro+main+outro",
  );

  onProgress?.(92, "读取成品...");
  const data = await ffmpeg.readFile("branded.mp4");
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  for (const f of ["raw.mp4", imgFile, "main.mp4", "intro.mp4", "outro.mp4", "list.txt", "branded.mp4"]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {
      /* ignore */
    }
  }

  onProgress?.(100, "品牌合成完成");
  return new Blob([bytes as unknown as BlobPart], { type: "video/mp4" });
}

/**
 * full_package 模板：角标水印 + 片头片尾 + Slogan。
 *
 * 实现：先走 intro_outro 得到"带 intro/outro 的 blob"，
 * 然后把这个 blob 再跑一遍 corner_watermark 得到最终成品。
 * 两步独立逻辑，易维护。
 */
async function runFullPackage(
  ffmpeg: FFmpeg,
  cfg: BrandLockConfig,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  // Step 1: intro_outro（写回 raw.mp4 复用 corner_watermark）
  onProgress?.(15, "阶段 1/2：生成片头片尾...");
  const withIntroOutro = await runIntroOutro(ffmpeg, cfg, (pct, msg) => {
    // 把 intro_outro 的 0-100 映射到 15-60
    const mapped = 15 + Math.floor((pct / 100) * 45);
    onProgress?.(mapped, msg);
  });

  // 把 with-intro-outro 回写成 raw 重新作为 corner_watermark 的输入
  await ffmpeg.writeFile(
    "raw.mp4",
    new Uint8Array(await withIntroOutro.arrayBuffer()),
  );

  onProgress?.(62, "阶段 2/2：叠加品牌角标...");
  return await runCornerWatermark(ffmpeg, cfg, (pct, msg) => {
    const mapped = 62 + Math.floor((pct / 100) * 38);
    onProgress?.(mapped, msg);
  });
}

/**
 * ffmpeg drawtext 对单引号、反斜杠、冒号有转义要求。
 */
function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\\\'")
    .replace(/:/g, "\\:");
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
