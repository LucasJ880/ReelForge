import { z } from "zod";
import { platformSafeZone } from "@/lib/video-generation/platform-safe-zone";

/**
 * 片尾落款（2026-11-10）：成片最后约两秒，在真实画面上压一行品牌名 + 一行行动指引。
 *
 * 为什么是落款而不是尾卡：10-28 撤掉片尾品牌卡，是因为它硬切到一张跟片子无关的卡（CEO 拍保温杯，
 * 片尾冒出窗帘厂的 logo）。落款压在片子自己最后一个镜头上，没有切换；文字由合成时直接烧上去，
 * 不经过视频模型，不会走样。每条片子单独勾选、默认不带，品牌名与行动指引由商家在这条片子上确认。
 *
 * 纯函数 + zod：客户端表单、接口、合成器与测试共用，不引服务端模块。
 */
export const SIGNOFF_BRAND_MAX = 24;
export const SIGNOFF_CTA_MAX = 28;
/** 落款出现的时长（秒）与淡入（毫秒） */
export const SIGNOFF_DURATION_SEC = 2.2;
export const SIGNOFF_FADE_IN_MS = 250;
/** 成片短于这个就不落款（两秒多的落款压在三四秒的片子上喧宾夺主） */
export const SIGNOFF_MIN_VIDEO_SEC = 6;
/** 必须等于 media-fonts 的 CJK_FONT_FAMILY（与字幕、AI 角标同一套字） */
export const SIGNOFF_FONT_FAMILY = "Noto Sans SC";

export const signoffSettingsSchema = z
  .object({
    enabled: z.boolean(),
    brandName: z.string().trim().max(SIGNOFF_BRAND_MAX),
    cta: z.string().trim().max(SIGNOFF_CTA_MAX).nullable().optional(),
    /// 落款上方带不带品牌 Logo 图。只是一个开关：用哪张图由服务端在合成时取成片主人自己工作区的默认品牌包，
    /// 客户端传不了图片地址（不给别人的品牌、也不给任意外链留口子）。
    logo: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.enabled || value.brandName.length > 0, {
    message: "开启片尾落款要填品牌名",
    path: ["brandName"],
  });

export type SignoffSettings = z.infer<typeof signoffSettingsSchema>;

/** 要不要烧：开着、且品牌名不为空。 */
export function signoffActive(signoff: SignoffSettings | null | undefined): signoff is SignoffSettings {
  return Boolean(signoff?.enabled && signoff.brandName.trim());
}

/**
 * 落款的时间窗：口播主片段的最后两秒多（有尾卡类片段时不压到尾卡上）。
 * 成片太短 → null（不落款）。
 */
export function signoffWindow(
  totalSec: number,
  captionWindowSec?: number | null,
): { startSec: number; endSec: number } | null {
  const endSec = captionWindowSec && captionWindowSec > 0 ? Math.min(totalSec, captionWindowSec) : totalSec;
  if (!(endSec >= SIGNOFF_MIN_VIDEO_SEC)) return null;
  return { startSec: Math.max(0, endSec - SIGNOFF_DURATION_SEC), endSec };
}

export interface SignoffGeometry {
  brandFontSize: number;
  ctaFontSize: number;
  padding: number;
  /** 文字块底边中点（\an2） */
  x: number;
  y: number;
}

/**
 * 落款落点：水平居中，竖直方向贴着画面下沿、躲开字幕——
 * 字幕在底部 → 落款紧挨在字幕块上方（不往上压到画面中间的商品上）；
 * 字幕关着 / 在中部 / 在顶部 → 落款放到底部安全线之上。
 * 字幕的下边距与两行高度按 audio-post-production 的 renderAssCaptions 估（9:16 下边距 150 / 字号 58）。
 */
export function signoffGeometry(args: {
  width: number;
  height: number;
  platform?: string | null;
  captionPosition?: "top" | "center" | "bottom" | null;
}): SignoffGeometry {
  const shortSide = Math.min(args.width, args.height);
  const portrait = args.height > args.width;
  const brandFontSize = Math.round(shortSide * 0.062);
  const ctaFontSize = Math.round(shortSide * 0.042);
  const padding = Math.max(4, Math.round(brandFontSize * 0.2));
  const zone = portrait ? platformSafeZone(args.platform) : null;
  /// 字幕块：下边距（平台安全线，或默认边距）+ 两行字幕的高度
  const captionBottom = zone ? zone.bottomRatio + 0.008 : portrait ? 150 / 1920 : 90 / 1080;
  const captionBlock = portrait ? 0.085 : 0.12;
  const bottomSafe = zone ? zone.bottomRatio + 0.02 : 0.1;
  const yRatio = args.captionPosition === "bottom" ? 1 - captionBottom - captionBlock - 0.025 : 1 - bottomSafe;
  return {
    brandFontSize,
    ctaFontSize,
    padding,
    x: Math.round(args.width / 2),
    y: Math.round(args.height * yRatio),
  };
}

export interface SignoffLogoGeometry {
  /// Logo 缩进这个框里（保持比例）
  maxWidth: number;
  maxHeight: number;
  /// 白色底板的内边距（品牌 Logo 多半是给浅色背景设计的，直接压在画面上常常看不清）
  pad: number;
  /// 底板底边的 y（在落款文字块上方留一条缝）
  bottomY: number;
}

/** Logo 的落点：水平居中，坐在落款文字块的正上方。 */
export function signoffLogoGeometry(args: {
  width: number;
  height: number;
  platform?: string | null;
  captionPosition?: "top" | "center" | "bottom" | null;
  hasCta: boolean;
}): SignoffLogoGeometry {
  const text = signoffGeometry(args);
  const shortSide = Math.min(args.width, args.height);
  /// 文字块高度：每行底板 ≈ 字号 + 一份内边距（2026-11-10 按本地合成出的画面量的：字号 67 / 45 的两行共约 136 像素）
  const line = (fontSize: number) => fontSize + text.padding;
  const textBlock = line(text.brandFontSize) + (args.hasCta ? line(text.ctaFontSize) : 0);
  const maxHeight = Math.round(shortSide * 0.085);
  return {
    maxWidth: Math.round(args.width * 0.42),
    maxHeight,
    pad: Math.max(4, Math.round(maxHeight * 0.14)),
    bottomY: text.y - textBlock - Math.round(shortSide * 0.012),
  };
}

/**
 * 把 Logo 叠到画面上的滤镜串（纯函数）。Logo 输入是一张循环成与成片等长的静帧：
 * 缩进框里 → 垫一整块白色底板 → 透明度从落款开始那一刻淡入（之前全透明）→ 叠在文字块上方居中。
 */
export function buildSignoffLogoFilter(args: {
  inputIndex: number;
  sourceLabel: string;
  outputLabel: string;
  geometry: SignoffLogoGeometry;
  startSec: number;
}): string {
  const { geometry } = args;
  const start = args.startSec.toFixed(3);
  const fade = (SIGNOFF_FADE_IN_MS / 1000).toFixed(3);
  return (
    `[${args.inputIndex}:v:0]scale=w=${geometry.maxWidth}:h=${geometry.maxHeight}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `format=rgba,pad=iw+${geometry.pad * 2}:ih+${geometry.pad * 2}:${geometry.pad}:${geometry.pad}:color=white@0,split[signfg][signbase];` +
    /// 整块白底板（连 Logo 自己的透明处也垫上）：pad 只给四周加边，透明底的 Logo 中间还是透的
    `[signbase]drawbox=x=0:y=0:w=iw:h=ih:color=white@0.94:t=fill:replace=1[signplate];` +
    `[signplate][signfg]overlay=format=auto,fade=t=in:st=${start}:d=${fade}:alpha=1[signlogo];` +
    `${args.sourceLabel}[signlogo]overlay=x=(W-w)/2:y=${geometry.bottomY}-h:enable='gte(t,${start})':eof_action=repeat${args.outputLabel}`
  );
}

function assTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** 商家写的字原样上屏，只去掉会被 ASS 当成指令的字符与换行。 */
export function sanitizeSignoffText(text: string): string {
  return text.replace(/[{}\\\r\n]/gu, "").trim();
}

/**
 * 落款 ASS：白字 + 半透明黑底板，品牌名一行（粗）、行动指引一行（小一号），淡入不淡出（片子到这就结束）。
 */
export function renderSignoffAss(args: {
  width: number;
  height: number;
  platform?: string | null;
  captionPosition?: "top" | "center" | "bottom" | null;
  brandName: string;
  cta?: string | null;
  startSec: number;
  endSec: number;
}): string {
  const geometry = signoffGeometry(args);
  const brand = sanitizeSignoffText(args.brandName);
  const cta = args.cta ? sanitizeSignoffText(args.cta) : "";
  const text = cta
    ? `{\\b1}${brand}{\\b0}\\N{\\fs${geometry.ctaFontSize}}${cta}`
    : `{\\b1}${brand}{\\b0}`;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${args.width}
PlayResY: ${args.height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Signoff,${SIGNOFF_FONT_FAMILY},${geometry.brandFontSize},&H00FFFFFF,&H00FFFFFF,&H70000000,&H70000000,0,0,0,0,100,100,0,0,3,${geometry.padding},0,2,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 8,${assTime(args.startSec)},${assTime(args.endSec + 1)},Signoff,,0,0,0,,{\\an2\\pos(${geometry.x},${geometry.y})\\fad(${SIGNOFF_FADE_IN_MS},0)}${text}
`;
}
