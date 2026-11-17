import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  QUOTA_LIMITS,
  TRIAL_SUBSCRIPTION_TIER,
  quotaPlanFromWorkspace,
} from "../src/lib/config/quota-tiers";
import { resolveQuotaPlan } from "../src/lib/services/quota-service";
import {
  PAID_ACTION_RATE_LIMITS,
  assertPaidActionRateLimit,
  paidActionBucketKey,
  paidActionHourlyLimit,
} from "../src/lib/services/paid-action-rate-limit";
import { RateLimitExceededError } from "../src/lib/services/rate-limit-service";

/**
 * A4 5.2 / D5：本轮上线后自助注册的新账号进「试用」额度；付费入口按用户直接发起次数限流。
 */

function patch(t: TestContext, target: object, values: Record<string, unknown>) {
  const record = target as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = record[key];
    record[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) record[key] = value;
  });
}

function withEnv(t: TestContext, next: Record<string, string | undefined>) {
  const originals: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(next)) {
    originals[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("D5 试用档：每月 3 条视频 / 6 段画面，其余与 starter 一致", () => {
  assert.equal(QUOTA_LIMITS.trial.VIDEO_DISPATCH, 3);
  assert.equal(QUOTA_LIMITS.trial.SEEDANCE_SEGMENT, 6);
  assert.equal(QUOTA_LIMITS.trial.PLAN_PREVIEW, QUOTA_LIMITS.starter.PLAN_PREVIEW);
  assert.equal(QUOTA_LIMITS.trial.BLOB_UPLOAD_BYTES, QUOTA_LIMITS.starter.BLOB_UPLOAD_BYTES);
  assert.equal(QUOTA_LIMITS.trial.DIGITAL_HUMAN_AD, 0);
  /// 存量档位不动
  assert.equal(QUOTA_LIMITS.starter.VIDEO_DISPATCH, 30);
  assert.equal(QUOTA_LIMITS.studio.VIDEO_DISPATCH, 200);
});

test("计量档解析：studio 永远优先；starter + 试用标记 → trial；存量默认 free 标记 → starter", () => {
  assert.equal(
    quotaPlanFromWorkspace({ planId: "starter", owner: { subscriptionTier: TRIAL_SUBSCRIPTION_TIER } }),
    "trial",
  );
  assert.equal(
    quotaPlanFromWorkspace({ planId: "studio", owner: { subscriptionTier: TRIAL_SUBSCRIPTION_TIER } }),
    "studio",
    "超管给试用账号手工开 studio 要立即生效",
  );
  assert.equal(quotaPlanFromWorkspace({ planId: "starter", owner: { subscriptionTier: "free" } }), "starter");
  assert.equal(quotaPlanFromWorkspace({ planId: "starter", owner: { subscriptionTier: "pro" } }), "starter");
  assert.equal(quotaPlanFromWorkspace(null), "starter");
});

test("resolveQuotaPlan 读工作区 + 账号试用标记（mock 库，不连真实数据库）", async (t) => {
  const seen: unknown[] = [];
  patch(t, db.workspace, {
    findUnique: async (args: unknown) => {
      seen.push(args);
      return { planId: "starter", owner: { subscriptionTier: TRIAL_SUBSCRIPTION_TIER } };
    },
  });
  assert.equal(await resolveQuotaPlan("trial-user"), "trial");
  const query = seen[0] as { where: unknown; select: { owner?: unknown } };
  assert.deepEqual(query.where, { ownerId: "trial-user" });
  assert.ok(query.select.owner, "必须一起读账号的试用标记");
});

test("注册路由给新账号写试用标记，Workspace 仍是 starter（外键 / 存量不受影响）", async () => {
  const source = await readFile("src/app/api/auth/register/route.ts", "utf8");
  assert.match(source, /subscriptionTier:\s*TRIAL_SUBSCRIPTION_TIER/);
  assert.match(source, /planId:\s*"starter"/);
});

test("付费入口限流：默认值、环境变量覆盖与上下限", () => {
  assert.equal(paidActionHourlyLimit("douyin-kit-copy", {}), PAID_ACTION_RATE_LIMITS["douyin-kit-copy"].perHour);
  assert.equal(paidActionHourlyLimit("douyin-kit-copy", { DOUYIN_KIT_COPY_RATE_LIMIT_PER_HOUR: "2" }), 2);
  assert.equal(paidActionHourlyLimit("douyin-kit-copy", { DOUYIN_KIT_COPY_RATE_LIMIT_PER_HOUR: "0" }), 1, "不能被配成 0 把入口关死");
  assert.equal(paidActionHourlyLimit("douyin-kit-copy", { DOUYIN_KIT_COPY_RATE_LIMIT_PER_HOUR: "100000" }), 200);
  assert.equal(
    paidActionHourlyLimit("douyin-kit-copy", { DOUYIN_KIT_COPY_RATE_LIMIT_PER_HOUR: "abc" }),
    PAID_ACTION_RATE_LIMITS["douyin-kit-copy"].perHour,
  );
  assert.equal(paidActionBucketKey("douyin-kit-render", "u1"), "paid:douyin-kit-render:user:u1");
});

test("🔴 生产强制：同一用户同一小时超过上限抛 RateLimitExceededError，并按用户分桶", async (t) => {
  withEnv(t, { QUOTA_ENFORCE: "true", DOUYIN_KIT_RENDER_RATE_LIMIT_PER_HOUR: "2" });
  const buckets = new Map<string, number>();
  patch(t, db.rateLimitBucket, {
    upsert: async (args: { where: { bucketKey_windowKey: { bucketKey: string; windowKey: string } } }) => {
      const key = `${args.where.bucketKey_windowKey.bucketKey}|${args.where.bucketKey_windowKey.windowKey}`;
      const count = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, count);
      return { count };
    },
  });
  const now = new Date("2026-10-25T10:15:00Z");
  await assertPaidActionRateLimit({ action: "douyin-kit-render", userId: "u1", now });
  await assertPaidActionRateLimit({ action: "douyin-kit-render", userId: "u1", now });
  await assert.rejects(
    assertPaidActionRateLimit({ action: "douyin-kit-render", userId: "u1", now }),
    (err: unknown) => err instanceof RateLimitExceededError && /发布素材生成过于频繁/.test(err.message),
  );
  /// 另一个用户不受影响；下一个小时重新计
  await assertPaidActionRateLimit({ action: "douyin-kit-render", userId: "u2", now });
  await assertPaidActionRateLimit({
    action: "douyin-kit-render",
    userId: "u1",
    now: new Date("2026-10-25T11:01:00Z"),
  });
  assert.ok(buckets.has("paid:douyin-kit-render:user:u1|2026-10-25T10"));
});

test("开发环境默认不强制（与产品图限流同一口径），不碰数据库", async (t) => {
  withEnv(t, { QUOTA_ENFORCE: undefined });
  patch(t, db.rateLimitBucket, {
    upsert: async () => {
      throw new Error("dev 不该写限流桶");
    },
  });
  await assertPaidActionRateLimit({ action: "douyin-kit-copy", userId: "u1" });
});

test("付费入口路由都接了限流：抖音发布包的文案与素材（内容计划、图文出图、链接抓取、产品锚点、b-roll 的路由 2026-11-16 已删）", async () => {
  const expectations: Array<[string, string]> = [
    ["src/app/api/library/[id]/douyin-kit/route.ts", "douyin-kit-copy"],
    ["src/app/api/brand-packaging/route.ts", "douyin-kit-render"],
  ];
  for (const [file, action] of expectations) {
    const source = await readFile(file, "utf8");
    assert.match(
      source,
      new RegExp(`assertPaidActionRateLimit\\(\\{[\\s\\S]{0,80}action: "${action}"`),
      `${file} 必须按 ${action} 限流`,
    );
    assert.match(source, /rateLimitedResponse\(/, `${file} 超限要回 429 而不是 500`);
  }
});

test("限流表里不再有已删线路的入口：链接抓取、产品锚点（抠图）、实拍图库、内容计划、图文出图（2026-11-16 随线路删除）", () => {
  assert.deepEqual(Object.keys(PAID_ACTION_RATE_LIMITS).sort(), [
    "douyin-kit-copy",
    "douyin-kit-render",
  ]);
});
