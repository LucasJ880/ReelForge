import { execFile } from "child_process";
import { promisify } from "util";
import { copyFile, mkdir, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import {
  resolveClientLockProfile,
  SUNNYSHUTTER_CLIENT_LOCK_ID,
} from "@/lib/video-generation/client-lock-profiles";
import { applySunnyShutterLogoOverlayLock } from "@/lib/video-generation/sunnyshutter-brand-pack";

/**
 * Brand Overlay Renderer —— Phase 2 · L2.1
 *
 * 职责：把一张「真实的」品牌 logo PNG 叠到一段已经渲染好的 MP4 之上。
 *
 * 为什么单独存在：
 *   - Seedance / 即梦等 AI 视频提供方对「精确文字 / logo / ® 符号 / 细线条」
 *     的还原非常不稳；常出现字母走形、颜色漂移、线条断裂等问题。
 *   - 唯一可靠的方案：让模型生成场景视频，由我们自己在合成层把品牌资产真叠上。
 *
 * 与 brand-end-card-renderer 的区别（务必清楚）：
 *   - brand-end-card-renderer 渲染「片尾 3-5s 品牌卡」（独立的一段视频片段）。
 *   - brand-overlay-renderer 渲染「视频期间的 logo 水印 / 角标」（在画面内叠加）。
 *   - 两者互不替代、互不依赖。
 *
 * 设计原则：
 *   - 纯函数（filter graph / 位置 / 路径校验）全部可单元测试，不需要 ffmpeg。
 *   - 实际 ffmpeg 执行只在 applyBrandOverlay 入口；其他全部静态。
 *   - 不污染 stitch-service / assembly-executor 的现有路径；调用方按需使用。
 *   - 路径白名单：只接受 http(s):// + file:// + cwd / os.tmpdir() / /tmp 下的本地路径。
 */

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";

const DEFAULT_OUTPUT_DIR =
  process.env.BRAND_OVERLAY_CACHE_DIR ||
  path.join(os.tmpdir(), "aivora-brand-overlays");

const DEFAULT_PLACEMENT: OverlayPlacement = "top-right";
const DEFAULT_OPACITY = 0.88;
/// 16-20% of video width is a sane TikTok / Reels watermark size.
const DEFAULT_LOGO_WIDTH_RATIO = 0.18;
/// Tuned for 720p vertical (720x1280): 32px ≈ 4.4% of width.
const DEFAULT_MARGIN_PX = 32;
const DEFAULT_DURATION_MODE: OverlayDurationMode = "full_video";

const MIN_LOGO_RATIO = 0.05;
const MAX_LOGO_RATIO = 0.4;

// ---------- Types ----------

export type OverlayPlacement =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

export type OverlayDurationMode = "full_video" | "first_3s" | "last_5s";

export interface BrandOverlayOptions {
  /// Source video. Allowed: http(s)://, file://, or local path under safe roots.
  sourceVideo: string;
  /// Brand logo (PNG with alpha is recommended). Same path rules as sourceVideo.
  logo: string;
  placement?: OverlayPlacement;
  opacity?: number;
  /// Logo width as fraction of video width. 0.16 - 0.20 is the recommended band.
  logoWidthRatio?: number;
  /// Pixel margin from the chosen edge.
  marginPx?: number;
  /// When the logo is shown inside the video timeline.
  durationMode?: OverlayDurationMode;
  /// Optional override for output dir. Defaults to os.tmpdir()/aivora-brand-overlays.
  outputDir?: string;
  /// Optional pre-probed video metadata (skip ffprobe).
  videoDurationSec?: number;
  videoWidth?: number;
  videoHeight?: number;
}

export interface BrandOverlayResult {
  /// Absolute path of the composited MP4 on disk (may be inside outputDir).
  outputPath: string;
  /// file:// URL form (handy for stitch-service downstream).
  outputUrl: string;
  /// FFmpeg `-filter_complex` graph that was actually used (for debugging).
  filterGraph: string;
  warnings: string[];
}

export interface ResolvedOverlayParams {
  placement: OverlayPlacement;
  opacity: number;
  logoWidthRatio: number;
  marginPx: number;
  durationMode: OverlayDurationMode;
}

// ---------- Pure helpers (testable) ----------

export function resolveOverlayParams(
  opts: Partial<BrandOverlayOptions> | undefined,
): ResolvedOverlayParams {
  const opacity = clamp(opts?.opacity ?? DEFAULT_OPACITY, 0, 1);
  const ratio = clamp(
    opts?.logoWidthRatio ?? DEFAULT_LOGO_WIDTH_RATIO,
    MIN_LOGO_RATIO,
    MAX_LOGO_RATIO,
  );
  const margin = Math.max(0, Math.round(opts?.marginPx ?? DEFAULT_MARGIN_PX));
  return {
    placement: opts?.placement ?? DEFAULT_PLACEMENT,
    opacity,
    logoWidthRatio: ratio,
    marginPx: margin,
    durationMode: opts?.durationMode ?? DEFAULT_DURATION_MODE,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (typeof v !== "number" || Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export interface BuildFilterArgs {
  videoWidth: number;
  videoDurationSec: number;
  params: ResolvedOverlayParams;
}

/**
 * Build the ffmpeg `-filter_complex` graph for one video + one logo overlay.
 *
 * Aspect ratio is always preserved by passing height=-1 to scale; the logo is
 * never stretched. Opacity is applied by mixing the alpha channel directly so
 * even a fully-opaque PNG becomes a softer watermark.
 */
export function buildOverlayFilterGraph(args: BuildFilterArgs): string {
  const { videoWidth, videoDurationSec, params } = args;
  const logoW = Math.max(1, Math.round(videoWidth * params.logoWidthRatio));
  const opacityStr = params.opacity.toFixed(3);
  const xy = computePlacementExpr(params.placement, params.marginPx);
  const enable = computeEnableExpr(params.durationMode, videoDurationSec);
  const enableSuffix = enable ? `:enable='${enable}'` : "";

  return [
    `[1:v]format=rgba,colorchannelmixer=aa=${opacityStr},scale=${logoW}:-1[logo]`,
    `[0:v][logo]overlay=${xy.x}:${xy.y}${enableSuffix}[v]`,
  ].join(";");
}

export function computePlacementExpr(
  placement: OverlayPlacement,
  margin: number,
): { x: string; y: string } {
  switch (placement) {
    case "top-left":
      return { x: `${margin}`, y: `${margin}` };
    case "top-right":
      return { x: `main_w-overlay_w-${margin}`, y: `${margin}` };
    case "bottom-left":
      return { x: `${margin}`, y: `main_h-overlay_h-${margin}` };
    case "bottom-right":
      return {
        x: `main_w-overlay_w-${margin}`,
        y: `main_h-overlay_h-${margin}`,
      };
    default:
      return {
        x: `main_w-overlay_w-${margin}`,
        y: `${margin}`,
      };
  }
}

export function computeEnableExpr(
  mode: OverlayDurationMode,
  videoDurationSec: number,
): string | null {
  switch (mode) {
    case "full_video":
      return null;
    case "first_3s":
      return `between(t,0,3)`;
    case "last_5s": {
      /// Anchor by absolute time so playback is robust regardless of seek.
      const start = Math.max(0, videoDurationSec - 5).toFixed(3);
      const end = Math.max(0, videoDurationSec).toFixed(3);
      return `between(t,${start},${end})`;
    }
    default:
      return null;
  }
}

// ---------- Path safety (testable) ----------

const ALLOWED_LOCAL_ROOTS = [process.cwd(), os.tmpdir(), "/tmp"];

export interface PathSafetyOptions {
  /// Extra absolute paths that should also be considered safe roots.
  extraRoots?: string[];
}

export class UnsafeOverlayPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeOverlayPathError";
  }
}

/**
 * Validate that a logo / video path is one we are willing to touch.
 *
 * Allowed:
 *   - http://  https://
 *   - file:// pointing under a safe root
 *   - bare absolute / relative path under cwd, os.tmpdir(), /tmp, or extraRoots
 *
 * Rejected: /etc/* , /var/* , /Users/<other>/* , parent-dir traversals, etc.
 */
export function assertSafeOverlayPath(
  raw: string,
  opts?: PathSafetyOptions,
): void {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new UnsafeOverlayPathError("path is empty");
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    /// Network fetch goes through fetch() which has its own DNS / TLS guarantees.
    return;
  }
  const localPath = raw.startsWith("file://")
    ? safeFileUrlToPath(raw)
    : path.resolve(raw);
  const allowed = [...ALLOWED_LOCAL_ROOTS, ...(opts?.extraRoots ?? [])].map(
    (r) => path.resolve(r),
  );
  const ok = allowed.some((root) => isInsideRoot(localPath, root));
  if (!ok) {
    throw new UnsafeOverlayPathError(
      `path "${truncate(raw, 80)}" is outside allowed roots`,
    );
  }
}

function safeFileUrlToPath(raw: string): string {
  try {
    return fileURLToPath(raw);
  } catch (err) {
    throw new UnsafeOverlayPathError(
      `invalid file:// URL: ${(err as Error).message}`,
    );
  }
}

function isInsideRoot(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ---------- Probing (real I/O) ----------

export interface ProbedVideo {
  durationSec: number;
  width: number;
  height: number;
}

export async function probeVideo(localPath: string): Promise<ProbedVideo> {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      localPath,
    ],
    { timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
  const json = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const w = json.streams?.[0]?.width ?? 0;
  const h = json.streams?.[0]?.height ?? 0;
  const d = parseFloat(json.format?.duration ?? "0");
  if (!w || !h || !Number.isFinite(d) || d <= 0) {
    throw new Error("video metadata probe returned malformed values");
  }
  return { durationSec: d, width: w, height: h };
}

// ---------- Main entry ----------

/**
 * Apply a logo overlay on top of a completed video and return the new MP4
 * path / URL.
 *
 * Throws on unsafe paths, missing logo file, or ffmpeg failure. The caller is
 * responsible for downstream Blob upload / database update — this function
 * intentionally does not touch Prisma.
 */
export async function applyBrandOverlay(
  opts: BrandOverlayOptions,
): Promise<BrandOverlayResult> {
  if (!opts.sourceVideo) throw new Error("sourceVideo is required");
  if (!opts.logo) throw new Error("logo is required");

  assertSafeOverlayPath(opts.sourceVideo);
  assertSafeOverlayPath(opts.logo);

  const params = resolveOverlayParams(opts);
  const warnings: string[] = [];
  const outDir = opts.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outDir, { recursive: true });

  const work = path.join(outDir, `work-${Date.now()}-${randomId()}`);
  await mkdir(work, { recursive: true });

  try {
    const localVideo = path.join(
      work,
      `source${pickExt(opts.sourceVideo, ".mp4")}`,
    );
    const localLogo = path.join(
      work,
      `logo${pickExt(opts.logo, ".png")}`,
    );
    await materialize(opts.sourceVideo, localVideo);
    await materialize(opts.logo, localLogo);

    if (!(await isReadableNonEmpty(localLogo))) {
      throw new Error(
        `logo file is missing or empty after fetch: ${truncate(opts.logo, 80)}`,
      );
    }
    if (!(await isReadableNonEmpty(localVideo))) {
      throw new Error(
        `source video is missing or empty after fetch: ${truncate(opts.sourceVideo, 80)}`,
      );
    }

    const probed: ProbedVideo =
      typeof opts.videoWidth === "number" &&
      typeof opts.videoHeight === "number" &&
      typeof opts.videoDurationSec === "number"
        ? {
            width: opts.videoWidth,
            height: opts.videoHeight,
            durationSec: opts.videoDurationSec,
          }
        : await probeVideo(localVideo);

    const filter = buildOverlayFilterGraph({
      videoWidth: probed.width,
      videoDurationSec: probed.durationSec,
      params,
    });

    const outputPath = path.join(
      outDir,
      `overlay-${stableHash(opts, params)}.mp4`,
    );
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        localVideo,
        "-i",
        localLogo,
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "ultrafast",
        /// Re-encode audio — `-c:a copy` can produce duplicate-channel AAC that
        /// breaks downstream normalize/concat (seen on silent Seedance segments).
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 50 },
    );

    if (!(await isReadableNonEmpty(outputPath))) {
      throw new Error("overlay produced empty output file");
    }

    return {
      outputPath,
      outputUrl: pathToFileURL(outputPath).toString(),
      filterGraph: filter,
      warnings,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ---------- Orchestrator (safe, opt-in wrapper) ----------

export interface BrandOverlayConfig {
  enabled?: boolean;
  placement?: OverlayPlacement;
  opacity?: number;
  logoWidthRatio?: number;
  marginPx?: number;
  durationMode?: OverlayDurationMode;
}

export interface ApplyOverlayIfConfiguredArgs {
  sourceVideoUrl: string;
  logoUrl: string | null | undefined;
  config: BrandOverlayConfig | null | undefined;
  /** When brand/client resolves to SunnyShutter, placement is forced top-left. */
  brandName?: string | null;
  clientLockProfileId?: string | null;
}

export interface ApplyOverlayIfConfiguredResult {
  /// Non-null only when the overlay file was successfully produced and exists on disk.
  overlayUrl: string | null;
  applied: boolean;
  /// Customer-safe warning strings (see brand-overlay-customer-strings.ts contract).
  warnings: string[];
}

/**
 * Conservative helper for downstream callers (e.g. assembly-executor):
 *
 *   - Returns `{applied: false, overlayUrl: null}` when overlay is not enabled
 *     or no logo URL is provided.
 *   - Otherwise runs `applyBrandOverlay` and verifies the output file exists
 *     before returning the URL — so the caller can safely use `overlayUrl` as
 *     the new finalVideoUrl without risk of a dangling reference.
 *   - Never throws; catches and reports errors as customer-safe warnings.
 *
 * Important: this helper does NOT update the database. The caller decides when
 * to swap finalVideoUrl based on `applied && overlayUrl`.
 */
export async function applyBrandOverlayIfConfigured(
  args: ApplyOverlayIfConfiguredArgs,
): Promise<ApplyOverlayIfConfiguredResult> {
  const config = applySunnyShutterLogoOverlayLock(args.config, {
    clientLockProfileId: args.clientLockProfileId,
    brandName: args.brandName,
  });

  if (!config?.enabled) {
    return { overlayUrl: null, applied: false, warnings: [] };
  }
  if (!args.logoUrl) {
    return {
      overlayUrl: null,
      applied: false,
      warnings: ["Brand logo image was not provided; skipping logo overlay."],
    };
  }
  if (!args.sourceVideoUrl) {
    return {
      overlayUrl: null,
      applied: false,
      warnings: ["Source video URL is missing; skipping logo overlay."],
    };
  }

  try {
    const result = await applyBrandOverlay({
      sourceVideo: args.sourceVideoUrl,
      logo: args.logoUrl,
      placement: config.placement,
      opacity: config.opacity,
      logoWidthRatio: config.logoWidthRatio,
      marginPx: config.marginPx,
      durationMode: config.durationMode,
    });
    /// Defensive double-check before claiming "applied". Caller relies on this
    /// to gate finalVideoUrl updates — no overlay file → no URL update.
    if (!(await isReadableNonEmpty(result.outputPath))) {
      return {
        overlayUrl: null,
        applied: false,
        warnings: ["Logo overlay was generated but the output file is missing."],
      };
    }
    return {
      overlayUrl: result.outputUrl,
      applied: true,
      warnings: result.warnings,
    };
  } catch (err) {
    return {
      overlayUrl: null,
      applied: false,
      warnings: [toCustomerSafeWarning(err)],
    };
  }
}

/**
 * Convert any internal error into a short customer-safe message. Strips paths,
 * tool names, and other internal terms so the warning can be surfaced in the
 * customer UI without leaking implementation details.
 */
export function toCustomerSafeWarning(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "unknown");
  const lower = raw.toLowerCase();
  if (lower.includes("logo") && lower.includes("missing")) {
    return "Brand logo image is unavailable. Please re-upload the logo.";
  }
  if (lower.includes("outside allowed roots") || lower.includes("invalid file://")) {
    return "Brand logo path is not allowed. Please upload via the standard flow.";
  }
  if (lower.includes("metadata probe")) {
    return "Could not read source video. Please retry once the video finishes processing.";
  }
  return "Could not apply the brand logo overlay. Please try again.";
}

// ---------- Internal I/O helpers ----------

function pickExt(rawPath: string, fallback: string): string {
  try {
    const u = rawPath.startsWith("file://")
      ? new URL(rawPath).pathname
      : rawPath.startsWith("http")
        ? new URL(rawPath).pathname
        : rawPath;
    const ext = path.extname(u);
    return ext || fallback;
  } catch {
    return fallback;
  }
}

async function materialize(rawSrc: string, dest: string): Promise<void> {
  if (rawSrc.startsWith("http://") || rawSrc.startsWith("https://")) {
    const res = await fetch(rawSrc);
    if (!res.ok) {
      throw new Error(
        `fetch failed (${res.status}) for ${truncate(rawSrc, 80)}`,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    return;
  }
  if (rawSrc.startsWith("file://")) {
    const localPath = fileURLToPath(rawSrc);
    await copyFile(localPath, dest);
    return;
  }
  await copyFile(path.resolve(rawSrc), dest);
}

async function isReadableNonEmpty(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function randomId(): string {
  return crypto.randomBytes(4).toString("hex");
}

function stableHash(
  opts: BrandOverlayOptions,
  params: ResolvedOverlayParams,
): string {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        s: opts.sourceVideo,
        l: opts.logo,
        p: params,
      }),
    )
    .digest("hex")
    .slice(0, 12);
}

// ---------- Config extraction (downstream wiring helper) ----------

/**
 * Best-effort extractor for `productInput.brandKit.overlay` JSON config.
 *
 * The overlay layer is opt-in. Returning `null` (or `enabled: false`) means
 * `applyBrandOverlayIfConfigured` will short-circuit and leave the stitched
 * video untouched. Use this from assembly-executor / stitch-service when you
 * want the orchestrator helper to pick up brand-kit settings from the order.
 */
export function extractBrandOverlayConfig(
  productInput: unknown,
): BrandOverlayConfig | null {
  if (!productInput || typeof productInput !== "object") return null;
  const root = productInput as Record<string, unknown>;
  const brandKit = root.brandKit;
  if (!brandKit || typeof brandKit !== "object") return null;
  const bk = brandKit as Record<string, unknown>;
  const brandName = typeof bk.brandName === "string" ? bk.brandName : null;
  const isSunny =
    resolveClientLockProfile({ brandName }) === SUNNYSHUTTER_CLIENT_LOCK_ID;

  const overlay = bk.overlay;
  if (!overlay || typeof overlay !== "object") {
    /// SunnyShutter always gets a locked top-left watermark config.
    if (!isSunny) return null;
    return applySunnyShutterLogoOverlayLock({ enabled: true }, { brandName });
  }
  const ov = overlay as Record<string, unknown>;

  const placement = isOverlayPlacement(ov.placement) ? ov.placement : undefined;
  const durationMode = isOverlayDurationMode(ov.durationMode)
    ? ov.durationMode
    : undefined;
  const opacity = typeof ov.opacity === "number" ? ov.opacity : undefined;
  const logoWidthRatio =
    typeof ov.logoWidthRatio === "number" ? ov.logoWidthRatio : undefined;
  const marginPx = typeof ov.marginPx === "number" ? ov.marginPx : undefined;
  const enabled = ov.enabled === true;

  return applySunnyShutterLogoOverlayLock(
    {
      enabled,
      placement,
      opacity,
      logoWidthRatio,
      marginPx,
      durationMode,
    },
    { brandName },
  );
}

function isOverlayPlacement(v: unknown): v is OverlayPlacement {
  return (
    v === "top-right" ||
    v === "top-left" ||
    v === "bottom-right" ||
    v === "bottom-left"
  );
}

function isOverlayDurationMode(v: unknown): v is OverlayDurationMode {
  return v === "full_video" || v === "first_3s" || v === "last_5s";
}

// ---------- Test exports ----------

export const __test__ = {
  resolveOverlayParams,
  buildOverlayFilterGraph,
  computePlacementExpr,
  computeEnableExpr,
  assertSafeOverlayPath,
  isInsideRoot,
  pickExt,
  toCustomerSafeWarning,
  extractBrandOverlayConfig,
  isOverlayPlacement,
  isOverlayDurationMode,
  ALLOWED_LOCAL_ROOTS,
  DEFAULT_OPACITY,
  DEFAULT_LOGO_WIDTH_RATIO,
  DEFAULT_MARGIN_PX,
  DEFAULT_PLACEMENT,
};
