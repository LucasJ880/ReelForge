/**
 * 平台界面安全区（2026-11-09 · 抖音发布包）。
 *
 * 竖版成片在信息流里会被平台界面盖住一部分：抖音底部约 20% 是账号名 / 文案 / 音乐条，
 * 右侧一列是头像、点赞、评论、分享按钮，顶部是「关注 / 推荐」页签。字幕和角标落进这些
 * 区域等于白烧。这里是「平台 → 留白」的唯一一张表，导演方案的安全区说明、字幕烧录的边距、
 * 「AI生成」角标的落点都从这里取。
 *
 * 纯数据 + 纯函数：不引任何服务端模块，客户端与服务端都能安全 import。
 */

export interface PlatformSafeZone {
  /** 顶部留白（占画面高度） */
  topRatio: number;
  /** 底部留白（占画面高度） */
  bottomRatio: number;
  /** 右侧按钮列留白（占画面宽度） */
  rightRatio: number;
}

/** 抖音竖版信息流：底部约 20%、右侧按钮列约 14%、顶部页签约 10%。 */
export const DOUYIN_SAFE_ZONE: PlatformSafeZone = {
  topRatio: 0.1,
  bottomRatio: 0.2,
  rightRatio: 0.14,
};

export function isDouyinPlatform(platform: string | null | undefined): boolean {
  return platform?.trim().toLowerCase() === "douyin";
}

/** 平台的界面安全区；没有专门规则的平台返回 null（沿用各处原有的默认值）。 */
export function platformSafeZone(platform: string | null | undefined): PlatformSafeZone | null {
  return isDouyinPlatform(platform) ? DOUYIN_SAFE_ZONE : null;
}

/**
 * 导演方案里的安全区说明（DirectorPlan.editingPlan.safeAreaNotes）。
 * 抖音之外保持原句不变。
 */
export function safeAreaNotesFor(platform: string | null | undefined): string {
  if (isDouyinPlatform(platform)) {
    return (
      "Keep captions and key product details out of the bottom 20% (Douyin caption and music bar), " +
      "the right-hand 14% (avatar / like / comment / share button column) and the top 10% (feed tabs)."
    );
  }
  return "Keep captions inside the central 80% to clear TikTok UI overlays.";
}

export interface CaptionMargins {
  marginL: number;
  marginR: number;
  marginV: number;
}

/**
 * 字幕烧录边距（ASS 坐标 = 输出分辨率）。只有竖版才有界面遮挡：横版 / 方版在信息流里
 * 上下留黑，平台界面盖不到画面，返回 null 沿用默认边距。
 *   - 底部 / 居中字幕：下边距抬到安全线之上，右边距让开按钮列；
 *   - 顶部字幕：上边距让开页签。
 */
export function captionMarginsFor(args: {
  platform: string | null | undefined;
  aspectRatio: string;
  width: number;
  height: number;
  position: "top" | "center" | "bottom";
}): CaptionMargins | null {
  const zone = platformSafeZone(args.platform);
  if (!zone || args.aspectRatio !== "9:16") return null;
  const marginL = Math.round(args.width * 0.074);
  /// 向上取整：留白只多不少
  const marginR = Math.ceil(args.width * zone.rightRatio);
  const marginV =
    args.position === "top"
      ? Math.round(args.height * zone.topRatio)
      : /// 安全线之上再留一点呼吸，字幕描边不贴线
        Math.ceil(args.height * zone.bottomRatio) + Math.round(args.height * 0.008);
  return { marginL, marginR, marginV };
}
