import type { UsageResource } from "@prisma/client";

/**
 * starter/studio are the Phase 1 product plans. free/pro remain accepted as
 * transition aliases while the legacy Stripe and billing pages are retired.
 * trial（D5，2026-10-25）：本轮上线后自助注册的新账号，额度见 TRIAL_LIMITS。
 */
export type QuotaPlanId = "trial" | "starter" | "studio" | "free" | "pro";

const STARTER_LIMITS: Record<UsageResource, number> = {
  VIDEO_DISPATCH: 30,
  PLAN_PREVIEW: 120,
  BLOB_UPLOAD_BYTES: 1024 * 1024 * 1024, // 1 GiB / month
  SEEDANCE_SEGMENT: 60,
  // The sealed digital-human feature cannot consume this compatibility meter.
  DIGITAL_HUMAN_AD: 0,
};

const STUDIO_LIMITS: Record<UsageResource, number> = {
  VIDEO_DISPATCH: 200,
  PLAN_PREVIEW: 600,
  BLOB_UPLOAD_BYTES: 10 * 1024 * 1024 * 1024, // 10 GiB / month
  SEEDANCE_SEGMENT: 400,
  // The sealed digital-human feature cannot consume this compatibility meter.
  DIGITAL_HUMAN_AD: 0,
};

/**
 * 试用档（D5）：只收紧两个真金白银的计量——视频条数与 AI 画面段数；
 * 方案预览与上传流量照 starter，不让试用账号连「看一眼方案」都做不了。
 * 产品图与内容计划不走月度计量，而是按小时限流（paid-action-rate-limit）。
 */
const TRIAL_LIMITS: Record<UsageResource, number> = {
  ...STARTER_LIMITS,
  VIDEO_DISPATCH: 3,
  SEEDANCE_SEGMENT: 6,
};

/** 月度限额（PERSONAL / BUSINESS 共用） */
export const QUOTA_LIMITS: Record<
  QuotaPlanId,
  Record<UsageResource, number>
> = {
  trial: TRIAL_LIMITS,
  starter: STARTER_LIMITS,
  studio: STUDIO_LIMITS,
  free: STARTER_LIMITS,
  pro: STUDIO_LIMITS,
};

/**
 * 试用的确定性信号：注册路由把 AdminUser.subscriptionTier 写成 "trial"。
 *
 * 为什么不是 Workspace.planId = "trial"：planId 外键指向 PlanEntitlement，
 * 本轮不加数据迁移就没有 trial 那一行。subscriptionTier 的默认值是 "free"，
 * 所以存量账号（含脚本建的验收账号）一律不受影响；Stripe 订阅成功会把它改写成
 * free / pro，试用随之结束。超管手工转正：把该账号的 subscriptionTier 改回 "free"。
 */
export const TRIAL_SUBSCRIPTION_TIER = "trial";

/** resolveQuotaPlan 读工作区时用的 select（与 quotaPlanFromWorkspace 成对使用）。 */
export const QUOTA_PLAN_WORKSPACE_SELECT = {
  planId: true,
  owner: { select: { subscriptionTier: true } },
} as const;

/**
 * 工作区套餐 → 计量档。Workspace.planId 仍是主依据：studio 永远是 studio
 * （超管给试用账号手工开 studio 也立即生效）；starter 账号带试用标记时按 trial 计。
 */
export function quotaPlanFromWorkspace(
  workspace:
    | { planId: string | null; owner?: { subscriptionTier: string | null } | null }
    | null
    | undefined,
): QuotaPlanId {
  if (workspace?.planId === "studio") return "studio";
  if (workspace?.owner?.subscriptionTier === TRIAL_SUBSCRIPTION_TIER) return "trial";
  return "starter";
}

export const STRIPE_PRO_PRICE_LABEL = "Aivora Pro — monthly";

export const REGISTER_RATE_LIMIT = {
  perIpPerHour: 8,
  perEmailPerDay: 3,
} as const;

export const USAGE_RESOURCE_LABELS: Record<UsageResource, string> = {
  VIDEO_DISPATCH: "视频生成次数",
  PLAN_PREVIEW: "方案预览次数",
  BLOB_UPLOAD_BYTES: "素材上传流量",
  SEEDANCE_SEGMENT: "AI 画面段数",
  DIGITAL_HUMAN_AD: "数字人探店广告",
};
