import { NextRequest, NextResponse } from "next/server";
import { grantPro, revokePro } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

/**
 * Creem (creem.io) Webhook 占位实现（V2）
 * ------------------------------------------------------------------
 * Creem 适合中国创作者：支持 Apple Pay / 支付宝 / 微信等。
 * 启用时：
 * 1. .env 填入 CREEM_WEBHOOK_SECRET / CREEM_PRICE_MONTH_ID
 * 2. 在 Creem Dashboard 配置 webhook 指向 `/api/webhooks/creem`
 * 3. 签名校验用 HMAC-SHA256(secret, raw body)
 *
 * 事件翻译：
 *   checkout.completed  -> grantPro
 *   subscription.canceled -> revokePro
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, disabled: true, reason: "CREEM_WEBHOOK_SECRET 未配置" },
      { status: 503 },
    );
  }

  // TODO(V2): 校验签名 + 翻译事件
  void grantPro;
  void revokePro;
  void req;

  return NextResponse.json({ ok: true, received: true, handled: false });
}
