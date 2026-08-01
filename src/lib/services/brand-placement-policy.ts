import type { BrandPlacement } from "@/lib/video-generation/creative-recipe";

/**
 * B2 · 品牌植入分三档（PRD §5.2 / M6，决策 3）。
 *
 * 三档：自然植入（默认）/ 平面跟踪贴合 / 角标尾卡（保底）。
 * PRD 的关键改动一句话：**现状那档（角标）从「唯一做法」降为「保底档」，
 * 默认不再是它。**
 *
 * 但「默认」是有前提的：自然植入依赖产品锚点（RGBA 切片 + mask），
 * 锚点依赖抠图。**能力不在时诚实降级并写明原因**，
 * 绝不把角标片子标成 natural —— 快照记录的是「这条片子实际用了什么」，
 * 赛马要按 brandPlacement 维度验证换档有没有用，标错了那一维就废了。
 */

export type PlacementContext = {
  /// 该 SKU 的锚点状态。null = 没有锚点（没做过 / 品类没有实物产品）。
  anchorStatus: "READY" | "PENDING_CUTOUT" | "FAILED" | null;
  /// 生成线路是否支持 mask（路径 A）。Shuyu image2 无 mask 能力。
  routeSupportsMask: boolean;
};

export type PlacementDecision = {
  placement: BrandPlacement;
  /// 走的是第 1 层的哪条路径。corner_badge 没有生成路径（后处理贴角标）。
  path: "mask_edit" | "composite_back" | "overlay" | "planar_track";
  /// 为什么落在这一档。落库到日志与界面，商家与我们都能看懂降级原因。
  reason: string;
};

export function resolveBrandPlacement(
  context: PlacementContext,
): PlacementDecision {
  if (context.anchorStatus === "READY") {
    /// 锚点就绪 → 自然植入。路径按线路能力选：支持 mask 走 A（零重画），
    /// 不支持走 B（环境生成 + RGBA 贴回）。两条都算 natural —— 产品像素都是真的。
    return context.routeSupportsMask
      ? {
          placement: "natural",
          path: "mask_edit",
          reason: "锚点就绪且线路支持 mask：产品像素零重画（路径 A）",
        }
      : {
          placement: "natural",
          path: "composite_back",
          reason: "锚点就绪但线路无 mask 能力：环境生成后贴回真实切片（路径 B）",
        };
  }

  /**
   * 平面跟踪档（planar_track）当前不可达：需要 CV 单应矩阵依赖
   * （开源方案 + ffmpeg 透视滤镜，见 PRD §13 复用清单），尚未接入。
   * 这里刻意不写「先假装支持」的分支 —— 档位表里它存在，能力表里它还不在。
   */

  const anchorNote =
    context.anchorStatus === "PENDING_CUTOUT"
      ? "锚点等待抠图服务接入"
      : context.anchorStatus === "FAILED"
        ? "锚点制作失败"
        : "该产品尚未做锚点";
  return {
    placement: "corner_badge",
    path: "overlay",
    reason: `${anchorNote}，降级到保底档（角标 + 尾卡）`,
  };
}
