import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  createProCheckoutSession,
  isStripeConfigured,
} from "@/lib/services/stripe-billing-service";

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
  const persona =
    guard.session.user.userType === "PERSONAL" ? "personal" : "business";
  const result = await createProCheckoutSession({
    userId,
    email,
    successUrl: `${origin}/${persona}/billing?upgraded=1`,
    cancelUrl: `${origin}/${persona}/billing`,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({ url: result.url });
}
