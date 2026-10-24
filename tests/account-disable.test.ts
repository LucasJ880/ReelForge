import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import {
  ACCOUNT_RECHECK_TTL_MS,
  AccountDisabledError,
  __test__ as authTest,
  authOptions,
  loadAccountStatus,
  verifyActiveSession,
} from "../src/lib/auth";
import {
  AccountDisableError,
  cancellableVideoJobsWhere,
  disableAccount,
  enableAccount,
} from "../src/lib/services/account-disable-service";

/**
 * A4 5.1（bughunt #1）：后台「删除用户」改停用。
 * - DELETE 返回 405，不再 adminUser.delete（会沿级联删光客户业务数据，违反铁律 §4.2）；
 * - 停用写 disabledAt / disabledReason，同一事务取消未提交给供应商的排队任务（只改状态）；
 * - 停用账号：登录被拒；jwt 回调按 5 分钟 TTL 复核；API 守卫查库即时拒绝。
 * 全部 mock db，不连真实数据库。
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

type FakeUser = {
  id: string;
  role: "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";
  disabledAt: Date | null;
  disabledReason: string | null;
};

function installFakeTransaction(t: TestContext, users: FakeUser[]) {
  const log: Array<{ op: string; args: unknown }> = [];
  const tx = {
    adminUser: {
      findUnique: async (args: { where: { id: string } }) => {
        log.push({ op: "adminUser.findUnique", args });
        const user = users.find((candidate) => candidate.id === args.where.id);
        return user ? { ...user } : null;
      },
      updateMany: async (args: {
        where: { id: string; disabledAt: null };
        data: { disabledAt: Date; disabledReason: string };
      }) => {
        log.push({ op: "adminUser.updateMany", args });
        const user = users.find(
          (candidate) => candidate.id === args.where.id && candidate.disabledAt === null,
        );
        if (!user) return { count: 0 };
        Object.assign(user, args.data);
        return { count: 1 };
      },
      delete: async () => {
        throw new Error("停用绝不能物理删除账号");
      },
    },
    videoJob: {
      updateMany: async (args: unknown) => {
        log.push({ op: "videoJob.updateMany", args });
        return { count: 2 };
      },
    },
  };
  patch(t, db, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  });
  return log;
}

test("停用：写 disabledAt / 原因，同一事务取消未提交的排队任务，不删任何东西", async (t) => {
  const users: FakeUser[] = [
    { id: "customer-1", role: "CUSTOMER", disabledAt: null, disabledReason: null },
  ];
  const log = installFakeTransaction(t, users);
  const now = new Date("2026-10-25T09:00:00Z");

  const result = await disableAccount({
    targetUserId: "customer-1",
    actorUserId: "admin-1",
    reason: "  滥用付费生成  ",
    now,
  });

  assert.deepEqual(result, {
    userId: "customer-1",
    disabledAt: now,
    alreadyDisabled: false,
    cancelledVideoJobs: 2,
  });
  assert.equal(users[0].disabledAt, now);
  assert.equal(users[0].disabledReason, "滥用付费生成");

  const cancel = log.find((entry) => entry.op === "videoJob.updateMany")?.args as {
    where: unknown;
    data: { status: string; userSafeError: string };
  };
  assert.deepEqual(
    cancel.where,
    cancellableVideoJobsWhere({ userId: "customer-1", includeDeliveryOrders: true }),
  );
  assert.equal(cancel.data.status, "CANCELLED");
  assert.equal(cancel.data.userSafeError, "已取消");
});

test("🔴 只取消没到过供应商的任务：已提交 / 回执未知的留给对账收回素材", () => {
  const where = cancellableVideoJobsWhere({ userId: "u1", includeDeliveryOrders: true }) as {
    status: { in: string[] };
    submissionState: { in: string[] };
    externalJobId: null;
    OR: unknown[];
  };
  assert.deepEqual(where.status.in.sort(), ["PAUSED", "QUEUED"]);
  assert.deepEqual(where.submissionState.in.sort(), ["NOT_STARTED", "REJECTED"]);
  assert.equal(where.externalJobId, null);
  assert.equal(where.OR.length, 2, "客户：批量任务 + 自己下的单条订单");

  const staff = cancellableVideoJobsWhere({ userId: "op-1", includeDeliveryOrders: false }) as {
    OR: unknown[];
  };
  assert.deepEqual(staff.OR, [{ batchJob: { userId: "op-1" } }], "员工建的代运营订单属于客户，不能跟着取消");
});

test("停用内部员工：不碰其代建订单下的任务，只取消自己的批量任务", async (t) => {
  const users: FakeUser[] = [
    { id: "op-1", role: "OPERATOR", disabledAt: null, disabledReason: null },
  ];
  const log = installFakeTransaction(t, users);
  await disableAccount({ targetUserId: "op-1", actorUserId: "admin-1", reason: "离职" });
  const cancel = log.find((entry) => entry.op === "videoJob.updateMany")?.args as { where: unknown };
  assert.deepEqual(
    cancel.where,
    cancellableVideoJobsWhere({ userId: "op-1", includeDeliveryOrders: false }),
  );
});

test("重复停用：保留第一次的时间与原因（CAS），任务照样再扫一遍", async (t) => {
  const first = new Date("2026-10-01T00:00:00Z");
  const users: FakeUser[] = [
    { id: "customer-1", role: "CUSTOMER", disabledAt: first, disabledReason: "第一次" },
  ];
  const log = installFakeTransaction(t, users);
  const result = await disableAccount({
    targetUserId: "customer-1",
    actorUserId: "admin-1",
    reason: "第二次",
  });
  assert.equal(result.alreadyDisabled, true);
  assert.equal(result.disabledAt.getTime(), first.getTime());
  assert.equal(users[0].disabledReason, "第一次");
  assert.ok(log.some((entry) => entry.op === "videoJob.updateMany"));
});

test("不能停用自己；必须写原因；账号不存在给 not_found —— 都不进事务", async (t) => {
  const log = installFakeTransaction(t, []);
  await assert.rejects(
    disableAccount({ targetUserId: "admin-1", actorUserId: "admin-1", reason: "x" }),
    (err: unknown) => err instanceof AccountDisableError && err.reason === "self",
  );
  await assert.rejects(
    disableAccount({ targetUserId: "u2", actorUserId: "admin-1", reason: "   " }),
    (err: unknown) => err instanceof AccountDisableError && err.reason === "invalid_reason",
  );
  assert.equal(log.length, 0);
  await assert.rejects(
    disableAccount({ targetUserId: "ghost", actorUserId: "admin-1", reason: "x" }),
    (err: unknown) => err instanceof AccountDisableError && err.reason === "not_found",
  );
});

test("恢复：只清停用标记", async (t) => {
  const writes: unknown[] = [];
  patch(t, db.adminUser, {
    findUnique: async () => ({ id: "customer-1" }),
    updateMany: async (args: unknown) => {
      writes.push(args);
      return { count: 1 };
    },
  });
  const result = await enableAccount({ targetUserId: "customer-1" });
  assert.deepEqual(result, { userId: "customer-1", wasDisabled: true });
  assert.deepEqual(writes, [
    {
      where: { id: "customer-1", disabledAt: { not: null } },
      data: { disabledAt: null, disabledReason: null },
    },
  ]);
});

test("🔴 DELETE /api/admin/users/[id] 改为 405，路由里不再有物理删除", async () => {
  const route = await readFile("src/app/api/admin/users/[id]/route.ts", "utf8");
  assert.doesNotMatch(route, /adminUser\.delete/);
  assert.match(route, /status:\s*405/);
  const disable = await readFile("src/app/api/admin/users/[id]/disable/route.ts", "utf8");
  assert.match(disable, /requireSuperAdmin\(\)/);
  assert.match(disable, /actorUserId:\s*guard\.session\.user\.id/, "不能停用自己由 service 按会话判定");
  const row = await readFile("src/app/(internal)/internal/settings/admin-row.tsx", "utf8");
  assert.match(row, /\/disable`/);
  assert.match(row, /停用/);
  /// 行内唯一的 DELETE 只能是「解除停用」子资源，绝不是删账号
  assert.doesNotMatch(row, /\/api\/admin\/users\/\$\{user\.id\}`,\s*\{\s*method:\s*"DELETE"/);
  assert.match(row, /\/disable`, \{ method: "DELETE" \}/);
});

function credentialsAuthorize() {
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: (credentials: Record<string, string>) => Promise<unknown> };
  };
  return provider.options.authorize;
}

test("🔴 已停用账号：密码正确也登录不了（与密码错误同样返回 null）", async (t) => {
  const hashedPassword = await bcrypt.hash("correct-horse", 4);
  let disabledAt: Date | null = new Date("2026-10-25T00:00:00Z");
  patch(t, db.adminUser, {
    findUnique: async () => ({
      id: "customer-1",
      email: "merchant@shop.com",
      name: "Merchant",
      role: "CUSTOMER",
      userType: "PERSONAL",
      hashedPassword,
      disabledAt,
    }),
  });
  const authorize = credentialsAuthorize();
  assert.equal(
    await authorize({ email: "merchant@shop.com", password: "correct-horse" }),
    null,
  );
  disabledAt = null;
  const user = (await authorize({ email: "merchant@shop.com", password: "correct-horse" })) as {
    id: string;
  } | null;
  assert.equal(user?.id, "customer-1");
});

type JwtCallback = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const jwt = authOptions.callbacks!.jwt as unknown as JwtCallback;

test("🔴 jwt 回调：停用后旧会话失效（抛错 → NextAuth 判会话无效并清 cookie）", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  patch(t, db.adminUser, {
    findUnique: async () => ({
      role: "CUSTOMER",
      userType: "PERSONAL",
      disabledAt: new Date("2026-10-25T00:00:00Z"),
    }),
  });
  await assert.rejects(
    jwt({ token: { id: "customer-1", role: "CUSTOMER" } }),
    (err: unknown) => err instanceof AccountDisabledError,
  );
});

test("账号已不存在的会话同样失效", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  patch(t, db.adminUser, { findUnique: async () => null });
  await assert.rejects(
    jwt({ token: { id: "ghost" } }),
    (err: unknown) => err instanceof AccountDisabledError,
  );
});

test("jwt 回调按 5 分钟 TTL 节流查库，并把库里的新角色写回 token；update() 不吃缓存", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  let role = "OPERATOR";
  let queries = 0;
  patch(t, db.adminUser, {
    findUnique: async () => {
      queries += 1;
      return { role, userType: null, disabledAt: null };
    },
  });

  const first = await jwt({ token: { id: "staff-1", role: "SUPER_ADMIN", userType: "SUPER_ADMIN" } });
  assert.equal(first.role, "OPERATOR", "降级立即以库为准");
  assert.equal(first.userType, "OPERATOR");
  assert.equal(queries, 1);

  role = "REVIEWER";
  await jwt({ token: { id: "staff-1" } });
  assert.equal(queries, 1, "5 分钟内不重复查库");

  const refreshed = await jwt({ token: { id: "staff-1" }, trigger: "update" });
  assert.equal(queries, 2);
  assert.equal(refreshed.role, "REVIEWER");
});

test("loadAccountStatus：TTL 过期后重新查库", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  let queries = 0;
  patch(t, db.adminUser, {
    findUnique: async () => {
      queries += 1;
      return { role: "CUSTOMER", userType: "BUSINESS", disabledAt: null };
    },
  });
  const start = 1_000_000;
  await loadAccountStatus("u1", ACCOUNT_RECHECK_TTL_MS, start);
  await loadAccountStatus("u1", ACCOUNT_RECHECK_TTL_MS, start + ACCOUNT_RECHECK_TTL_MS - 1);
  assert.equal(queries, 1);
  await loadAccountStatus("u1", ACCOUNT_RECHECK_TTL_MS, start + ACCOUNT_RECHECK_TTL_MS + 1);
  assert.equal(queries, 2);
});

test("停用后本实例立即按新状态复核（不等 5 分钟缓存过期）", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  let disabledAt: Date | null = null;
  patch(t, db.adminUser, {
    findUnique: async () => ({ role: "CUSTOMER", userType: "BUSINESS", disabledAt }),
  });
  await jwt({ token: { id: "customer-1" } });

  const users: FakeUser[] = [
    { id: "customer-1", role: "CUSTOMER", disabledAt: null, disabledReason: null },
  ];
  installFakeTransaction(t, users);
  await disableAccount({ targetUserId: "customer-1", actorUserId: "admin-1", reason: "滥用" });
  disabledAt = users[0].disabledAt;

  await assert.rejects(
    jwt({ token: { id: "customer-1" } }),
    (err: unknown) => err instanceof AccountDisabledError,
  );
});

test("库抖动时 jwt 回调不把在线用户踢下线（API 守卫还会再查）", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  const originalWarn = console.warn;
  console.warn = () => undefined;
  t.after(() => {
    console.warn = originalWarn;
  });
  patch(t, db.adminUser, {
    findUnique: async () => {
      throw new Error("connection reset");
    },
  });
  const token = await jwt({ token: { id: "customer-1", role: "CUSTOMER" } });
  assert.equal(token.role, "CUSTOMER");
});

test("🔴 API 守卫的会话复核：停用即时拒绝（不吃 5 分钟窗口），角色以库为准", async (t) => {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  let row: { role: string; userType: string | null; disabledAt: Date | null } | null = {
    role: "OPERATOR",
    userType: null,
    disabledAt: null,
  };
  patch(t, db.adminUser, { findUnique: async () => row });
  const session = () =>
    ({
      user: { id: "staff-1", email: "s@shop.com", role: "SUPER_ADMIN", userType: "SUPER_ADMIN" },
      expires: "2099-01-01T00:00:00.000Z",
    }) as never;

  const active = await verifyActiveSession(session());
  assert.equal(active?.user.role, "OPERATOR", "降级在 API 层立即生效");
  assert.equal(active?.user.userType, "OPERATOR");

  /// jwt 回调刚把它缓存成「正常」也没用：API 守卫只认 2 秒内的结果
  authTest.resetAccountStatusCache();
  await jwt({ token: { id: "staff-1" } });
  row = { role: "OPERATOR", userType: null, disabledAt: new Date() };
  authTest.ageAccountStatusCache(3_000);
  assert.equal(await verifyActiveSession(session()), null, "停用后 API 守卫立刻回 401");

  row = null;
  authTest.resetAccountStatusCache();
  assert.equal(await verifyActiveSession(session()), null, "账号已不存在");
  assert.equal(await verifyActiveSession(null), null);
});

test("API 守卫（requireAuth / requireRole）走查库复核的会话，不放 middleware", async () => {
  const apiAuth = await readFile("src/lib/api-auth.ts", "utf8");
  for (const fn of ["requireAuth", "requireRole"]) {
    const start = apiAuth.indexOf(`export async function ${fn}(`);
    const block = apiAuth.slice(start, apiAuth.indexOf("\n}\n", start));
    assert.match(block, /await getActiveServerSession\(\)/, `${fn} 必须查库复核停用`);
  }
  const middleware = await readFile("src/middleware.ts", "utf8");
  assert.doesNotMatch(middleware, /disabledAt/, "middleware 跑在 edge，不查库");
});
