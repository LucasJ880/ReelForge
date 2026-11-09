/**
 * 抖音封面：成片抽帧 + 标题字（2026-11-09 · 抖音发布包）。
 *
 * 与 logo-imprint-compositor 同一个思路：**确定性合成，不过任何生成模型**。
 * 底图是成片里真实的一帧，标题字由 sharp 把 SVG 文字层按像素叠上去（字体走打包的 Noto Sans SC），
 * 同一帧 + 同一标题永远得到同一张封面。
 *
 * 版式：
 *   - 抖音个人主页的作品格子把 9:16 封面居中裁成 3:4，所以标题与标识都落在中间 75% 高度内；
 *   - 标题最多 3 行、每行约 9 个汉字，白字深描边 + 一层自下而上的压暗，保证在任何画面上可读；
 *   - 左上角带「AI生成」标识（封面本身也是 AI 生成内容，字高不低于短边的 5%）。
 */

import sharp from "sharp";
import { ensureMediaFonts } from "@/lib/media/media-fonts";
import { AI_BADGE_TEXT } from "@/lib/compliance/ai-generated-badge";

export const COVER_TITLE_UNITS_PER_LINE = 9;
export const COVER_TITLE_MAX_LINES = 3;

const ELLIPSIS = "…";
/// 行首禁则：这些标点不允许出现在一行的开头，宁可让上一行多挂一个
const NO_LINE_START = /^[，。！？、；：）》」』”’,.!?;:)\]]$/u;

/** 一个字符占多少「字宽」：汉字与全角符号 1，拉丁字母 / 数字 / 半角符号约半个。 */
export function coverCharUnits(char: string): number {
  return /[\u0000-ÿ]/u.test(char) ? 0.55 : 1;
}

const BREAK_AFTER = /^[，。！？、；：,.!?;:]$/u;
const LATIN_WORD = /^[A-Za-z0-9]$/u;

function unitsOf(chars: readonly string[]): number {
  return chars.reduce((sum, char) => sum + coverCharUnits(char), 0);
}

/**
 * 纯函数：把标题折成封面上的几行。
 *   - 行数取放得下的最少行数，各行尽量等宽（不留「的」这种单字尾行）；
 *   - 优先在标点后断行，不拆英文单词 / 数字，标点不落行首；
 *   - 超出最大行数时截断加省略号。
 * 标题最多 30 字、最多 3 行，断点组合不过几百种，直接枚举取代价最小的。
 */
export function coverTitleLines(
  title: string,
  options: { unitsPerLine?: number; maxLines?: number } = {},
): string[] {
  const unitsPerLine = options.unitsPerLine ?? COVER_TITLE_UNITS_PER_LINE;
  const maxLines = options.maxLines ?? COVER_TITLE_MAX_LINES;
  let chars = Array.from(title.replace(/\s+/gu, " ").trim());
  if (chars.length === 0) return [];
  /// 放不下：截到「容量 - 1」再补省略号
  const capacity = unitsPerLine * maxLines;
  if (unitsOf(chars) > capacity) {
    while (chars.length > 1 && unitsOf(chars) > capacity - 1) chars.pop();
    chars = [...chars.join("").trimEnd(), ELLIPSIS];
  }
  const total = unitsOf(chars);
  const lineCount = Math.min(maxLines, Math.max(1, Math.ceil(total / unitsPerLine)));
  if (lineCount === 1) return [chars.join("")];
  const average = total / lineCount;

  /// 在 index 之前断行的代价（index = 下一行第一个字符的下标）
  const breakCost = (index: number): number => {
    const before = chars[index - 1];
    const after = chars[index];
    if (NO_LINE_START.test(after)) return Number.POSITIVE_INFINITY;
    if (LATIN_WORD.test(before) && LATIN_WORD.test(after)) return 60;
    /// 标点后断行明显优先于「两行一样宽」：不认识词，至少别把「咖啡」从中间劈开而放着逗号不用
    if (BREAK_AFTER.test(before) || before === " " || after === " ") return -8;
    return 0;
  };

  let best: { cost: number; breaks: number[] } | null = null;
  const consider = (breaks: number[]) => {
    const bounds = [0, ...breaks, chars.length];
    let cost = 0;
    for (let i = 0; i < bounds.length - 1; i += 1) {
      const units = unitsOf(chars.slice(bounds[i], bounds[i + 1]));
      if (units > unitsPerLine) return;
      cost += (units - average) ** 2;
    }
    for (const index of breaks) cost += breakCost(index);
    if (!best || cost < best.cost) best = { cost, breaks };
  };
  if (lineCount === 2) {
    for (let a = 1; a < chars.length; a += 1) consider([a]);
  } else {
    for (let a = 1; a < chars.length - 1; a += 1) {
      for (let b = a + 1; b < chars.length; b += 1) consider([a, b]);
    }
  }
  /// 极端输入（一个超长英文单词）找不到合法断法：退回按宽度硬切
  const breaks = (best as { cost: number; breaks: number[] } | null)?.breaks ?? hardBreaks(chars, unitsPerLine, maxLines);
  const bounds = [0, ...breaks, chars.length];
  return bounds
    .slice(0, -1)
    .map((from, i) => chars.slice(from, bounds[i + 1]).join("").trim())
    .filter(Boolean);
}

function hardBreaks(chars: readonly string[], unitsPerLine: number, maxLines: number): number[] {
  const breaks: number[] = [];
  let units = 0;
  chars.forEach((char, index) => {
    const width = coverCharUnits(char);
    if (units + width > unitsPerLine && breaks.length < maxLines - 1) {
      breaks.push(index);
      units = 0;
    }
    units += width;
  });
  return breaks;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface CoverOverlayLayout {
  titleFontSize: number;
  lineHeight: number;
  /** 各行基线 y */
  baselines: number[];
  /** 3:4 居中裁切后的可见区（标题与标识必须落在里面） */
  safeTop: number;
  safeBottom: number;
  badgeFontSize: number;
}

/** 纯函数：封面文字层的排版数值（单测锁「落在 3:4 可见区内」）。 */
export function coverOverlayLayout(args: {
  width: number;
  height: number;
  lineCount: number;
}): CoverOverlayLayout {
  const { width, height } = args;
  const shortSide = Math.min(width, height);
  /// 竖版封面在主页格子里居中裁成 3:4；横版 / 方版不裁
  const visibleHeight = height > width ? Math.min(height, Math.round((width * 4) / 3)) : height;
  const safeTop = Math.round((height - visibleHeight) / 2);
  const safeBottom = safeTop + visibleHeight;
  const titleFontSize = Math.round(shortSide * 0.1);
  const lineHeight = Math.round(titleFontSize * 1.28);
  const blockHeight = lineHeight * Math.max(1, args.lineCount);
  /// 标题块压在可见区下部：底边离可见区下沿留 9%
  const blockBottom = safeBottom - Math.round(visibleHeight * 0.09);
  const firstBaseline = blockBottom - blockHeight + Math.round(titleFontSize * 0.92);
  return {
    titleFontSize,
    lineHeight,
    baselines: Array.from({ length: args.lineCount }, (_, i) => firstBaseline + i * lineHeight),
    safeTop,
    safeBottom,
    badgeFontSize: Math.round(shortSide * 0.06),
  };
}

/** 纯函数：透明底的文字层 SVG（压暗渐变 + 标题 + 「AI生成」标识）。 */
export function buildCoverOverlaySvg(args: {
  width: number;
  height: number;
  title: string;
  badgeText?: string;
}): string {
  const { width, height } = args;
  const lines = coverTitleLines(args.title);
  const layout = coverOverlayLayout({ width, height, lineCount: lines.length });
  const stroke = Math.max(4, Math.round(layout.titleFontSize * 0.09));
  const badgeText = args.badgeText ?? AI_BADGE_TEXT;
  const badgePadX = Math.round(layout.badgeFontSize * 0.42);
  const badgePadY = Math.round(layout.badgeFontSize * 0.26);
  const badgeWidth =
    Math.round(
      Array.from(badgeText).reduce((sum, c) => sum + coverCharUnits(c), 0) * layout.badgeFontSize,
    ) + badgePadX * 2;
  const badgeHeight = layout.badgeFontSize + badgePadY * 2;
  const badgeX = Math.round(width * 0.05);
  const badgeY = layout.safeTop + Math.round(width * 0.05);
  const scrimTop = Math.max(layout.safeTop, (layout.baselines[0] ?? height) - layout.lineHeight * 2);
  const titleSvg = lines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${layout.baselines[i]}" font-family="Noto Sans SC, sans-serif" font-size="${layout.titleFontSize}" font-weight="700" fill="white" stroke="black" stroke-opacity="0.72" stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.62"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${scrimTop}" width="${width}" height="${height - scrimTop}" fill="url(#scrim)"/>
  <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${Math.round(badgeHeight * 0.14)}" fill="black" fill-opacity="0.56"/>
  <text x="${badgeX + badgePadX}" y="${badgeY + badgePadY + Math.round(layout.badgeFontSize * 0.86)}" font-family="Noto Sans SC, sans-serif" font-size="${layout.badgeFontSize}" font-weight="700" fill="white">${escapeXml(badgeText)}</text>
  ${titleSvg}
</svg>`;
}

export interface DouyinCoverResult {
  jpeg: Buffer;
  width: number;
  height: number;
  lines: string[];
}

/**
 * 在一帧画面上合成封面。frame 可以是任意尺寸，输出统一到 width×height（cover 裁切）。
 * @throws 打包的中文字体缺失时抛错——不交付一张标题是豆腐块的封面
 */
export async function composeDouyinCover(args: {
  frame: Buffer | string;
  title: string;
  width: number;
  height: number;
}): Promise<DouyinCoverResult> {
  /// 必须在 sharp 第一次渲染文字之前：fontconfig 只在初始化时读 FONTCONFIG_FILE
  const fonts = ensureMediaFonts();
  if (!fonts.fontFile) {
    throw new Error("bundled CJK font is missing in this runtime; refusing to render a tofu cover title");
  }
  const lines = coverTitleLines(args.title);
  if (lines.length === 0) throw new Error("cover title is empty");
  const overlay = Buffer.from(
    buildCoverOverlaySvg({ width: args.width, height: args.height, title: args.title }),
    "utf8",
  );
  const jpeg = await sharp(args.frame)
    .resize(args.width, args.height, { fit: "cover", position: "centre" })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { jpeg, width: args.width, height: args.height, lines };
}
