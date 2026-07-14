import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { QUOTA_LIMITS } from "../src/lib/config/quota-tiers";
import { db } from "../src/lib/db";
import {
  __test__,
  assertQuotaBatchForSession,
  QuotaExceededError,
} from "../src/lib/services/quota-service";

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

test("currentUsagePeriodKey 使用 UTC 自然月", () => {
  const key = __test__.currentUsagePeriodKey(new Date("2026-05-19T12:00:00Z"));
  assert.equal(key, "2026-05");
});

test("内部 staff session 豁免配额", () => {
  assert.equal(
    __test__.isQuotaExemptSession({
      user: {
        id: "u1",
        email: "ops@aivora.internal",
        role: "OPERATOR",
        userType: "SUPER_ADMIN",
      },
      expires: "",
    }),
    true,
  );
  assert.equal(
    __test__.isQuotaExemptSession({
      user: {
        id: "u2",
        email: "user@example.com",
        role: "OPERATOR",
        userType: "PERSONAL",
      },
      expires: "",
    }),
    false,
  );
});

test("免费档限额包含四类资源", () => {
  assert.ok(QUOTA_LIMITS.free.VIDEO_DISPATCH >= 1);
  assert.ok(QUOTA_LIMITS.free.PLAN_PREVIEW >= 1);
  assert.ok(QUOTA_LIMITS.free.BLOB_UPLOAD_BYTES >= 1024 * 1024);
  assert.ok(QUOTA_LIMITS.free.SEEDANCE_SEGMENT >= 1);
});

test("并发请求争用最后一个视频额度时只允许一个事务提交", async (t) => {
  const previousEnforce = process.env.QUOTA_ENFORCE;
  process.env.QUOTA_ENFORCE = "true";
  t.after(() => {
    if (previousEnforce === undefined) delete process.env.QUOTA_ENFORCE;
    else process.env.QUOTA_ENFORCE = previousEnforce;
  });

  const session: Session = {
    user: {
      id: "quota-race-user",
      email: "quota-race@example.test",
      role: "CUSTOMER",
      userType: "PERSONAL",
    },
    expires: "2099-01-01T00:00:00.000Z",
  };
  patch(t, db.workspace as unknown as Record<string, unknown>, {
    findUnique: async () => ({ planId: "starter" }),
  });

  const limit = QUOTA_LIMITS.starter.VIDEO_DISPATCH;
  let used = limit - 1;
  let usageLogs = 0;
  let transactionTail = Promise.resolve();
  const isolationLevels: unknown[] = [];
  const tx = {
    userUsagePeriod: {
      findUnique: async () => ({ amount: used }),
      upsert: async (args: { update: { amount: { increment: number } } }) => {
        used += args.update.amount.increment;
        return { amount: used };
      },
    },
    usageLog: {
      create: async () => {
        usageLogs += 1;
        return { id: `usage-${usageLogs}` };
      },
    },
  };
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (
      operation: (client: typeof tx) => Promise<void>,
      options?: { isolationLevel?: unknown },
    ) => {
      isolationLevels.push(options?.isolationLevel);
      const current = transactionTail.then(() => operation(tx));
      transactionTail = current.catch(() => undefined);
      return current;
    },
  });

  const results = await Promise.allSettled([
    assertQuotaBatchForSession(session, [
      { resource: "VIDEO_DISPATCH", amount: 1 },
    ]),
    assertQuotaBatchForSession(session, [
      { resource: "VIDEO_DISPATCH", amount: 1 },
    ]),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.ok(rejected?.reason instanceof QuotaExceededError);
  assert.equal(used, limit, "hard quota must never be incremented beyond its limit");
  assert.equal(usageLogs, 1, "only the committed request may write a usage ledger row");
  assert.ok(isolationLevels.length >= 2);
  assert.ok(
    isolationLevels.every(
      (level) => level === Prisma.TransactionIsolationLevel.Serializable,
    ),
  );
});
