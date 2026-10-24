import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  createProCheckoutSession,
  isStripeConfigured,
} from "@/lib/services/stripe-billing-service";

/// 支付完成 / 取消后回到的页面：必须是 src/app 下真实存在的路由（有回归测试守着）。
const CHECKOUT_RETURN_PATH = "/app/create";

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "付费升级尚未在本环境启用" },
      { status: 503 },
    );
  }

  const userId = guard.session.user.id;
  const email = guard.session.user.email;
  if (!userId || !email) {
    return NextResponse.json({ error: "会话无效，请重新登录" }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  /// 旧的 /{persona}/billing 页面已随客户自助面迁移下线（只剩 next.config 里的 308），
  /// 支付回跳直接落到真实存在的工作台页，不经过跳转链、也不再按 persona 拼路径。
  const result = await createProCheckoutSession({
    userId,
    email,
    successUrl: `${origin}${CHECKOUT_RETURN_PATH}?upgraded=1`,
    cancelUrl: `${origin}${CHECKOUT_RETURN_PATH}`,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({ url: result.url });
}
