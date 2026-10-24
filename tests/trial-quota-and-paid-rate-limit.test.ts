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
import { createProductAnchorPostHandler } from "../src/app/api/product-anchors/route";
import { createProductAnchorRetryHandler } from "../src/app/api/product-anchors/[id]/retry/route";

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
  /// Stripe 订阅成功会把 tier 改写成 free / pro —— 试用随之结束
  const stripe = await readFile("src/lib/services/stripe-billing-service.ts", "utf8");
  assert.match(stripe, /subscriptionTier:\s*params\.tier/);
});

test("付费入口限流：默认值、环境变量覆盖与上下限", () => {
  assert.equal(paidActionHourlyLimit("content-plan", {}), PAID_ACTION_RATE_LIMITS["content-plan"].perHour);
  assert.equal(paidActionHourlyLimit("broll", { BROLL_RATE_LIMIT_PER_HOUR: "2" }), 2);
  assert.equal(paidActionHourlyLimit("broll", { BROLL_RATE_LIMIT_PER_HOUR: "0" }), 1, "不能被配成 0 把入口关死");
  assert.equal(paidActionHourlyLimit("broll", { BROLL_RATE_LIMIT_PER_HOUR: "100000" }), 200);
  assert.equal(paidActionHourlyLimit("broll", { BROLL_RATE_LIMIT_PER_HOUR: "abc" }), PAID_ACTION_RATE_LIMITS.broll.perHour);
  assert.equal(paidActionBucketKey("product-link", "u1"), "paid:product-link:user:u1");
});

test("🔴 生产强制：同一用户同一小时超过上限抛 RateLimitExceededError，并按用户分桶", async (t) => {
  withEnv(t, { QUOTA_ENFORCE: "true", PRODUCT_LINK_RATE_LIMIT_PER_HOUR: "2" });
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
  await assertPaidActionRateLimit({ action: "product-link", userId: "u1", now });
  await assertPaidActionRateLimit({ action: "product-link", userId: "u1", now });
  await assert.rejects(
    assertPaidActionRateLimit({ action: "product-link", userId: "u1", now }),
    (err: unknown) => err instanceof RateLimitExceededError && /链接抓取过于频繁/.test(err.message),
  );
  /// 另一个用户不受影响；下一个小时重新计
  await assertPaidActionRateLimit({ action: "product-link", userId: "u2", now });
  await assertPaidActionRateLimit({
    action: "product-link",
    userId: "u1",
    now: new Date("2026-10-25T11:01:00Z"),
  });
  assert.ok(buckets.has("paid:product-link:user:u1|2026-10-25T10"));
});

test("开发环境默认不强制（与产品图限流同一口径），不碰数据库", async (t) => {
  withEnv(t, { QUOTA_ENFORCE: undefined });
  patch(t, db.rateLimitBucket, {
    upsert: async () => {
      throw new Error("dev 不该写限流桶");
    },
  });
  await assertPaidActionRateLimit({ action: "content-plan", userId: "u1" });
});

test("付费入口路由都接了限流：内容计划 / 出图 / 链接抓取 / 产品锚点 / b-roll", async () => {
  const expectations: Array<[string, string]> = [
    ["src/app/api/content-plans/route.ts", "content-plan"],
    ["src/app/api/content-plans/[id]/posts/[postId]/render/route.ts", "content-post-render"],
    ["src/app/api/product-link/route.ts", "product-link"],
    ["src/app/api/product-anchors/route.ts", "product-anchor"],
    ["src/app/api/product-anchors/[id]/retry/route.ts", "product-anchor"],
    ["src/app/api/broll/dispatch/route.ts", "broll"],
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

const VALID_BOX = { x: 0.1, y: 0.2, width: 0.5, height: 0.7 };

function anchorRequest(): Request {
  return new Request("http://localhost/api/product-anchors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "roman-shade", sourceAssetId: "asset-1", logoBox: VALID_BOX }),
  });
}

test("🔴 产品锚点超限：429 RATE_LIMITED，且不调付费抠图", async () => {
  const calls: string[] = [];
  const handler = createProductAnchorPostHandler({
    requireAuth: async () => ({
      ok: true as const,
      session: { user: { id: "user-1", email: "merchant@example.test" } } as never,
    }),
    listProductAnchorsForUser: async () => [],
    resolveOwnedImageAssets: async () => [{ url: "https://assets.example.test/a.png" }] as never,
    assertPaidActionRateLimit: async () => {
      calls.push("rate-limit");
      throw new RateLimitExceededError("产品抠图操作过于频繁，请一小时后再试。");
    },
    createProductAnchor: async () => {
      calls.push("create");
      return {} as never;
    },
  });
  const response = await handler(anchorRequest() as never);
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.code, "RATE_LIMITED");
  assert.deepEqual(calls, ["rate-limit"]);
});

test("锚点续跑：READY 短路不占限流次数；未完成的才计数", async () => {
  const counted: string[] = [];
  const anchor = (status: string) =>
    ({
      id: "anchor-1",
      userId: "user-1",
      sku: "roman-shade",
      brandName: null,
      sourceImageUrl: "https://assets.example.test/source.png",
      cutoutUrl: null,
      maskUrl: null,
      logoBoxJson: VALID_BOX,
      status,
      cutoutProvider: null,
      failureReason: null,
      createdAt: new Date("2026-08-03T00:00:00Z"),
      updatedAt: new Date("2026-08-03T00:00:00Z"),
    }) as never;
  const make = (status: string) =>
    createProductAnchorRetryHandler({
      requireAuth: async () => ({
        ok: true as const,
        session: { user: { id: "user-1", email: "merchant@example.test" } } as never,
      }),
      getOwnedProductAnchor: async () => anchor(status),
      assertPaidActionRateLimit: async ({ action }) => {
        counted.push(action);
      },
      runCutout: async () => anchor("READY"),
    });
  const context = { params: Promise.resolve({ id: "anchor-1" }) };
  await make("READY")(new Request("http://localhost/x", { method: "POST" }) as never, context);
  assert.deepEqual(counted, []);
  await make("FAILED")(new Request("http://localhost/x", { method: "POST" }) as never, context);
  assert.deepEqual(counted, ["product-anchor"]);
});
