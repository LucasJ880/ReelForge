import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  isFeatureEnabledForPlan,
  isSystemRole,
  PLAN_ENTITLEMENT_DEFAULTS,
  planForLegacyUserType,
} from "../src/lib/services/workspace-plan-service";
import { QUOTA_LIMITS } from "../src/lib/config/quota-tiers";
import { __test__ as batchTest } from "../src/lib/services/batch-service";

test("Phase1 plan migration matrix：BUSINESS→studio，PERSONAL→starter，系统 persona 保持 starter 数据", () => {
  assert.equal(planForLegacyUserType("BUSINESS"), "studio");
  assert.equal(planForLegacyUserType("PERSONAL"), "starter");
  assert.equal(planForLegacyUserType("OPERATOR"), "starter");
  assert.equal(planForLegacyUserType("SUPER_ADMIN"), "starter");
});

test("Phase1 system roles 保持角色语义，不由 workspace plan 替代", () => {
  assert.equal(isSystemRole("OPERATOR"), true);
  assert.equal(isSystemRole("SUPER_ADMIN"), true);
  assert.equal(isSystemRole("REVIEWER"), false);
});

test("Phase1 entitlement matrix 持久表达月额度、批次并发与模板权限", () => {
  assert.deepEqual(
    {
      monthlyVideoLimit: PLAN_ENTITLEMENT_DEFAULTS.starter.monthlyVideoLimit,
      batchConcurrencyLimit: PLAN_ENTITLEMENT_DEFAULTS.starter.batchConcurrencyLimit,
      templateLibraryAccess: PLAN_ENTITLEMENT_DEFAULTS.starter.templateLibraryAccess,
    },
    { monthlyVideoLimit: 30, batchConcurrencyLimit: 10, templateLibraryAccess: "standard" },
  );
  assert.deepEqual(
    {
      monthlyVideoLimit: PLAN_ENTITLEMENT_DEFAULTS.studio.monthlyVideoLimit,
      batchConcurrencyLimit: PLAN_ENTITLEMENT_DEFAULTS.studio.batchConcurrencyLimit,
      templateLibraryAccess: PLAN_ENTITLEMENT_DEFAULTS.studio.templateLibraryAccess,
    },
    { monthlyVideoLimit: 200, batchConcurrencyLimit: 10, templateLibraryAccess: "full" },
  );
});

test("Phase1 digital human 对 starter/studio 全部关闭", () => {
  assert.equal(isFeatureEnabledForPlan("starter", "digitalHuman"), false);
  assert.equal(isFeatureEnabledForPlan("studio", "digitalHuman"), false);
});

test("Phase1 plan 配额矩阵直接驱动统一生成额度，旧 free/pro 仅为等值过渡别名", () => {
  assert.equal(QUOTA_LIMITS.starter.VIDEO_DISPATCH, 30);
  assert.equal(QUOTA_LIMITS.studio.VIDEO_DISPATCH, 200);
  assert.equal(QUOTA_LIMITS.starter.DIGITAL_HUMAN_AD, 0);
  assert.equal(QUOTA_LIMITS.studio.DIGITAL_HUMAN_AD, 0);
  assert.deepEqual(QUOTA_LIMITS.free, QUOTA_LIMITS.starter);
  assert.deepEqual(QUOTA_LIMITS.pro, QUOTA_LIMITS.studio);
});

test("Phase1 用量解析以 Workspace.planId 为主，不再依赖 legacy userType 或 Stripe 是否配置", async () => {
  const source = await readFile("src/lib/services/quota-service.ts", "utf8");
  assert.match(source, /db\.workspace\.findUnique/);
  assert.match(source, /where:\s*\{ ownerId: userId \}/);
  assert.doesNotMatch(source, /isStripeConfigured/);
  assert.doesNotMatch(source, /subscriptionTier/);
});

test("Phase1 批次派发同时受 plan 并发余量约束", async () => {
  assert.equal(batchTest.remainingPlanConcurrency(10, 0), 10);
  assert.equal(batchTest.remainingPlanConcurrency(10, 9), 1);
  assert.equal(batchTest.remainingPlanConcurrency(10, 10), 0);
  assert.equal(batchTest.remainingPlanConcurrency(10, 12), 0);

  const source = await readFile("src/lib/services/batch-service.ts", "utf8");
  assert.match(source, /batchConcurrencyLimit/);
  assert.match(source, /remainingPlanConcurrency\(planLimit, activeForUser\)/);
  assert.match(source, /batchJob:\s*\{ userId: batch\.userId \}/);
});

test("Phase1 注册原子创建唯一 starter 默认 Workspace", async () => {
  const source = await readFile("src/app/api/auth/register/route.ts", "utf8");
  assert.match(source, /role:\s*"CUSTOMER"/);
  assert.match(source, /workspace:\s*\{[\s\S]*?create:/);
  assert.match(source, /planId:\s*"starter"/);
  assert.match(source, /isDefault:\s*true/);
});

test("Phase1 客户角色迁移不再借用 OPERATOR，保留 SUPER_ADMIN 并对其他异常角色 fail closed", async () => {
  const roleMigration = await readFile(
    "prisma/migrations/20260713_phase1_customer_role/migration.sql",
    "utf8",
  );
  const migration = await readFile(
    "prisma/migrations/20260713_phase1_workspace_plans/migration.sql",
    "utf8",
  );
  assert.match(roleMigration, /ADD VALUE IF NOT EXISTS 'CUSTOMER'/);
  assert.match(
    migration,
    /UPDATE "AdminUser"[\s\S]*?SET "role" = 'CUSTOMER'[\s\S]*?"userType" IN \('BUSINESS', 'PERSONAL'\)[\s\S]*?"role" = 'OPERATOR'/,
  );
  assert.match(migration, /"role" NOT IN \('OPERATOR', 'SUPER_ADMIN'\)/);
  assert.match(migration, /RAISE EXCEPTION/);
});
