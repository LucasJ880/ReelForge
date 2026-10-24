/**
 * 媒体运行时健康探针（4.6）：/api/health/media 的实现。
 *
 * 在真正的函数运行时里跑一遍最小的合成链路，回答「Vercel 上的 ffmpeg 到底能不能用」：
 *   1. ffmpeg 解析到哪个二进制、版本号
 *   2. 中文字体 / fontconfig / BGM 是否随函数打包
 *   3. 尾卡：带中文品牌名的 SVG → sharp 栅格化（与品牌封装同一渲染器）
 *   4. 1 秒合成：尾卡 PNG 当画面 + 中文字幕走 `ass` 滤镜烧录 → MP4，报告字节数，
 *      并从 libass 日志里取实际选中的字体与缺字数
 * 可选返回合成结果的中间帧 JPEG，供验收时人眼看字幕与尾卡文字（4.2）。
 *
 * 不调用任何外部供应商、不读写数据库、不上传对象存储；临时文件用完即删。
 */

import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BGM_TRACKS,
  buildDeterministicCues,
  renderAssCaptions,
} from "@/lib/video-generation/audio-post-production";
import { renderBrandEndCardPng } from "@/lib/video-generation/brand-end-card-renderer";
import type { BrandPackagingPlan } from "@/types/video-generation";
import {
  ffmpegBinary,
  ffmpegVersion,
  runFfmpeg,
  type FfmpegBinarySource,
} from "./ffmpeg-bin";
import { ensureMediaFonts, type MediaFontSetup } from "./media-fonts";

export const MEDIA_PROBE_SUBTITLE_TEXT = "中文字幕探针：晴窗遮阳 立即预约";
const PROBE_BRAND_NAME = "晴窗遮阳";
const PROBE_SECONDS = 1;
const PROBE_WIDTH = 720;
const PROBE_HEIGHT = 1280;

export interface MediaHealthStep {
  ok: boolean;
  ms: number;
  bytes?: number;
  warnings?: string[];
  error?: string;
}

export interface MediaHealthReport {
  ok: boolean;
  checkedAt: string;
  ffmpeg: {
    path: string;
    source: FfmpegBinarySource;
    version: string | null;
    error?: string;
  };
  fonts: Pick<
    MediaFontSetup,
    "fontFile" | "fontSource" | "fontconfigFile" | "fontconfigSource"
  >;
  bgm: { path: string | null; present: boolean; bytes: number | null };
  probe: {
    endCard: MediaHealthStep;
    synthesis: MediaHealthStep & {
      subtitlesBurned: boolean;
      /** libass 实际选中的字体文件（从 fontselect 日志解析） */
      subtitleFont: string | null;
      /** libass 找不到任何字体能显示的字形数（> 0 = 中文字幕缺字） */
      missingGlyphs: number;
    };
    outputBytes: number | null;
  };
}

function shortError(err: unknown): string {
  /// execFile 的 message 以整条命令行开头，真正的原因在 stderr 末尾几行
  const stderr = (err as { stderr?: unknown } | null)?.stderr;
  const source =
    typeof stderr === "string" && stderr.trim()
      ? stderr
      : err instanceof Error
        ? err.message
        : String(err);
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" | ")
    .slice(0, 400);
}

/** 纯函数：从 ffmpeg/libass 的 info 日志里取选中的字体与缺字数 */
export function parseLibassFontLog(stderr: string): {
  subtitleFont: string | null;
  missingGlyphs: number;
} {
  const selected = /fontselect: \([^)]*\) -> ([^,\n]+)/.exec(stderr);
  const missing = stderr.match(/failed to find any fallback with glyph/g)?.length ?? 0;
  return { subtitleFont: selected?.[1]?.trim() ?? null, missingGlyphs: missing };
}

function escapeFilterPath(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function probeEndCardPlan(): BrandPackagingPlan {
  return {
    mode: "auto_end_card",
    logoAssetId: null,
    endCardDurationSeconds: PROBE_SECONDS,
    brandName: PROBE_BRAND_NAME,
    slogan: "中文尾卡渲染自检",
    cta: "立即预约量尺",
    contactLines: ["电话 400-000-0000", "多伦多 · 上门服务"],
    website: "aivora.example",
    renderStrategy: "render_ffmpeg_overlay",
    warnings: [],
  } as BrandPackagingPlan;
}

function bgmInfo(): MediaHealthReport["bgm"] {
  const track = BGM_TRACKS.find((t) => t.path !== null);
  if (!track?.path) return { path: null, present: false, bytes: null };
  const abs = path.resolve(/*turbopackIgnore: true*/ process.cwd(), track.path);
  try {
    const st = statSync(/*turbopackIgnore: true*/ abs);
    return { path: track.path, present: st.isFile() && st.size > 0, bytes: st.size };
  } catch {
    return { path: track.path, present: false, bytes: null };
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - started };
  } catch (error) {
    return { error, ms: Date.now() - started };
  }
}

/**
 * 跑完整探针。永不 throw；withFrame=true 时额外抽出合成结果的中间帧 JPEG。
 */
export async function runMediaHealthProbe(
  opts: { withFrame?: boolean } = {},
): Promise<{ report: MediaHealthReport; frameJpeg: Buffer | null }> {
  const binary = ffmpegBinary();
  const fonts = ensureMediaFonts();
  const version = await timed(() => ffmpegVersion());

  const workDir = await mkdtemp(path.join(os.tmpdir(), "aivora-media-health-"));
  let frameJpeg: Buffer | null = null;
  const endCardStep: MediaHealthStep = { ok: false, ms: 0 };
  const synthesisStep: MediaHealthReport["probe"]["synthesis"] = {
    ok: false,
    ms: 0,
    subtitlesBurned: false,
    subtitleFont: null,
    missingGlyphs: 0,
  };
  let outputBytes: number | null = null;

  try {
    // 1) 尾卡：中文 SVG → PNG（品牌封装同一渲染器、同一字体环境）
    const pngPath = path.join(workDir, "end-card.png");
    const endCard = await timed(async () => {
      const { png, warnings } = await renderBrandEndCardPng({
        briefId: "media-health-probe",
        plan: probeEndCardPlan(),
        aspectRatio: "9:16",
      });
      await writeFile(pngPath, png);
      return { bytes: png.length, warnings };
    });
    endCardStep.ms = endCard.ms;
    if (endCard.value) {
      endCardStep.ok = endCard.value.bytes > 0;
      endCardStep.bytes = endCard.value.bytes;
      if (endCard.value.warnings.length > 0) endCardStep.warnings = endCard.value.warnings;
    } else {
      endCardStep.error = shortError(endCard.error);
    }

    // 2) 1 秒合成：尾卡画面 + 中文字幕烧录（ass 滤镜 + 打包字体）
    if (endCardStep.ok && !version.error) {
      const assPath = path.join(workDir, "captions.ass");
      await writeFile(
        assPath,
        renderAssCaptions(buildDeterministicCues(MEDIA_PROBE_SUBTITLE_TEXT, PROBE_SECONDS), {
          aspectRatio: "9:16",
          position: "bottom",
          style: "plain",
        }),
        "utf8",
      );
      const outPath = path.join(workDir, "probe.mp4");
      const fontsDirOption = fonts.fontDir
        ? `:fontsdir='${escapeFilterPath(fonts.fontDir)}'`
        : "";
      const encodeArgs = (withSubtitles: boolean) => [
        "-y",
        "-hide_banner",
        "-nostdin",
        "-v",
        "info",
        "-loop",
        "1",
        "-framerate",
        "24",
        "-t",
        String(PROBE_SECONDS),
        "-i",
        pngPath,
        "-f",
        "lavfi",
        "-t",
        String(PROBE_SECONDS),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-filter_complex",
        withSubtitles
          ? `[0:v]scale=${PROBE_WIDTH}:${PROBE_HEIGHT},format=yuv420p,ass=filename='${escapeFilterPath(assPath)}'${fontsDirOption}[v]`
          : `[0:v]scale=${PROBE_WIDTH}:${PROBE_HEIGHT},format=yuv420p[v]`,
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "-movflags",
        "+faststart",
        outPath,
      ];
      const burned = await timed(() =>
        runFfmpeg(encodeArgs(true), { timeoutMs: 30_000, maxBuffer: 1024 * 1024 * 8 }),
      );
      synthesisStep.ms = burned.ms;
      if (burned.value) {
        synthesisStep.subtitlesBurned = true;
        Object.assign(synthesisStep, parseLibassFontLog(burned.value.stderr));
      } else {
        synthesisStep.error = `subtitle burn failed: ${shortError(burned.error)}`;
        /// 字幕链失败时仍验证一次纯编码，区分「ffmpeg 不能用」与「缺 libass/字体」
        const plain = await timed(() =>
          runFfmpeg(encodeArgs(false), { timeoutMs: 30_000, maxBuffer: 1024 * 1024 * 8 }),
        );
        synthesisStep.ms += plain.ms;
        if (plain.error) {
          synthesisStep.error += `; plain encode failed: ${shortError(plain.error)}`;
        }
      }
      if (existsSync(outPath)) {
        outputBytes = (await stat(outPath)).size;
        synthesisStep.bytes = outputBytes;
        if (opts.withFrame && outputBytes > 0) {
          const framePath = path.join(workDir, "frame.jpg");
          const frame = await timed(() =>
            runFfmpeg(
              ["-y", "-v", "error", "-ss", "0.5", "-i", outPath, "-frames:v", "1", "-q:v", "4", framePath],
              { timeoutMs: 10_000 },
            ),
          );
          if (!frame.error && existsSync(framePath)) frameJpeg = await readFile(framePath);
        }
      }
      synthesisStep.ok =
        synthesisStep.subtitlesBurned &&
        synthesisStep.missingGlyphs === 0 &&
        (outputBytes ?? 0) > 0;
    } else if (!endCardStep.ok) {
      synthesisStep.error = "skipped: end card render failed";
    } else {
      synthesisStep.error = "skipped: ffmpeg unavailable";
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const report: MediaHealthReport = {
    ok: !version.error && endCardStep.ok && synthesisStep.ok,
    checkedAt: new Date().toISOString(),
    ffmpeg: {
      path: binary.path,
      source: binary.source,
      version: version.value ?? null,
      ...(version.error ? { error: shortError(version.error) } : {}),
    },
    fonts: {
      fontFile: fonts.fontFile,
      fontSource: fonts.fontSource,
      fontconfigFile: fonts.fontconfigFile,
      fontconfigSource: fonts.fontconfigSource,
    },
    bgm: bgmInfo(),
    probe: { endCard: endCardStep, synthesis: synthesisStep, outputBytes },
  };
  return { report, frameJpeg };
}
