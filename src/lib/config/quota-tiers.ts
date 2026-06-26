import type { UsageResource } from "@prisma/client";

export type QuotaPlanId = "free" | "pro";

/** 月度限额（PERSONAL / BUSINESS 共用） */
export const QUOTA_LIMITS: Record<
  QuotaPlanId,
  Record<UsageResource, number>
> = {
  free: {
    VIDEO_DISPATCH: 30,
    PLAN_PREVIEW: 120,
    BLOB_UPLOAD_BYTES: 1024 * 1024 * 1024, // 1 GiB / month
    SEEDANCE_SEGMENT: 60,
    DIGITAL_HUMAN_AD: 10,
  },
  pro: {
    VIDEO_DISPATCH: 200,
    PLAN_PREVIEW: 600,
    BLOB_UPLOAD_BYTES: 10 * 1024 * 1024 * 1024, // 10 GiB / month
    SEEDANCE_SEGMENT: 400,
    DIGITAL_HUMAN_AD: 60,
  },
};

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
