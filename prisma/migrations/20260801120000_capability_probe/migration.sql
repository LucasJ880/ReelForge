-- C1 · 能力探测历史（PRD §6 / M7）。只加表。
CREATE TABLE "CapabilityProbe" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "auditedPlanFound" BOOLEAN NOT NULL,
    "videoPlansGone" BOOLEAN NOT NULL,
    "driftsJson" JSONB,
    "probedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CapabilityProbe_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CapabilityProbe_provider_probedAt_idx" ON "CapabilityProbe"("provider", "probedAt" DESC);
