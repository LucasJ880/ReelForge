import { NextRequest, NextResponse } from "next/server";
import { grantPro, revokePro } from "@/lib/services/subscription-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Stripe Webhook 占位实现（V2）
 * ------------------------------------------------------------------
 * 需要启用时：
 * 1. 在 .env 填入 STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_MONTH_ID
 * 2. 安装 stripe sdk：`npm i stripe`
 * 3. 取消下方 const Stripe = ... 注释，并补全签名校验
 *
 * 当前 MVP 阶段此路由不参与实际流程，仅保持结构整洁供未来接入。
 * 我们会把 Stripe 的订阅生命周期事件（checkout.session.completed、
 * customer.subscription.deleted、invoice.paid）统一翻译成
 * `grantPro` / `revokePro` 两个核心动作。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, disabled: true, reason: "STRIPE_WEBHOOK_SECRET 未配置" },
      { status: 503 },
    );
  }

  // TODO(V2): 接入真实 Stripe webhook
  // const sig = req.headers.get("stripe-signature");
  // const raw = await req.text();
  // const event = stripe.webhooks.constructEvent(raw, sig!, secret);
  //
  // switch (event.type) {
  //   case "checkout.session.completed": {
  //     const session = event.data.object as Stripe.Checkout.Session;
  //     const userId = session.metadata?.userId;
  //     if (userId) await grantPro({ userId, days: 30, source: "stripe", grantedBy: event.id });
  //     break;
  //   }
  //   case "customer.subscription.deleted": {
  //     const sub = event.data.object as Stripe.Subscription;
  //     const userId = sub.metadata?.userId;
  //     if (userId) await revokePro({ userId, grantedBy: event.id });
  //     break;
  //   }
  // }

  // 提醒这些 import 不是孤儿
  void grantPro;
  void revokePro;
  void db;
  void req;

  return NextResponse.json({ ok: true, received: true, handled: false });
}
