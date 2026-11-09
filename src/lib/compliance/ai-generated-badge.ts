/**
 * 成片里烧入的常驻「AI生成」角标（2026-11-09 · 抖音发布包）。
 *
 * 依据：《人工智能生成合成内容标识办法》（2025-09-01 施行）要求对 AI 生成的视频添加显式标识；
 * 配套国标对视频显式标识的要求是位于画面边角、文字高度不低于画面最短边的 5%。
 * 网页上的 `AiGeneratedLabel` 只是浮层，文件一旦被下载、转发就没有了——所以要烧进画面。
 *
 * 做法：一份只有一条 Dialogue 的 ASS，由合成管线在字幕之后再叠一层（同一次编码，
 * 字体走打包的 Noto Sans SC）。位置避开平台界面（见 platform-safe-zone）。
 *
 * 纯函数：不读环境以外的任何东西、不碰文件系统。
 */

import { isDouyinPlatform, platformSafeZone } from "@/lib/video-generation/platform-safe-zone";

export const AI_BADGE_TEXT = "AI生成";

/** 必须等于 media-fonts 的 CJK_FONT_FAMILY（有测试锁住） */
export const AI_BADGE_FONT_FAMILY = "Noto Sans SC";

/**
 * ASS 的 Fontsize 是行高（上伸 + 下伸），汉字字面只占其中约六成多。
 * 取短边的 9%：实测字面高度约为短边的 6%，高于 5% 的下限（tests/ai-generated-badge 有像素级断言）。
 */
export const AI_BADGE_FONT_RATIO = 0.09;

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * 要不要烧角标：
 *   - 调用方显式给了开关 → 以开关为准（发布包导出恒为 true）；
 *   - 目标平台是抖音 → 烧；
 *   - 部署级开关 AI_BADGE_BURN_IN=1 → 所有成片都烧；
 *   - 其余不烧（与改动前的成片逐帧一致）。
 */
export function shouldBurnAiBadge(args: {
  platform?: string | null;
  explicit?: boolean | null;
  env?: Record<string, string | undefined>;
}): boolean {
  if (typeof args.explicit === "boolean") return args.explicit;
  if (isDouyinPlatform(args.platform)) return true;
  const env = args.env ?? process.env;
  return TRUTHY.has((env.AI_BADGE_BURN_IN ?? "").trim().toLowerCase());
}

export interface AiBadgeGeometry {
  fontSize: number;
  /** 文字左上角（\an7） */
  x: number;
  y: number;
  /** 底板内边距（ASS BorderStyle=3 的 Outline） */
  padding: number;
}

/** 角标落点：左上角；有平台安全区的竖版让开顶部页签。 */
export function aiBadgeGeometry(args: {
  width: number;
  height: number;
  platform?: string | null;
}): AiBadgeGeometry {
  const shortSide = Math.min(args.width, args.height);
  const fontSize = Math.round(shortSide * AI_BADGE_FONT_RATIO);
  const padding = Math.max(4, Math.round(fontSize * 0.16));
  const zone = args.height > args.width ? platformSafeZone(args.platform) : null;
  const edge = Math.round(shortSide * 0.04);
  return {
    fontSize,
    padding,
    x: edge + padding,
    y: (zone ? Math.round(args.height * zone.topRatio) + Math.round(shortSide * 0.01) : edge) + padding,
  };
}

/**
 * 角标 ASS：白字 + 半透明黑底板，从第 0 帧铺到片尾（结束时间给一个远大于任何成片的值，
 * 合成按帧数截断，不会把成片拉长）。
 */
export function renderAiBadgeAss(args: {
  width: number;
  height: number;
  platform?: string | null;
  text?: string;
}): string {
  const geometry = aiBadgeGeometry(args);
  const text = (args.text ?? AI_BADGE_TEXT).replace(/[{}\\\r\n]/gu, "");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${args.width}
PlayResY: ${args.height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: AiBadge,${AI_BADGE_FONT_FAMILY},${geometry.fontSize},&H00FFFFFF,&H00FFFFFF,&H70000000,&H70000000,-1,0,0,0,100,100,0,0,3,${geometry.padding},0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 9,0:00:00.00,9:59:59.99,AiBadge,,0,0,0,,{\\an7\\pos(${geometry.x},${geometry.y})}${text}
`;
}
