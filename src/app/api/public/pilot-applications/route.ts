import type { NextRequest } from "next/server";
import { RateLimitExceededError, hashVisitorNetwork } from "@/lib/services/rate-limit-service";
import {
  pilotApplicationInputSchema,
  publicValidationReason,
  submitPilotApplication,
} from "@/lib/services/lead-service";
import { clientIpFromHeaders } from "@/lib/services/tracked-link-service";
import { notifyPilotApplication, runAfterResponse } from "@/lib/services/notification-service";
import { honeypotTripped, publicFailure, publicSuccess, readLimitedJson } from "../_shared";
import { contactEmail } from "@/lib/config/contact";

export const dynamic = "force-dynamic";

/** 限流 / 故障时给访客的备用联系邮箱（没配就不给，只说稍后再试）。 */
function fallbackEmail(): string | null {
  return contactEmail();
}

/**
 * POST /api/public/pilot-applications —— 公开首页「申请 30 天试点」（匿名，middleware 精确放行）。
 *
 * 守卫：体积上限 → 蜜罐 → zod（至少一种联系方式 + 同意 + 版本号）→ 按访客网段（IPv4 /24、IPv6 /48）
 * 哈希限流 → 全局繁忙线（照收不发信）/ 安全阀 → 落库（consentJson 存当时的同意文本与版本、逐渠道同意）→
 * 响应之后通知创始人。
 */
export async function POST(req: NextRequest) {
  const read = await readLimitedJson(req);
  if (!read.ok) return publicFailure("invalid");
  if (honeypotTripped(read.body)) return publicSuccess();

  const parsed = pilotApplicationInputSchema.safeParse(read.body);
  if (!parsed.success) return publicFailure(publicValidationReason(parsed.error));

  try {
    const { id, notify } = await submitPilotApplication(parsed.data, {
      visitorHash: hashVisitorNetwork(clientIpFromHeaders(req.headers)),
    });
    if (notify) runAfterResponse(() => notifyPilotApplication(id));
    return publicSuccess();
  } catch (error) {
    if (error instanceof RateLimitExceededError) return publicFailure("rate_limited", { fallbackEmail: fallbackEmail() });
    console.error("[public-pilot] submit failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return publicFailure("unavailable", { fallbackEmail: fallbackEmail() });
  }
}
