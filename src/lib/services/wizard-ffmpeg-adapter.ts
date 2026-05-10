import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import type { WizardClip, WizardTimeline } from "@/lib/schemas/wizard-render";

/**
 * Wizard 专用的 FFmpeg 渲染 adapter。
 *
 * 核心约束（来自 Phase 3D 边界）：
 * - 不重写、不耦合 ad-render-service / AdEditPlan / VideoBrief 主流程；
 * - 任意阶段失败必须抛错，由 wizard-render-service 自行降级到 DRAFT_READY，
 *   不允许这里直接静默成功；
 * - 至少支持 9:16，能支持 1:1 / 16:9（输出尺寸由 aspect 决定）；
 * - 加 captionText overlay + 末尾 CTA card；
 * - logo / brand overlay 不在本批次。
 *
 * 输入是已经 parseWizardTimeline 通过的 timeline。
 */

const execFileAsync = promisify(execFile);

const SUPPORTED_VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const SUPPORTED_IMAGE_EXT = /\.(png|jpe?g|webp)(\?|$)/i;

let drawtextSupportPromise: Promise<boolean> | null = null;

export interface WizardFfmpegResult {
  /// 本地临时输出 .mp4 的绝对路径（调用方负责持久化到 Blob 并清理）。
  outputPath: string;
  /// 本次渲染用到的总 clip 数（含 CTA end card）。
  segmentCount: number;
  /// 最终输出比例。
  aspectRatio: WizardTimeline["aspectRatio"];
}

/**
 * 真渲染入口：按 timeline.clips 顺序拼接，附加 caption overlay，末尾追加 CTA card。
 *
 * 调用方（wizard-render-service.renderReal）使用方式：
 *   const { outputPath } = await renderWizardTimelineWithFFmpeg(timeline);
 *   try {
 *     const url = await persistRenderedFile(outputPath, ...);
 *   } finally {
 *     await rm(path.dirname(outputPath), { recursive: true, force: true });
 *   }
 */
export async function renderWizardTimelineWithFFmpeg(
  timeline: WizardTimeline,
): Promise<WizardFfmpegResult> {
  const usable = timeline.clips.filter(
    (c) => !c.placeholder && c.sourceUrl,
  );
  if (usable.length === 0) {
    throw new Error("没有可渲染的 clip：所有 clip 均为占位/无 sourceUrl");
  }

  const renderableClips = usable.map((clip, i) =>
    validateRenderableClip(clip, i),
  );

  const dims = aspectToDims(timeline.aspectRatio);
  const tmpDir = path.join(os.tmpdir(), `aivora-wizard-render-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const segments: string[] = [];
    const canDrawText = await ffmpegSupportsDrawtext();

    for (const [index, clip] of renderableClips.entries()) {
      const out = path.join(tmpDir, `seg-${index}.mp4`);
      const durationMs = Math.max(
        500,
        clip.durationMs || clip.endMs - clip.startMs,
      );
      const durationSec = durationMs / 1000;
      const filter = buildClipFilter(dims, canDrawText, clip.captionText);
      try {
        await execFileAsync(
          "ffmpeg",
          buildSegmentArgs(clip, durationSec, filter, out),
          { maxBuffer: 1024 * 1024 * 10 },
        );
      } catch (err) {
        throw new Error(
          `Wizard 渲染失败：第 ${index + 1} 个 clip (sceneIndex=${clip.sceneIndex}) 处理失败。请确认 sourceUrl 可访问且为 mp4/mov/m4v/webm/png/jpg/webp。底层原因=${(err as Error).message}`,
        );
      }
      segments.push(out);
    }

    /// CTA 收尾页：5s 纯色背景 + ctaText（仅当可绘文字时才加，否则直接拼）
    const cta = (timeline.ctaText ?? timeline.brand.ctaText)?.trim();
    if (cta && canDrawText) {
      const ctaPath = path.join(tmpDir, `seg-cta.mp4`);
      try {
        await execFileAsync("ffmpeg", buildCtaCardArgs(dims, cta, ctaPath), {
          maxBuffer: 1024 * 1024 * 10,
        });
        segments.push(ctaPath);
      } catch (err) {
        /// CTA 失败不致命：跳过 cta 段，主视频仍可成片
        console.warn(
          `[wizard-ffmpeg] CTA card 段失败已跳过：${(err as Error).message}`,
        );
      }
    }

    /// concat 拼接
    const concatList = path.join(tmpDir, "concat.txt");
    await writeFile(
      concatList,
      segments
        .map((s) => `file '${s.replaceAll("'", "'\\''")}'`)
        .join("\n"),
      "utf8",
    );
    const finalOut = path.join(tmpDir, "final.mp4");
    try {
      await execFileAsync(
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
        { maxBuffer: 1024 * 1024 * 10 },
      );
    } catch (err) {
      throw new Error(
        `Wizard 渲染失败：多 clip 拼接失败。请确认所有 segment 均能转码为统一编码 (libx264 + yuv420p)。底层=${(err as Error).message}`,
      );
    }

    return {
      outputPath: finalOut,
      segmentCount: segments.length,
      aspectRatio: timeline.aspectRatio,
    };
  } catch (err) {
    /// 出错时清理临时目录，再把错误抛给 caller
    await rm(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * 把渲染好的 mp4 持久化到 Vercel Blob。失败/未配置时返回 file:// path。
 * 调用方负责清理临时目录。
 */
export async function persistWizardRenderedFile(
  filePath: string,
  blobPath: string,
): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return `file://${filePath}`;
  }
  try {
    const { put } = await import("@vercel/blob");
    const buffer = await readFile(filePath);
    const blob = await put(blobPath, buffer, {
      access: "public",
      contentType: "video/mp4",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  } catch {
    return `file://${filePath}`;
  }
}

// ---------- 内部工具 ----------

function aspectToDims(aspect: WizardTimeline["aspectRatio"]): {
  w: number;
  h: number;
  scaleStr: string;
} {
  switch (aspect) {
    case "1:1":
      return { w: 1080, h: 1080, scaleStr: "1080:1080" };
    case "16:9":
      return { w: 1920, h: 1080, scaleStr: "1920:1080" };
    case "9:16":
    default:
      return { w: 1080, h: 1920, scaleStr: "1080:1920" };
  }
}

function ffmpegSupportsDrawtext() {
  drawtextSupportPromise ??= execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-filters"],
    {
      maxBuffer: 1024 * 1024 * 5,
    },
  )
    .then(({ stdout, stderr }) =>
      `${stdout}\n${stderr}`.includes("drawtext"),
    )
    .catch(() => false);
  return drawtextSupportPromise;
}

function validateRenderableClip(clip: WizardClip, index: number): WizardClip & {
  sourceUrl: string;
} {
  if (!clip.sourceUrl) {
    throw new Error(
      `第 ${index + 1} 个 clip 缺 sourceUrl，无法渲染（应在 service 上游过滤掉占位）`,
    );
  }
  if (
    !SUPPORTED_VIDEO_EXT.test(clip.sourceUrl) &&
    !SUPPORTED_IMAGE_EXT.test(clip.sourceUrl)
  ) {
    throw new Error(
      `第 ${index + 1} 个 clip 格式不支持：${clip.sourceUrl}（仅支持 mp4/mov/m4v/webm/png/jpg/webp）`,
    );
  }
  if (clip.endMs <= clip.startMs) {
    throw new Error(
      `第 ${index + 1} 个 clip 时间段无效 startMs=${clip.startMs}, endMs=${clip.endMs}`,
    );
  }
  return clip as WizardClip & { sourceUrl: string };
}

function buildSegmentArgs(
  clip: WizardClip & { sourceUrl: string },
  durationSec: number,
  filter: string,
  out: string,
): string[] {
  const isImage = SUPPORTED_IMAGE_EXT.test(clip.sourceUrl);
  const base = isImage
    ? ["-y", "-loop", "1", "-t", `${durationSec}`, "-i", clip.sourceUrl]
    : [
        "-y",
        "-ss",
        `${clip.startMs / 1000}`,
        "-t",
        `${durationSec}`,
        "-i",
        clip.sourceUrl,
      ];
  return [
    ...base,
    "-vf",
    filter,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ];
}

function buildClipFilter(
  dims: { scaleStr: string },
  canDrawText: boolean,
  captionText: string | undefined,
): string {
  const base = `scale=${dims.scaleStr}:force_original_aspect_ratio=increase,crop=${dims.scaleStr},setsar=1,fps=30`;
  if (!canDrawText || !captionText) return base;
  return `${base},drawtext=text='${escapeDrawtext(captionText)}':fontcolor=white:fontsize=46:box=1:boxcolor=black@0.55:boxborderw=22:x=(w-text_w)/2:y=h*0.78`;
}

function buildCtaCardArgs(
  dims: { w: number; h: number; scaleStr: string },
  cta: string,
  out: string,
): string[] {
  return [
    "-y",
    "-f",
    "lavfi",
    "-t",
    "5",
    "-i",
    `color=c=black:s=${dims.w}x${dims.h}:r=30`,
    "-vf",
    `drawtext=text='${escapeDrawtext(cta)}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ];
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\n/g, " ");
}

/**
 * 决策：按 timeline + env 给出最终采用的 mode。
 * 单独导出便于测试。
 */
export function decideWizardRenderMode(opts: {
  hasUsableClips: boolean;
  hasAnyClips: boolean;
  realFlagOn: boolean;
  ffmpegOk: boolean;
}): "REAL" | "DRAFT" | "MOCK" {
  if (!opts.hasAnyClips) return "MOCK";
  if (!opts.realFlagOn) return "DRAFT";
  if (!opts.ffmpegOk) return "DRAFT";
  if (!opts.hasUsableClips) return "DRAFT";
  return "REAL";
}
