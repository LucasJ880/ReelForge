import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getCapabilities } from "@/lib/services/capability-status-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/capabilities —— C4 能力状态的客户视图（每个能力：状态、最近检测、何时开始异常、
 * 中英一句人话、受影响的功能）。不含供应商名、HTTP 状态等运维细节。
 *
 * 路由只做鉴权 + 调 service（CLAUDE.md §2）。service 永不抛出：状态表读不到时按配置显示，
 * 所以这里不会因为我们自己的状态表故障给客户报错。
 */
export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const capabilities = await getCapabilities();
  return NextResponse.json(capabilities, { headers: { "cache-control": "private, no-store" } });
}
