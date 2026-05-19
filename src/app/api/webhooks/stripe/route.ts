import { NextRequest, NextResponse } from "next/server";
import { handleStripeWebhookEvent } from "@/lib/services/stripe-billing-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "缺少签名" }, { status: 400 });
  }

  const payload = await req.text();
  try {
    await handleStripeWebhookEvent(payload, signature);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe webhook]", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
