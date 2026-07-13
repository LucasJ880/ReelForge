-- Phase 1 expand-only migration: one default Workspace per existing user and
-- persistent starter/studio plan entitlements.

-- Customer accounts must not borrow the OPERATOR role and rely on the legacy
-- BUSINESS/PERSONAL discriminator to be denied internal access.
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

-- Fail closed if historical data contains a customer persona with a role whose
-- meaning cannot be migrated mechanically. SUPER_ADMIN is an approved system
-- role and remains authoritative even when a legacy BUSINESS persona is set.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AdminUser"
    WHERE "userType" IN ('BUSINESS', 'PERSONAL')
      AND "role" NOT IN ('OPERATOR', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Phase 1 role migration requires human review for customer personas with an unapproved system role';
  END IF;
END $$;

UPDATE "AdminUser"
SET "role" = 'CUSTOMER'
WHERE "userType" IN ('BUSINESS', 'PERSONAL')
  AND "role" = 'OPERATOR';

CREATE TABLE "PlanEntitlement" (
  "id" TEXT NOT NULL,
  "monthlyVideoLimit" INTEGER NOT NULL,
  "batchConcurrencyLimit" INTEGER NOT NULL,
  "templateLibraryAccess" TEXT NOT NULL,
  "featureFlags" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_ownerId_key" ON "Workspace"("ownerId");
CREATE INDEX "Workspace_planId_idx" ON "Workspace"("planId");

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "PlanEntitlement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanEntitlement"
  ADD CONSTRAINT "PlanEntitlement_id_check"
  CHECK ("id" IN ('starter', 'studio'));

ALTER TABLE "PlanEntitlement"
  ADD CONSTRAINT "PlanEntitlement_limits_check"
  CHECK ("monthlyVideoLimit" >= 0 AND "batchConcurrencyLimit" >= 0);

INSERT INTO "PlanEntitlement" (
  "id", "monthlyVideoLimit", "batchConcurrencyLimit",
  "templateLibraryAccess", "featureFlags", "updatedAt"
) VALUES
  ('starter', 30, 10, 'standard', '{"digitalHuman": false}'::jsonb, CURRENT_TIMESTAMP),
  ('studio', 200, 10, 'full', '{"digitalHuman": false}'::jsonb, CURRENT_TIMESTAMP);

-- Approved mapping: BUSINESS -> studio, PERSONAL -> starter.
-- System personas receive starter data by default; system role checks remain
-- independent and continue to control internal access.
INSERT INTO "Workspace" (
  "id", "name", "ownerId", "planId", "isDefault", "updatedAt"
)
SELECT
  'ws_' || u."id",
  COALESCE(NULLIF(u."name", ''), split_part(u."email", '@', 1), 'Aivora Workspace'),
  u."id",
  CASE WHEN u."userType" = 'BUSINESS' THEN 'studio' ELSE 'starter' END,
  true,
  CURRENT_TIMESTAMP
FROM "AdminUser" u
ON CONFLICT ("ownerId") DO NOTHING;
