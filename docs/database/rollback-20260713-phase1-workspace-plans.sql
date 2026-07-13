-- Run only on a rehearsed branch and only if no downstream table references Workspace.
-- CUSTOMER is intentionally left as an available enum value: PostgreSQL enum
-- value removal is destructive. Rows mapped by this migration are restored.
UPDATE "AdminUser"
SET "role" = 'OPERATOR'
WHERE "role" = 'CUSTOMER'
  AND "userType" IN ('BUSINESS', 'PERSONAL');
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'OPERATOR';
DROP TABLE IF EXISTS "Workspace";
DROP TABLE IF EXISTS "PlanEntitlement";
