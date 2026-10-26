import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { loadPublicVideoRouteOptions } from "@/lib/services/video-route-options-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated, sanitized selector data. Raw provider balance is never sent.
 * 业务在 video-route-options-service:final 档(1080P)只对内部员工返回,
 * 默认档与预检成本永远是 draft 档首位(最便宜的 720P)。
 */
export async function GET(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  void req;
  const payload = await loadPublicVideoRouteOptions({
    internalStaff: isInternalRole(guard.session.user.role),
    timeoutMs: 3_000,
  });
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
