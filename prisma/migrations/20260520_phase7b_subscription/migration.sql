-- Phase 7b: Stripe subscription fields on AdminUser

ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "subscriptionTier" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_stripeCustomerId_key" ON "AdminUser"("stripeCustomerId");
