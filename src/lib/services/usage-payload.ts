import type { Session } from "next-auth";
import type { UsageResource } from "@prisma/client";
import { QUOTA_LIMITS, type QuotaPlanId } from "@/lib/config/quota-tiers";
import {
  currentUsagePeriodKey,
  getLimitForResource,
  getUsageSummary,
  isQuotaEnforced,
  isQuotaExemptSession,
} from "@/lib/services/quota-service";

export type UsageMeterPayload = {
  resource: UsageResource;
  used: number;
  limit: number;
  remaining: number;
  periodKey: string;
};

export type UsagePayload = {
  ok: true;
  enforced: boolean;
  exempt: boolean;
  plan: string;
  periodKey: string;
  meters: UsageMeterPayload[];
};

/** DB 不可用时仍展示 starter 限额（used=0），避免 Billing 白屏 */
export function buildDefaultUsagePayload(session: Session): UsagePayload {
  const plan: QuotaPlanId = "starter";
  const periodKey = currentUsagePeriodKey();
  const resources = Object.keys(QUOTA_LIMITS.starter) as UsageResource[];
  const meters = resources.map((resource) => {
    const limit = getLimitForResource(plan, resource);
    return {
      resource,
      used: 0,
      limit,
      remaining: limit,
      periodKey,
    };
  });
  return {
    ok: true,
    enforced: isQuotaEnforced(),
    exempt: isQuotaExemptSession(session),
    plan,
    periodKey,
    meters,
  };
}

export async function loadUsagePayloadForSession(
  session: Session,
): Promise<UsagePayload> {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error("会话缺少用户 ID，请退出后重新登录");
  }

  try {
    const summary = await getUsageSummary(userId);
    return {
      ok: true,
      enforced: isQuotaEnforced(),
      exempt: isQuotaExemptSession(session),
      ...summary,
    };
  } catch (err) {
    console.error("[loadUsagePayloadForSession]", err);
    return buildDefaultUsagePayload(session);
  }
}
