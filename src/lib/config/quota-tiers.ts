import type { UsageResource } from "@prisma/client";

export type QuotaPlanId = "free";

/** 免费档月度限额（PERSONAL / BUSINESS 共用；Phase 7b 再分套餐） */
export const QUOTA_LIMITS: Record<
  QuotaPlanId,
  Record<UsageResource, number>
> = {
  free: {
    VIDEO_DISPATCH: 30,
    PLAN_PREVIEW: 120,
    BLOB_UPLOAD_BYTES: 1024 * 1024 * 1024, // 1 GiB / month
    SEEDANCE_SEGMENT: 60,
  },
};

export const REGISTER_RATE_LIMIT = {
  perIpPerHour: 8,
  perEmailPerDay: 3,
} as const;

export const USAGE_RESOURCE_LABELS: Record<UsageResource, string> = {
  VIDEO_DISPATCH: "视频生成次数",
  PLAN_PREVIEW: "方案预览次数",
  BLOB_UPLOAD_BYTES: "素材上传流量",
  SEEDANCE_SEGMENT: "AI 画面段数",
};
