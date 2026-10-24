import type { NextRequest } from "next/server";
import { hashVisitorNetwork } from "@/lib/services/rate-limit-service";
import {
  LeadPageNotFoundError,
  LeadRateLimitedError,
  publicLeadInputSchema,
  publicValidationReason,
  submitPublicLead,
} from "@/lib/services/lead-service";
import { clientIpFromHeaders } from "@/lib/services/tracked-link-service";
import { notifyNewLead, runAfterResponse } from "@/lib/services/notification-service";
import { honeypotTripped, publicFailure, publicSuccess, readLimitedJson } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/leads —— 商家询盘页 /l/[slug] 的表单提交（匿名，middleware 精确放行）。
 *
 * 守卫：体积上限 → 蜜罐（命中假装成功）→ zod（含同意 + 版本号）→ 询盘页必须已开通且 owner 未停用 →
 * 按访客网段（IPv4 /24、IPv6 /48）哈希限流（超限回 429 并附商家电话）→ 页级繁忙线（照收不发信）/ 安全阀 →
 * 7 天去重落库 → 响应之后发通知。
 */
export async function POST(req: NextRequest) {
  const read = await readLimitedJson(req);
  if (!read.ok) return publicFailure("invalid");
  if (honeypotTripped(read.body)) return publicSuccess();

  const parsed = publicLeadInputSchema.safeParse(read.body);
  if (!parsed.success) return publicFailure(publicValidationReason(parsed.error));

  try {
    const result = await submitPublicLead(parsed.data, {
      visitorHash: hashVisitorNetwork(clientIpFromHeaders(req.headers)),
    });
    if (result.needsNotify) runAfterResponse(() => notifyNewLead(result.leadId));
    return publicSuccess();
  } catch (error) {
    if (error instanceof LeadPageNotFoundError) return publicFailure("not_found");
    if (error instanceof LeadRateLimitedError) return publicFailure("rate_limited", { fallbackPhone: error.fallbackPhone });
    console.error("[public-leads] submit failed", {
      slug: parsed.data.slug,
      error: error instanceof Error ? error.message : String(error),
    });
    return publicFailure("unavailable");
  }
}
