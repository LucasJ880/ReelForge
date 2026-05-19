import Stripe from "stripe";
import { db } from "@/lib/db";

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export async function createProCheckoutSession(params: {
  userId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string } | { error: string }> {
  const stripe = stripeClient();
  const priceId = process.env.STRIPE_PRO_PRICE_ID?.trim();
  if (!stripe || !priceId) {
    return { error: "Stripe 未配置（需要 STRIPE_SECRET_KEY 与 STRIPE_PRO_PRICE_ID）" };
  }

  const user = await db.adminUser.findUnique({
    where: { id: params.userId },
    select: { stripeCustomerId: true },
  });

  let customerId = user?.stripeCustomerId ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: params.email,
      metadata: { aivoraUserId: params.userId },
    });
    customerId = customer.id;
    await db.adminUser.update({
      where: { id: params.userId },
      data: { stripeCustomerId: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { aivoraUserId: params.userId },
  });

  if (!session.url) {
    return { error: "无法创建 Checkout 会话" };
  }
  return { url: session.url };
}

export async function applyStripeSubscriptionToUser(params: {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  tier: "free" | "pro";
}) {
  await db.adminUser.update({
    where: { id: params.userId },
    data: {
      subscriptionTier: params.tier,
      stripeCustomerId: params.stripeCustomerId ?? undefined,
      stripeSubscriptionId: params.stripeSubscriptionId ?? undefined,
    },
  });
}

export async function handleStripeWebhookEvent(
  payload: string,
  signature: string,
): Promise<void> {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) {
    throw new Error("Stripe webhook 未配置");
  }

  const event = stripe.webhooks.constructEvent(payload, signature, secret);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.aivoraUserId;
    if (!userId) return;
    await applyStripeSubscriptionToUser({
      userId,
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : null,
      stripeSubscriptionId:
        typeof session.subscription === "string"
          ? session.subscription
          : null,
      tier: "pro",
    });
    return;
  }

  if (
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.updated"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    if (!customerId) return;
    const user = await db.adminUser.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!user) return;
    const active = sub.status === "active" || sub.status === "trialing";
    await applyStripeSubscriptionToUser({
      userId: user.id,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      tier: active ? "pro" : "free",
    });
  }
}
