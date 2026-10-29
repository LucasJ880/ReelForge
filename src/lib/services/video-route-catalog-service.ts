import {
  videoRouteCatalogSchema,
  type VideoRouteCatalog,
  type VideoRouteFamily,
} from "@/lib/contracts/video-route-catalog";
import { runwayVideoResolution } from "@/lib/providers/runway";
import {
  auditShuyuVideoPlan,
  defaultAuditedShuyuVideoPlan,
  getShuyuPrices,
  listAuditedShuyuVideoPlans,
  shuyuVideoPlanPointsForDuration,
  type shuyuPriceSchema,
} from "@/lib/providers/shuyu";
import {
  canChooseRunwayPremium,
  shuyuFallbackToRunwayEnabled,
  type RolloutAccount,
} from "@/lib/video-generation/runway-rollout";
import { getShuyuRouteRuntimeAvailability } from "@/lib/video-generation/shuyu-runtime";
import type { z } from "zod";

type ShuyuPrice = z.infer<typeof shuyuPriceSchema>;
type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * GET /api/video-generation/routes/catalog 的业务层（2026-10-29）。
 *
 * Shuyu 的 /prices 里各家模型共用 model=studio-video，只有 display_name 分得开
 * （「SY Kling 4.0 · 1080P · 方案 108」）：家族 = 第一个「·」之前、去掉「SY 」前缀。
 * 已接入 = 过得了我们的审计（auditShuyuVideoPlan：目前只有 Seedance 2.0 / 2.5）；其余只展示，不能选。
 */
export const RUNWAY_PREMIUM_MODEL_LABEL = "Kling O3 Pro";
const RESOLUTION_ORDER = ["480P", "720P", "768P", "1080P", "2K", "4K"];

export function shuyuFamilyLabel(displayName: string): string {
  const head = displayName.split("·")[0]?.trim() ?? "";
  return head.replace(/^SY\s+/iu, "").trim() || displayName.trim();
}

function resolutionRank(resolution: string): number {
  const rank = RESOLUTION_ORDER.indexOf(resolution.toUpperCase());
  return rank === -1 ? RESOLUTION_ORDER.length : rank;
}

/** 纯函数：价目表（只取视频档）→ 客户看的目录。默认家族在最前，已接入的其次，其余按名字。 */
export function buildVideoRouteCatalog(args: {
  prices: ReadonlyArray<ShuyuPrice>;
  standardAvailable: boolean;
  fallsBackToPremium: boolean;
  premiumOffered: boolean;
  premiumResolution: "720p" | "1080p";
}): VideoRouteCatalog {
  const videoPlans = args.prices.filter((plan) => plan.kind === "video");
  const defaultPlan = defaultAuditedShuyuVideoPlan(listAuditedShuyuVideoPlans(videoPlans));
  const groups = new Map<string, ShuyuPrice[]>();
  for (const plan of videoPlans) {
    const label = shuyuFamilyLabel(plan.display_name);
    groups.set(label, [...(groups.get(label) ?? []), plan]);
  }
  const sortedResolutions = (list: ReadonlyArray<ShuyuPrice>) =>
    [...new Set(list.map((plan) => plan.resolution))].sort(
      (left, right) => resolutionRank(left) - resolutionRank(right) || left.localeCompare(right),
    );
  const families: VideoRouteFamily[] = [...groups.entries()].map(([label, plans]) => {
    const durations = plans.flatMap((plan) => plan.capabilities.durations ?? []);
    const integratedPlans = plans.filter((plan) => auditShuyuVideoPlan(plan) !== null);
    return {
      label,
      integrated: integratedPlans.length > 0,
      isDefault: defaultPlan !== undefined && plans.some((plan) => plan.plan_id === defaultPlan.planId),
      maxDurationSec: durations.length > 0 ? Math.max(...durations) : null,
      resolutions: sortedResolutions(plans),
      integratedResolutions: sortedResolutions(integratedPlans),
    };
  });
  families.sort(
    (left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      Number(right.integrated) - Number(left.integrated) ||
      left.label.localeCompare(right.label),
  );
  return videoRouteCatalogSchema.parse({
    ok: true,
    standard: {
      available: args.standardAvailable,
      defaultFamily: defaultPlan ? shuyuFamilyLabel(defaultPlan.displayName) : null,
      defaultResolution: defaultPlan?.resolution ?? null,
      fallsBackToPremium: args.fallsBackToPremium,
    },
    premium: {
      offered: args.premiumOffered,
      model: RUNWAY_PREMIUM_MODEL_LABEL,
      resolution: args.premiumResolution,
    },
    families: families.slice(0, 40),
  });
}

/// 价目表 60s 缓存：创作台每次打开「更多设置」都会来要，不必每次都打一遍 /prices
const PRICES_CACHE_TTL_MS = 60_000;
let pricesCache: { at: number; prices: ShuyuPrice[] } | null = null;

async function cachedShuyuPrices(): Promise<ShuyuPrice[]> {
  if (pricesCache && Date.now() - pricesCache.at <= PRICES_CACHE_TTL_MS) return pricesCache.prices;
  const { data } = await getShuyuPrices({ timeoutMs: 3_000 });
  pricesCache = { at: Date.now(), prices: data };
  return data;
}

export async function loadVideoRouteCatalog(args: { account: RolloutAccount; env?: Env }): Promise<VideoRouteCatalog> {
  const env = args.env ?? process.env;
  /// 价目表拿不到：目录照样给（家族为空），标准线路的可用性仍按运行时探针如实报
  const prices = await cachedShuyuPrices().catch(() => []);
  const defaultPlan = defaultAuditedShuyuVideoPlan(
    listAuditedShuyuVideoPlans(prices.filter((plan) => plan.kind === "video")),
  );
  const availability = await getShuyuRouteRuntimeAvailability({
    timeoutMs: 3_000,
    requiredPoints: defaultPlan ? shuyuVideoPlanPointsForDuration(defaultPlan, 15) : undefined,
  });
  return buildVideoRouteCatalog({
    prices,
    standardAvailable: availability.available,
    fallsBackToPremium: shuyuFallbackToRunwayEnabled(env),
    premiumOffered: canChooseRunwayPremium(args.account, env),
    premiumResolution: runwayVideoResolution(env),
  });
}

export const __testVideoRouteCatalog__ = {
  resetPricesCache: () => {
    pricesCache = null;
  },
};
