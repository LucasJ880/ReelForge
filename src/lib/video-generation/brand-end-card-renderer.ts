import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { pathToFileURL } from "url";
import type { BrandPackagingPlan } from "@/types/video-generation";

/**
 * Brand End Card Renderer —— Phase 2 · L2
 *
 * 职责：把 `BrandPackagingPlan`（mode=auto_end_card）渲染成一段真实可拼接的 MP4。
 *
 * 关键约束：
 *  - logo / brandName / CTA / website 一律由 Aivora 自己渲染，绝不交给 Seedance。
 *  - 不接受远程 sample video URL fallback；要么真渲染，要么明确返回 null。
 *
 * 实现路径：
 *  1. 由 BrandPackagingPlan + aspectRatio 拼一份内联 SVG（背景渐变 + 文字 + 留洞给 logo）。
 *  2. 用 sharp 把 SVG 栅格化成 PNG。如果有 logo URL，下载、resize、composite 到 PNG 中央。
 *  3. ffmpeg 把 PNG 当静帧 + 静音音轨打包成 MP4（duration = endCardDurationSeconds）。
 *  4. storage provider 已配置 → 上传对象存储（Blob/TOS）返回 https URL，否则返回 file:// URL。
 *
 * 失败策略（dev/local 模式）：
 *  - sharp 报错 → 退回纯色 + 简化版 SVG（无文字，仅色块），仍输出 MP4
 *  - ffmpeg 缺失 → 抛清晰错误（assembly-executor 会向 UI 暴露）
 *
 * Phase 2.5 计划：将复杂渲染搬到外部 GH Action runner（drawtext+freetype 完整支持），
 *   本模块在 STITCH_RUNTIME=external 时返回「deferred」让上层占位等外部 runner。
 */

const execFileAsync = promisify(execFile);

interface AspectDims {
  width: number;
  height: number;
  label: "9:16" | "16:9" | "1:1";
}

const ASPECT_DIMS: Record<string, AspectDims> = {
  "9:16": { width: 720, height: 1280, label: "9:16" },
  "16:9": { width: 1280, height: 720, label: "16:9" },
  "1:1": { width: 720, height: 720, label: "1:1" },
};

const DEFAULT_CACHE_DIR =
  process.env.BRAND_END_CARD_CACHE_DIR ??
  path.join(os.tmpdir(), "aivora-brand-end-cards");

const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

export type EndCardSource =
  | "ffmpeg-overlay"
  | "ffmpeg-overlay-blob"
  | "deferred-external"
  | "skipped";

export interface BrandEndCardRenderInput {
  briefId: string;
  plan: BrandPackagingPlan;
  aspectRatio: string;
  /// 已经从 attachments 解析出的 logo URL（若 mode=auto_end_card 且用户提供了 logo）
  logoUrl?: string | null;
}

export interface BrandEndCardRenderResult {
  url: string | null;
  durationSec: number;
  cacheKey: string;
  source: EndCardSource;
  warnings: string[];
}

function resolveAspect(aspectRatio: string): AspectDims {
  return ASPECT_DIMS[aspectRatio] ?? ASPECT_DIMS["9:16"];
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return c;
    }
  });
}

/// 简单换行：超过给定 maxChars 切到下一行（中文/英文混排足够用）。
/// 若单 token 自身就超长（极长品牌名 / 拼写无空格），会被强制按字符切行；
/// 最多保留 2 行；最后一行如果还超长，截断并加 "…" 防止溢出画布。
function wrapText(text: string, maxChars: number): string[] {
  if (!text) return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  /// 把超长 token 强制切成 maxChars 大小的小段（拼写无空格的极端品牌名）
  const expanded: string[] = [];
  for (const t of tokens) {
    if (t.length <= maxChars) {
      expanded.push(t);
    } else {
      for (let i = 0; i < t.length; i += maxChars) {
        expanded.push(t.slice(i, i + maxChars));
      }
    }
  }

  const lines: string[] = [];
  let cur = "";
  for (const w of expanded) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);

  const truncated = lines.slice(0, 2);
  /// 最后一行若仍超过 maxChars（前面的强制切片已覆盖大多数情况，这里是双保险）
  if (truncated.length === 2 && lines.length > 2) {
    const last = truncated[1];
    truncated[1] =
      last.length > maxChars - 1
        ? `${last.slice(0, Math.max(1, maxChars - 1))}…`
        : `${last}…`;
  }
  return truncated;
}

interface BackgroundGradient {
  from: string;
  to: string;
}

const BG_PALETTES: BackgroundGradient[] = [
  { from: "#0f172a", to: "#1e293b" }, // slate
  { from: "#1e1b4b", to: "#312e81" }, // indigo
  { from: "#0c4a6e", to: "#075985" }, // sky
  { from: "#3a0f0f", to: "#7f1d1d" }, // rose
];

function pickPaletteFromBriefId(briefId: string): BackgroundGradient {
  const sum = Array.from(briefId).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return BG_PALETTES[sum % BG_PALETTES.length];
}

/**
 * 构造完整 SVG 文档。
 *
 * Layout（垂直 9:16 为参考，其他宽高比按比例适配）：
 *   - top 35%       : 留给 logo（caller 通过 sharp.composite 后期叠加）
 *   - 35-55%        : brandName（大字号）
 *   - 55-65%        : slogan（中字号，可选）
 *   - 65-80%        : CTA 按钮（圆角矩形 + 文字）
 *   - 80-90%        : website 文字
 */
function buildSvg(input: BrandEndCardRenderInput): string {
  const { width, height } = resolveAspect(input.aspectRatio);
  const palette = pickPaletteFromBriefId(input.briefId);

  const brandName = input.plan.brandName?.trim() ?? "";
  const slogan = input.plan.slogan?.trim() ?? "";
  const cta = input.plan.cta?.trim() ?? "";
  const website = input.plan.website?.trim() ?? "";
  /// V2 投资人/品牌片：hideCta=true 时跳过按钮形 CTA。
  /// 旧 brief（hideCta 缺省）保留原行为以避免回归。
  const hideCta = input.plan.hideCta === true;

  /// 字号：以画布短边为基准换算（保证 1:1 / 16:9 都不会爆出去）
  const base = Math.min(width, height);
  const brandSize = Math.round(base * 0.075);
  const sloganSize = Math.round(base * 0.038);
  const ctaSize = Math.round(base * 0.05);
  const websiteSize = Math.round(base * 0.032);

  /// 锚点 Y（按短边比例算，避免横屏挤压）
  const isVertical = height > width;
  const brandY = isVertical ? Math.round(height * 0.45) : Math.round(height * 0.4);
  const sloganY = isVertical ? Math.round(height * 0.55) : Math.round(height * 0.52);
  const ctaY = isVertical ? Math.round(height * 0.72) : Math.round(height * 0.68);
  const websiteY = isVertical ? Math.round(height * 0.88) : Math.round(height * 0.86);

  /// CTA 按钮尺寸
  const ctaText = cta || (brandName ? `Shop ${brandName}` : "Learn more");
  const ctaPadX = Math.round(base * 0.06);
  const ctaPadY = Math.round(base * 0.025);
  const ctaApproxW = Math.min(
    width - 80,
    Math.round(ctaText.length * ctaSize * 0.62 + ctaPadX * 2),
  );
  const ctaH = ctaSize + ctaPadY * 2;
  const ctaX = Math.round((width - ctaApproxW) / 2);
  const ctaRectY = ctaY - ctaH / 2;

  const brandLines = brandName ? wrapText(brandName, 18) : [];
  const sloganLines = slogan ? wrapText(slogan, 32) : [];

  const lineGap = brandSize * 1.05;

  /// CTA 按钮 SVG（仅 hideCta=false 时渲染）。hideCta=true 时整段 CTA 区不出现，
  /// website 也会上移以保持视觉重心稳定。
  const ctaButtonSvg = hideCta
    ? ""
    : `
  <rect x="${ctaX}" y="${ctaRectY}" width="${ctaApproxW}" height="${ctaH}"
        rx="${Math.round(ctaH / 2)}" ry="${Math.round(ctaH / 2)}"
        fill="#fbbf24" filter="url(#softShadow)"/>
  <text x="${width / 2}" y="${ctaY + ctaSize * 0.32}" font-family="Helvetica, Arial, sans-serif"
        font-size="${ctaSize}" font-weight="700" fill="#0f172a" text-anchor="middle">${escapeXml(ctaText)}</text>`;
  /// hideCta 模式下 website 上提到原 CTA 之上的位置，避免底部空荡。
  const finalWebsiteY = hideCta
    ? Math.round(height * (isVertical ? 0.78 : 0.75))
    : websiteY;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.from}"/>
      <stop offset="100%" stop-color="${palette.to}"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <!-- 顶部 accent 条 -->
  <rect x="0" y="0" width="${width}" height="${Math.max(6, Math.round(base / 90))}" fill="#fbbf24"/>
  ${brandLines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${brandY + i * lineGap}" font-family="Helvetica, Arial, sans-serif" font-size="${brandSize}" font-weight="700" fill="#f8fafc" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${sloganLines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${sloganY + i * sloganSize * 1.2}" font-family="Helvetica, Arial, sans-serif" font-size="${sloganSize}" fill="#cbd5e1" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}${ctaButtonSvg}
  ${
    website
      ? `<text x="${width / 2}" y="${finalWebsiteY}" font-family="Helvetica, Arial, sans-serif" font-size="${websiteSize}" fill="#cbd5e1" text-anchor="middle" opacity="0.85">${escapeXml(website)}</text>`
      : ""
  }
</svg>`;
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

function computeCacheKey(input: BrandEndCardRenderInput): string {
  const dims = resolveAspect(input.aspectRatio);
  const norm = {
    brief: input.briefId,
    ratio: dims.label,
    dur: input.plan.endCardDurationSeconds,
    brand: input.plan.brandName ?? "",
    slogan: input.plan.slogan ?? "",
    cta: input.plan.cta ?? "",
    website: input.plan.website ?? "",
    logo: input.logoUrl ?? "",
  };
  const h = crypto.createHash("sha1").update(JSON.stringify(norm)).digest("hex");
  return `endcard-${dims.label.replace(":", "x")}-${input.plan.endCardDurationSeconds}s-${h.slice(0, 10)}`;
}

async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
  try {
    /// 支持 http(s) 和 file://（dev 模式）
    if (logoUrl.startsWith("file://")) {
      const localPath = new URL(logoUrl).pathname;
      return await readFile(localPath);
    }
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * 把 SVG 栅格化为 PNG，并（如果有 logo）把 logo 居中叠加到上 1/3 区域。
 */
async function rasterizeToPng(
  input: BrandEndCardRenderInput,
  warnings: string[],
): Promise<Buffer> {
  const dims = resolveAspect(input.aspectRatio);
  const svg = buildSvg(input);

  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;

  let png: Buffer;
  try {
    png = await sharp(Buffer.from(svg))
      .resize(dims.width, dims.height, { fit: "fill" })
      .png()
      .toBuffer();
  } catch (err) {
    /// 罕见路径（极小概率 librsvg 异常）：退化成纯色 PNG
    warnings.push(`SVG render failed (${(err as Error).message}); using solid color fallback.`);
    const palette = pickPaletteFromBriefId(input.briefId);
    png = await sharp({
      create: {
        width: dims.width,
        height: dims.height,
        channels: 4,
        background: palette.from,
      },
    }).png().toBuffer();
  }

  /// Logo 叠加：放在画布上 1/3 中央，等比缩放，最大不超过短边的 30%
  if (input.logoUrl) {
    const logoBuf = await fetchLogoBuffer(input.logoUrl);
    if (!logoBuf) {
      warnings.push(`Logo URL not reachable, using text-only end card.`);
    } else {
      try {
        const isVertical = dims.height > dims.width;
        const logoMax = Math.round(Math.min(dims.width, dims.height) * 0.28);
        const resizedLogo = await sharp(logoBuf)
          .resize({
            width: logoMax,
            height: logoMax,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
        /// 计算叠加位置（top 1/3 居中）
        const meta = await sharp(resizedLogo).metadata();
        const lw = meta.width ?? logoMax;
        const lh = meta.height ?? logoMax;
        const top = Math.round(dims.height * (isVertical ? 0.18 : 0.13));
        const left = Math.round((dims.width - lw) / 2);
        png = await sharp(png)
          .composite([{ input: resizedLogo, top, left }])
          .png()
          .toBuffer();
        void lh; /// only used for layout debugging
      } catch (err) {
        warnings.push(`Logo composite failed: ${(err as Error).message}`);
      }
    }
  }

  return png;
}

async function pngToMp4(
  pngPath: string,
  outputPath: string,
  durationSec: number,
): Promise<void> {
  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      String(durationSec),
      "-i",
      pngPath,
      "-f",
      "lavfi",
      "-t",
      String(durationSec),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
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
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 * 16 },
  );
}

async function persistEndCardFile(
  filePath: string,
  cacheKey: string,
): Promise<{ url: string; uploaded: boolean }> {
  const { getStorageProvider } = await import("@/lib/storage");
  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    return { url: pathToFileURL(filePath).toString(), uploaded: false };
  }
  try {
    const buf = await readFile(filePath);
    const obj = await storage.uploadBuffer("renders", buf, {
      key: `brand-end-cards/${cacheKey}.mp4`,
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      overwrite: true,
    });
    return { url: obj.url, uploaded: true };
  } catch (err) {
    console.warn(
      `[brand-end-card-renderer] 对象存储上传失败，退回 file:// URL：${(err as Error).message}`,
    );
    return { url: pathToFileURL(filePath).toString(), uploaded: false };
  }
}

/**
 * 主入口。返回 null 表示「这一段不该由 renderer 产出」（比如用户选 uploaded_clip / none）。
 */
export async function renderBrandEndCard(
  input: BrandEndCardRenderInput,
): Promise<BrandEndCardRenderResult | null> {
  const { plan } = input;
  const warnings: string[] = [...(plan.warnings ?? [])];

  if (plan.mode === "none") return null;
  if (plan.mode === "uploaded_clip") return null;
  if (plan.mode !== "auto_end_card") return null;

  const cacheKey = computeCacheKey(input);
  const dur = Math.max(2, Math.round(plan.endCardDurationSeconds || 3));

  /// Production / external runner：本模块不在 Vercel 函数里跑 ffmpeg，
  /// 让 assembly-executor 在 STITCH_RUNTIME=external 时识别 deferred 状态
  /// （Phase 2.5 会真正接外部 runner）
  if (stitchRuntimeMode() === "external") {
    return {
      url: null,
      durationSec: dur,
      cacheKey,
      source: "deferred-external",
      warnings: [
        ...warnings,
        "Brand end card rendering deferred to external stitcher (Phase 2.5).",
      ],
    };
  }

  if (!(await ffmpegAvailable())) {
    /// dev 没装 ffmpeg —— 让 caller 把 end card 视为缺失（warn，不崩）
    return {
      url: null,
      durationSec: dur,
      cacheKey,
      source: "skipped",
      warnings: [
        ...warnings,
        "ffmpeg not available locally; end card rendering skipped.",
      ],
    };
  }

  await mkdir(DEFAULT_CACHE_DIR, { recursive: true });
  const mp4Path = path.join(DEFAULT_CACHE_DIR, `${cacheKey}.mp4`);

  if (!(await fileExists(mp4Path))) {
    const pngPath = path.join(DEFAULT_CACHE_DIR, `${cacheKey}.png`);
    const png = await rasterizeToPng(input, warnings);
    await writeFile(pngPath, png);
    try {
      await pngToMp4(pngPath, mp4Path, dur);
    } catch (err) {
      return {
        url: null,
        durationSec: dur,
        cacheKey,
        source: "skipped",
        warnings: [...warnings, `End card MP4 encode failed: ${(err as Error).message}`],
      };
    }
  }

  const persisted = await persistEndCardFile(mp4Path, cacheKey);
  return {
    url: persisted.url,
    durationSec: dur,
    cacheKey,
    source: persisted.uploaded ? "ffmpeg-overlay-blob" : "ffmpeg-overlay",
    warnings,
  };
}

function stitchRuntimeMode(): "local" | "external" {
  const explicit = (process.env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "external") return "external";
  return process.env.NODE_ENV === "production" ? "external" : "local";
}

/// 仅供测试导入
export const __test__ = {
  buildSvg,
  computeCacheKey,
  resolveAspect,
  pickPaletteFromBriefId,
  wrapText,
  escapeXml,
};
