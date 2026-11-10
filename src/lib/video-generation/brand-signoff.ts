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
