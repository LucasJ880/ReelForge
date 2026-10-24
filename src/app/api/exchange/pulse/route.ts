import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { loadPulse } from "@/lib/services/exchange-readings";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/exchange/pulse —— 壳层脉搏（市场状态、导轨徽标、生产带、月度额度）。
 * 只读本人数据；壳层在页面可见时每 30 秒拉一次，提交 / 取消后主动拉。
 * 失败返回 500 而不是全零：全零会被壳层读成「空闲」。
 */
export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  try {
    /// 生产带的批次名在没有产品名时退回模板名，按界面语言取（与首屏 layout 同一个 locale cookie）
    const pulse = await loadPulse(guard.session.user.id, { locale: await getServerLocale() });
    return NextResponse.json(pulse, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/exchange/pulse]", error);
    return NextResponse.json({ ok: false, error: "暂时读不到实时读数" }, { status: 500 });
  }
}
