import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { loadVideoRouteCatalog } from "@/lib/services/video-route-catalog-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 创作台「生成线路」卡的数据（2026-10-29）：标准（Shuyu，默认）与高质量（Runway）两个选项，
 * 以及 Shuyu 开放给我们的全部视频类别。业务在 video-route-catalog-service；不给积分单价与余额。
 */
export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const payload = await loadVideoRouteCatalog({
    account: { userId: guard.session.user.id, email: guard.session.user.email ?? null },
  });
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
