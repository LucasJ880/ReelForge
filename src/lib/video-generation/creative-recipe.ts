import type { Prisma } from "@prisma/client";

/**
 * 创意配方快照（PRD §9.4）。
 *
 * 为什么单独一个模块而不是塞进各 service：三处 VideoJob 创建点
 * （batch-service / video-service 的单段与多段）必须落同一套字段，
 * 否则赛马的分组键在不同线路上语义不一致 —— 这正是 providerUnitPriceUsd
 * 当初「全代码库无写入点」的翻版。
 *
 * 与 videoRouteCostSnapshot 同一契约：**拿不到就不写这一列**，
 * 让它保持 null，而不是编一个默认值污染归因。
 */

/** 钩子类型。与 VideoBrief.hookPattern JSON 里的取值对齐。 */
export const HOOK_TYPES = [
  "POV",
  "Curiosity",
  "Stat",
  "Reveal",
  "Pain",
  "Demo",
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

/**
 * 品牌植入档位（PRD 决策 3）。
 * 当前默认仍是 corner_badge；决策 3 落地后默认改为 natural，corner_badge 降为保底。
 */
export const BRAND_PLACEMENTS = [
  "natural",
  "planar_track",
  "corner_badge",
] as const;
export type BrandPlacement = (typeof BRAND_PLACEMENTS)[number];

/**
 * 当前实际生效的默认档位。
 * 现状是 logo 角标 + 尾卡，所以这里如实写 corner_badge —— 快照记录的是
 * 「这条片子当时用了什么」，不是「PRD 想要什么」。决策 3 的自然植入落地时改这里，
 * 历史行保持 corner_badge 不动，赛马才能看出换档前后的差别。
 */
export const DEFAULT_BRAND_PLACEMENT: BrandPlacement = "corner_badge";

export function isHookType(value: unknown): value is HookType {
  return (
    typeof value === "string" && HOOK_TYPES.includes(value as HookType)
  );
}

export function isBrandPlacement(value: unknown): value is BrandPlacement {
  return (
    typeof value === "string" &&
    BRAND_PLACEMENTS.includes(value as BrandPlacement)
  );
}

/**
 * 模板线路的配方身份。
 *
 * 用 `slug@version` 而不是 StyleTemplate.id：cuid 对赛马结论毫无可读性，
 * 而 slug@version 既稳定又能直接读出「哪一版模板在赢」。
 * 改版即换 version，也就自动换配方 —— 这正是我们要的分组粒度。
 */
export function templateRecipeKey(template: {
  slug: string;
  version: number;
}): string {
  return `${template.slug}@${template.version}`;
}

export type CreativeRecipeInput = {
  template?: { slug: string; version: number } | null;
  hookType?: unknown;
  aspectRatio?: string | null;
  brandPlacement?: unknown;
};

export type CreativeRecipeSnapshot = Pick<
  Prisma.VideoJobCreateManyInput,
  "recipeId" | "hookType" | "templateId" | "aspectRatio" | "brandPlacement"
>;

/**
 * 供 videoJob.create / createMany 直接展开。
 * 每个字段独立判空：拿到几个写几个，不因为某一项缺失就整块放弃。
 */
export function creativeRecipeSnapshot(
  input: CreativeRecipeInput,
): CreativeRecipeSnapshot {
  const snapshot: CreativeRecipeSnapshot = {};

  if (input.template) {
    const key = templateRecipeKey(input.template);
    snapshot.templateId = key;
    snapshot.recipeId = `tpl:${key}`;
  }

  if (isHookType(input.hookType)) {
    snapshot.hookType = input.hookType;
    /// 无模板的线路（brief 直出）用钩子类型兜底成配方身份，
    /// 否则这些片子在赛马里没有分组键，等于白生成。
    snapshot.recipeId ??= `hook:${input.hookType}`;
  }

  const ratio = input.aspectRatio?.trim();
  if (ratio) snapshot.aspectRatio = ratio;

  if (isBrandPlacement(input.brandPlacement)) {
    snapshot.brandPlacement = input.brandPlacement;
  }

  return snapshot;
}

/**
 * 读 `VideoJob.templateSnapshot`。
 *
 * 它是**创建时冻结**的模板副本，不是模板现状，所以从它取画幅 / 时长 / 版本
 * 不是「反推」，而是读一份本来就存在的快照 —— 配方列加列之前的历史批量成片
 * 靠它也能进配方维度统计，不需要回填。
 *
 * ⚠️ 形状容易读错：时长与画幅在 `lockedParams` 里（`duration` / `aspectRatio`），
 * **顶层没有 `durationSec`**。读错 key 只会静默得到 undefined。
 */
export function readTemplateSnapshot(raw: unknown): {
  templateKey: string | null;
  durationSec: number | null;
  aspectRatio: string | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const snapshot = raw as {
    slug?: unknown;
    version?: unknown;
    lockedParams?: { duration?: unknown; aspectRatio?: unknown } | null;
  };
  const slug = typeof snapshot.slug === "string" ? snapshot.slug : null;
  const version =
    typeof snapshot.version === "number" ? snapshot.version : null;
  const duration = snapshot.lockedParams?.duration;
  const aspectRatio = snapshot.lockedParams?.aspectRatio;
  return {
    templateKey: slug && version !== null ? `${slug}@${version}` : null,
    durationSec:
      typeof duration === "number" && duration > 0 ? duration : null,
    aspectRatio:
      typeof aspectRatio === "string" && aspectRatio.trim()
        ? aspectRatio
        : null,
  };
}

/**
 * 从 VideoBrief.hookPattern 这类 JSON 里取钩子类型。
 * 拿不到返回 undefined —— 调用方据此让该列保持 null。
 */
export function hookTypeFromPattern(pattern: unknown): HookType | undefined {
  if (!pattern || typeof pattern !== "object") return undefined;
  const value = (pattern as { hookType?: unknown }).hookType;
  return isHookType(value) ? value : undefined;
}
