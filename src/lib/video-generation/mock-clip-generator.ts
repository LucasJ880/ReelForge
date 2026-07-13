import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, stat } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { pathToFileURL } from "url";
import editorialDesignTokens from "../../../editorial-design-tokens.generated.json";

/**
 * Mock Clip Generator —— 仅在 VIDEO_ENGINE_MOCK=true 下被 seedance provider 调用。
 *
 * 设计原则：
 * - 单一职责：根据 hints 输出一个真实可拼接的 MP4 URL（http(s):// 或 file://）。
 * - 不污染 real Seedance：本模块只在 mock 路径里被调用；mockHints 字段不会进入真实 payload。
 * - 双路径：
 *     主路径 → 本机 ffmpeg 动态生成（每段独特的颜色 + drawbox 组合，肉眼可辨）
 *     fallback → public/mock-clips/{aspect}.mp4 静态占位（ffmpeg 缺失时）
 * - 终态 URL：
 *     若 storage provider 已配置（Vercel Blob / 火山 TOS），把 mp4 上传，返回 https URL；
 *     否则返回 file:// URL（dev/local 调用方 stitch-service 已被同步扩展为支持 file://）。
 *
 * 不依赖 Big Buck Bunny 或任何远程 sample video URL（Phase 2 显式约束）。
 */

const execFileAsync = promisify(execFile);
const { colors } = editorialDesignTokens;

export interface MockClipHints {
  briefId: string;
  segmentIndex: number;
  segmentCount: number;
  durationSec: number;
  /// 形如 "9:16" / "16:9" / "1:1"，未知值会兜底到 9:16
  aspectRatio: string;
  /// 可选：用于缓存键多样性 / 调试观察（如 hook / demo / cta）
  purpose?: string;
}

export interface MockClipResult {
  url: string;
  thumbnailUrl: string | null;
  source: "ffmpeg-dynamic" | "static-fallback" | "ffmpeg-dynamic-blob";
  cacheKey: string;
}

interface AspectDimensions {
  width: number;
  height: number;
  label: "9:16" | "16:9" | "1:1";
}

const ASPECT_DIMS: Record<string, AspectDimensions> = {
  "9:16": { width: 720, height: 1280, label: "9:16" },
  "16:9": { width: 1280, height: 720, label: "16:9" },
  "1:1": { width: 720, height: 720, label: "1:1" },
};

/// 6 个高对比色，循环用作每段背景，肉眼能分辨「第几段」
const SEGMENT_COLORS = [
  {
    bg: colors.mediaMockIndigoBackground,
    accent: colors.mediaMockIndigoAccent,
  },
  {
    bg: colors.mediaMockTealBackground,
    accent: colors.mediaMockTealAccent,
  },
  {
    bg: colors.mediaMockBurntBackground,
    accent: colors.mediaMockBurntAccent,
  },
  {
    bg: colors.mediaMockWineBackground,
    accent: colors.mediaMockWineAccent,
  },
  {
    bg: colors.mediaMockNavyBackground,
    accent: colors.mediaMockNavyAccent,
  },
  {
    bg: colors.mediaMockOliveBackground,
    accent: colors.mediaMockOliveAccent,
  },
];

const DEFAULT_CACHE_DIR =
  process.env.MOCK_CLIP_CACHE_DIR ??
  path.join(os.tmpdir(), "aivora-mock-clips");

const STATIC_FALLBACK_DIR = path.resolve(
  process.cwd(),
  "public",
  "mock-clips",
);

const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

function resolveAspect(aspectRatio: string): AspectDimensions {
  return ASPECT_DIMS[aspectRatio] ?? ASPECT_DIMS["9:16"];
}

function computeCacheKey(hints: MockClipHints): string {
  const norm = {
    seg: hints.segmentIndex,
    n: hints.segmentCount,
    dur: hints.durationSec,
    ratio: resolveAspect(hints.aspectRatio).label,
    purpose: hints.purpose ?? "",
  };
  const h = crypto.createHash("sha1").update(JSON.stringify(norm)).digest("hex");
  return `mock-${norm.ratio.replace(":", "x")}-${norm.dur}s-seg${norm.seg}of${norm.n}-${h.slice(0, 8)}`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync(FFMPEG_BIN, ["-version"], { timeout: 4_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 渲染一段静态 mock MP4（颜色 + 进度条 + 段索引指示框）。
 *
 * 不依赖 drawtext（部分 ffmpeg 编译版本未启用 libfreetype），
 * 用 drawbox + 颜色变化即可让用户肉眼分辨「这是第几段、多长、什么宽高」。
 */
async function renderClipWithFfmpeg(
  hints: MockClipHints,
  outputPath: string,
): Promise<void> {
  const { width, height } = resolveAspect(hints.aspectRatio);
  const palette = SEGMENT_COLORS[hints.segmentIndex % SEGMENT_COLORS.length];
  const dur = Math.max(1, Math.min(15, Math.round(hints.durationSec)));

  /// 顶部进度条：白底（半透明），上面叠一段「当前段位置」红条，纯视觉指示
  const segCount = Math.max(1, hints.segmentCount);
  const segIdx = Math.max(0, Math.min(segCount - 1, hints.segmentIndex));
  const barH = Math.max(8, Math.floor(height / 28));
  const segW = Math.floor(width / segCount);
  const segX = segW * segIdx;

  /// 底部一条 accent 色「品牌指示带」，与背景对比
  const footerH = Math.max(12, Math.floor(height / 18));

  /// 中央一个对比方块，尺寸随 segIdx 变化（差异化更明显）
  const centerSize = Math.floor(Math.min(width, height) * (0.28 + (segIdx % 3) * 0.06));
  const centerX = Math.floor((width - centerSize) / 2);
  const centerY = Math.floor((height - centerSize) / 2);

  const filters = [
    /// 背景色 + 圆角占位框
    `drawbox=x=0:y=0:w=${width}:h=${height}:color=${palette.bg}:t=fill`,
    /// 顶部进度条底
    `drawbox=x=0:y=0:w=${width}:h=${barH}:color=white@0.18:t=fill`,
    /// 顶部进度条「当前段」
    `drawbox=x=${segX}:y=0:w=${segW}:h=${barH}:color=${palette.accent}:t=fill`,
    /// 中心方块
    `drawbox=x=${centerX}:y=${centerY}:w=${centerSize}:h=${centerSize}:color=${palette.accent}@0.30:t=fill`,
    `drawbox=x=${centerX}:y=${centerY}:w=${centerSize}:h=${centerSize}:color=${palette.accent}:t=4`,
    /// 底部品牌带
    `drawbox=x=0:y=${height - footerH}:w=${width}:h=${footerH}:color=${palette.accent}@0.6:t=fill`,
  ];

  const args = [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${palette.bg}:s=${width}x${height}:d=${dur}:r=30`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=44100`,
    "-vf",
    filters.join(","),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "ultrafast",
    "-tune",
    "stillimage",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  await execFileAsync(FFMPEG_BIN, args, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 16,
  });
}

/**
 * 把本地 mp4 上传到对象存储（Vercel Blob / 火山 TOS）；
 * 未配置 storage provider → 返回 file:// URL（dev/local fallback）。
 *
 * 注意：返回 file:// URL 时调用方（stitch-service.downloadToFile）必须支持 file:// scheme，
 *   否则后续拼接会失败。Phase 2 的 stitch-service 改造会同步增加 file:// 支持。
 */
async function persistMockClipFile(
  filePath: string,
  cacheKey: string,
): Promise<{ url: string; uploaded: boolean }> {
  const { getStorageProvider } = await import("@/lib/storage");
  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    return {
      url: pathToFileURL(filePath).toString(),
      uploaded: false,
    };
  }
  try {
    const buffer = await readFile(filePath);
    const obj = await storage.uploadBuffer("renders", buffer, {
      key: `mock-ai-clips/${cacheKey}.mp4`,
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      overwrite: true,
    });
    return { url: obj.url, uploaded: true };
  } catch (err) {
    /// 上传失败不让 mock 流程整体崩 —— 退回 file:// URL，stitch 会读本地文件
    console.warn(
      `[mock-clip-generator] 对象存储上传失败，退回 file:// URL：${(err as Error).message}`,
    );
    return {
      url: pathToFileURL(filePath).toString(),
      uploaded: false,
    };
  }
}

function staticFallbackPath(aspectRatio: string): string {
  const aspect = resolveAspect(aspectRatio).label.replace(":", "x");
  return path.join(STATIC_FALLBACK_DIR, `${aspect}.mp4`);
}

/**
 * 主入口：根据 hints 给一段 mock clip 输出 URL。
 *
 * 顺序：
 *   1. 命中本地缓存（同 hints → 同 mp4）→ 直接返回缓存 URL
 *   2. 本机有 ffmpeg → 动态渲染颜色 + drawbox 标记，缓存到 tmp，可选上传 Blob
 *   3. ffmpeg 不可用 → 用 public/mock-clips/{aspect}.mp4 静态占位（file:// URL）
 *   4. 都没有 → throw 清晰错误（提示安装 ffmpeg 或补静态占位）
 */
export async function generateMockClip(
  hints: MockClipHints,
): Promise<MockClipResult> {
  const cacheKey = computeCacheKey(hints);
  const cachedPath = path.join(DEFAULT_CACHE_DIR, `${cacheKey}.mp4`);

  /// 命中缓存（且对象存储未配置）：直接复用 file:// URL
  /// 对象存储模式下我们也优先重新上传，因为 cacheKey 已稳定，put + overwrite 是幂等的
  const { getStorageProvider } = await import("@/lib/storage");
  const storageConfigured = getStorageProvider().isConfigured();
  if (await fileExists(cachedPath) && !storageConfigured) {
    return {
      url: pathToFileURL(cachedPath).toString(),
      thumbnailUrl: null,
      source: "ffmpeg-dynamic",
      cacheKey,
    };
  }

  if (await ffmpegAvailable()) {
    await mkdir(path.dirname(cachedPath), { recursive: true });
    if (!(await fileExists(cachedPath))) {
      await renderClipWithFfmpeg(hints, cachedPath);
    }
    const persisted = await persistMockClipFile(cachedPath, cacheKey);
    return {
      url: persisted.url,
      thumbnailUrl: null,
      source: persisted.uploaded ? "ffmpeg-dynamic-blob" : "ffmpeg-dynamic",
      cacheKey,
    };
  }

  /// ffmpeg 缺失：使用静态占位
  const staticPath = staticFallbackPath(hints.aspectRatio);
  if (await fileExists(staticPath)) {
    return {
      url: pathToFileURL(staticPath).toString(),
      thumbnailUrl: null,
      source: "static-fallback",
      cacheKey,
    };
  }

  throw new Error(
    `[mock-clip-generator] 本机未检测到 ffmpeg，且缺少静态占位文件 ${staticPath}。` +
      `请安装 ffmpeg（推荐）或在 public/mock-clips/ 下补 9x16.mp4 / 16x9.mp4 / 1x1.mp4 占位。`,
  );
}

/// 仅供测试导入
export const __test__ = {
  computeCacheKey,
  resolveAspect,
  staticFallbackPath,
  STATIC_FALLBACK_DIR,
  DEFAULT_CACHE_DIR,
};
