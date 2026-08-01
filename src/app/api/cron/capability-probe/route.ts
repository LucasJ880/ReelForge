import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { probeShuyuCapabilities } from "@/lib/services/capability-probe-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * C1 · 定时能力探测（PRD §6 / M7）。
 *
 * 与 /api/internal/video-provider-routes 的存活发现互补：
 * 那条回答「现在能不能提交」，这条回答「契约漂了没有、漂在哪个字段」。
 */
export async function GET(req: NextRequest) {
  const machineFailure = machineAuthFailure(req);
  if (machineFailure) return machineFailure;

  const result = await probeShuyuCapabilities();
  return NextResponse.json(result, {
    /// 漂移时返回 503：让外部拨测（uptime 监控）也能直接告警。
    status: result.ok ? 200 : 503,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
