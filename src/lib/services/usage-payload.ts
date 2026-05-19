import type { Session } from "next-auth";
import type { UsageResource } from "@prisma/client";
import {
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

export async function loadUsagePayloadForSession(
  session: Session,
): Promise<UsagePayload> {
  const summary = await getUsageSummary(session.user.id);
  return {
    ok: true,
    enforced: isQuotaEnforced(),
    exempt: isQuotaExemptSession(session),
    ...summary,
  };
}
