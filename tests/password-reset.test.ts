import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

import { db } from "../src/lib/db";
import { middleware } from "../src/middleware";
import { getPasswordResetCopy } from "../src/i18n/password-reset-copy";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import {
  PASSWORD_BCRYPT_COST,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyViolation,
} from "../src/lib/config/password-policy";
import { passwordResetEmailMessage, sendPasswordResetEmail } from "../src/lib/services/notification-service";
import { RateLimitExceededError, hashVisitorNetwork } from "../src/lib/services/rate-limit-service";
import {
  PASSWORD_RESET_RATE_LIMIT,
  RESET_TOKEN_TTL_MS,
  buildResetLink,
  confirmPasswordReset,
  generateResetToken,
  hashResetToken,
  inspectPasswordResetToken,
  isWellFormedResetToken,
  issuePasswordReset,
  prismaPasswordResetStore,
  requestPasswordReset,
  resetTokenExpiresAt,
  resetTokenState,
  type PasswordResetDeps,
  type PasswordResetPrismaClient,
} from "../src/lib/services/password-reset-service";
import { POST as postResetRequest } from "../src/app/api/auth/password-reset/request/route";
import { POST as postResetConfirm } from "../src/app/api/auth/password-reset/confirm/route";

/**
 * 1025 整合轮 · 密码找回。全部不连库、不发信：
 * - 服务层注入内存版 Prisma（事务串行 + 抛错回滚），走的是真实的 prismaPasswordResetStore；
 * - 路由层沿用其它路由测试的做法 patch 全局 db；
 * - 整份文件把全局 fetch 换成记录器，任何路径都打不到 Resend。
 */

/* ── 全局 fetch 记录器（本测试文件在独立进程里跑，不用恢复） ────────────── */

const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls.push({ url: String(input), init: init ?? {} });
  return new Response(JSON.stringify({ id: "email-test" }), { status: 200 });
}) as typeof fetch;

/* ── 内存版 Prisma ──────────────────────────────────────────────────── */

type UserRow = { id: string; email: string; hashedPassword: string; disabledAt: Date | null };
type TokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  requestedIp: string | null;
  createdAt: Date;
};
type Where = Record<string, unknown>;

function matches(row: object, where: Where): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, condition]) => {
    const value = record[key];
    if (condition === null) return value === null;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition === "object") {
      const gt = (condition as { gt?: unknown }).gt;
      assert.ok(gt instanceof Date, `unsupported where condition on ${key}`);
      return value instanceof Date && value.getTime() > gt.getTime();
    }
    return value === condition;
  });
}

function createFakePrisma(seed: { users: UserRow[]; tokens?: TokenRow[] }) {
  const state = {
    users: seed.users.map((row) => ({ ...row })),
    tokens: (seed.tokens ?? []).map((row) => ({ ...row })),
  };
  const log: string[] = [];
  let sequence = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const forbidDelete = async () => {
    throw new Error("password reset must never physically delete rows");
  };

  const adminUser = {
    async findUnique(args: { where: Where }) {
      log.push("adminUser.findUnique");
      const row = state.users.find((user) => matches(user, args.where));
      return row ? { id: row.id, email: row.email, disabledAt: row.disabledAt } : null;
    },
    async updateMany(args: { where: Where; data: Partial<UserRow> }) {
      log.push("adminUser.updateMany");
      const rows = state.users.filter((user) => matches(user, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
    delete: forbidDelete,
    deleteMany: forbidDelete,
  };

  const passwordResetToken = {
    async findUnique(args: { where: { tokenHash: string } }) {
      log.push("passwordResetToken.findUnique");
      const row = state.tokens.find((token) => token.tokenHash === args.where.tokenHash);
      if (!row) return null;
      const owner = state.users.find((user) => user.id === row.userId);
      return {
        id: row.id,
        userId: row.userId,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        user: { disabledAt: owner?.disabledAt ?? null },
      };
    },
    async updateMany(args: { where: Where; data: Partial<TokenRow> }) {
      log.push("passwordResetToken.updateMany");
      const rows = state.tokens.filter((token) => matches(token, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
    async create(args: { data: Pick<TokenRow, "userId" | "tokenHash" | "expiresAt" | "requestedIp"> }) {
      log.push("passwordResetToken.create");
      assert.ok(
        !state.tokens.some((token) => token.tokenHash === args.data.tokenHash),
        "tokenHash must be unique",
      );
      sequence += 1;
      const row: TokenRow = { id: `tok-new-${sequence}`, usedAt: null, createdAt: new Date(), ...args.data };
      state.tokens.push(row);
      return { ...row };
    },
    delete: forbidDelete,
    deleteMany: forbidDelete,
  };

  const tx = { adminUser, passwordResetToken };

  /// 事务串行（Postgres 里第二个 UPDATE 等第一个事务的行锁，再按提交后的值重判 WHERE）；
  /// 回调抛错就恢复快照，模拟回滚。
  async function $transaction<T>(fn: (client: typeof tx) => Promise<T>): Promise<T> {
    const run = async () => {
      log.push("$transaction");
      const snapshot = {
        users: state.users.map((row) => ({ ...row })),
        tokens: state.tokens.map((row) => ({ ...row })),
      };
      try {
        return await fn(tx);
      } catch (error) {
        state.users = snapshot.users;
        state.tokens = snapshot.tokens;
        log.push("rollback");
        throw error;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  const client = { ...tx, $transaction };
  return {
    state,
    log,
    store: prismaPasswordResetStore(client as unknown as PasswordResetPrismaClient),
  };
}

/* ── 夹具 ───────────────────────────────────────────────────────────── */

const NOW = new Date("2026-10-25T16:00:00.000Z");
const MINUTE = 60 * 1000;

const CONFIGURED_ENV = {
  RESEND_API_KEY: "re_test_not_a_real_key",
  EMAIL_FROM: "Aivora <notify@aivora.test>",
  APP_BASE_URL: "https://app.aivora.test/",
  AIVORA_CONTACT_EMAIL: "help@aivora.test",
} as unknown as NodeJS.ProcessEnv;

function seedUsers(): UserRow[] {
  return [
    { id: "u-active", email: "owner@sunnyshutter.ca", hashedPassword: "old-hash", disabledAt: null },
    {
      id: "u-disabled",
      email: "gone@sunnyshutter.ca",
      hashedPassword: "old-hash",
      disabledAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    { id: "u-demo", email: "demo@aivora.app", hashedPassword: "demo-hash", disabledAt: null },
    { id: "u-test", email: "staff@aivora.test", hashedPassword: "test-hash", disabledAt: null },
  ];
}

const tokenFrom = (fill: number) => generateResetToken(() => Buffer.alloc(32, fill));
const TOKEN_A = tokenFrom(1);
const TOKEN_B = tokenFrom(2);
const TOKEN_C = tokenFrom(3);

function tokenRow(id: string, token: { tokenHash: string }, overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id,
    userId: "u-active",
    tokenHash: token.tokenHash,
    expiresAt: new Date(NOW.getTime() + 20 * MINUTE),
    usedAt: null,
    requestedIp: null,
    createdAt: new Date(NOW.getTime() - 10 * MINUTE),
    ...overrides,
  };
}

type SentEmail = { to: string; link: string; locale: string; expiresInMinutes: number };

function requestHarness(fake: ReturnType<typeof createFakePrisma>, overrides: Partial<PasswordResetDeps> = {}) {
  const rateCalls: Array<{ bucketKey: string; windowKey: string; max: number }> = [];
  const deferred: Array<() => Promise<unknown>> = [];
  const emails: SentEmail[] = [];
  const deps: PasswordResetDeps = {
    store: fake.store,
    env: CONFIGURED_ENV,
    now: () => NOW,
    rateLimit: async (bucketKey, windowKey, max) => {
      rateCalls.push({ bucketKey, windowKey, max });
    },
    defer: (task) => {
      deferred.push(task);
    },
    sendEmail: async (input) => {
      emails.push(input);
      return { sent: true };
    },
    ...overrides,
  };
  return {
    deps,
    rateCalls,
    emails,
    pending: () => deferred.length,
    flush: () => Promise.all(deferred.splice(0).map((task) => task())),
  };
}

function confirmDeps(fake: ReturnType<typeof createFakePrisma>, overrides: Partial<PasswordResetDeps> = {}) {
  const deps: PasswordResetDeps = {
    store: fake.store,
    now: () => NOW,
    hashPassword: async (password) => `hashed:${password}`,
    ...overrides,
  };
  return deps;
}

function userById(fake: ReturnType<typeof createFakePrisma>, id: string) {
  const user = fake.state.users.find((row) => row.id === id);
  assert.ok(user, `missing user ${id}`);
  return user;
}

function tokenById(fake: ReturnType<typeof createFakePrisma>, id: string) {
  const token = fake.state.tokens.find((row) => row.id === id);
  assert.ok(token, `missing token ${id}`);
  return token;
}

/* ── 纯函数：令牌、过期、链接、密码规则 ─────────────────────────────── */

test("令牌：32 字节随机数的 base64url（43 位），库里存的是它的 sha256 十六进制", () => {
  let requested = 0;
  const fixed = generateResetToken((size) => {
    requested = size;
    return Buffer.alloc(size, 7);
  });
  assert.equal(requested, 32);
  assert.equal(fixed.token, Buffer.alloc(32, 7).toString("base64url"));
  assert.equal(fixed.token.length, 43);
  assert.equal(fixed.tokenHash, createHash("sha256").update(fixed.token).digest("hex"));
  assert.match(fixed.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(hashResetToken(fixed.token), fixed.tokenHash, "deterministic");

  const first = generateResetToken();
  const second = generateResetToken();
  assert.notEqual(first.token, second.token);
  assert.ok(isWellFormedResetToken(first.token));
  assert.notEqual(first.tokenHash, first.token, "the stored value is never the token itself");
});

test("令牌格式：只认 43 位 base64url", () => {
  assert.equal(isWellFormedResetToken(TOKEN_A.token), true);
  for (const bad of ["", "abc", `${TOKEN_A.token}x`, TOKEN_A.token.slice(1), `${TOKEN_A.token.slice(0, 42)}=`, `${TOKEN_A.token.slice(0, 42)}/`, null, undefined, 42]) {
    assert.equal(isWellFormedResetToken(bad), false, String(bad));
  }
});

test("有效期 30 分钟；到点即失效；用过 / 账号停用 / 不存在都不能用", () => {
  assert.equal(resetTokenExpiresAt(NOW).getTime() - NOW.getTime(), 30 * MINUTE);
  assert.equal(RESET_TOKEN_TTL_MS, 30 * MINUTE);
  const record = { id: "t", userId: "u", expiresAt: new Date(NOW.getTime() + MINUTE), usedAt: null, userDisabledAt: null };
  assert.equal(resetTokenState(record, NOW), "valid");
  assert.equal(resetTokenState({ ...record, expiresAt: NOW }, NOW), "invalid", "expiry instant is already invalid");
  assert.equal(resetTokenState({ ...record, expiresAt: new Date(NOW.getTime() - 1) }, NOW), "invalid");
  assert.equal(resetTokenState({ ...record, usedAt: NOW }, NOW), "invalid");
  assert.equal(resetTokenState({ ...record, userDisabledAt: NOW }, NOW), "invalid");
  assert.equal(resetTokenState(null, NOW), "invalid");
});

test("重置链接：站点根地址去掉末尾斜杠，令牌做 URL 编码", () => {
  assert.equal(
    buildResetLink("https://app.aivora.test//", TOKEN_A.token),
    `https://app.aivora.test/reset-password?token=${TOKEN_A.token}`,
  );
  assert.equal(buildResetLink("https://x.test", "a+b/c"), "https://x.test/reset-password?token=a%2Bb%2Fc");
});

test("密码规则 8–128 位、bcrypt 12 轮，与注册路由的写死值一致（防两边漂移）", () => {
  assert.equal(passwordPolicyViolation("x".repeat(PASSWORD_MIN_LENGTH - 1)), "too_short");
  assert.equal(passwordPolicyViolation("x".repeat(PASSWORD_MIN_LENGTH)), null);
  assert.equal(passwordPolicyViolation("x".repeat(PASSWORD_MAX_LENGTH)), null);
  assert.equal(passwordPolicyViolation("x".repeat(PASSWORD_MAX_LENGTH + 1)), "too_long");
  const register = readFileSync("src/app/api/auth/register/route.ts", "utf8");
  assert.match(register, new RegExp(`\\.min\\(${PASSWORD_MIN_LENGTH},`));
  assert.match(register, new RegExp(`\\.max\\(${PASSWORD_MAX_LENGTH},`));
  assert.match(register, new RegExp(`bcrypt\\.hash\\(password, ${PASSWORD_BCRYPT_COST}\\)`));
});

/* ── 申请：永不透露账号是否存在 ─────────────────────────────────────── */

test("申请：注册过 / 没注册 / 已停用 / 演示 / 测试域名，响应一模一样；响应之前不查账号", async () => {
  const fake = createFakePrisma({ users: seedUsers() });
  const harness = requestHarness(fake);
  const emails = [
    " Owner@SunnyShutter.ca ",
    "nobody@sunnyshutter.ca",
    "gone@sunnyshutter.ca",
    "demo@aivora.app",
    "staff@aivora.test",
  ];
  const responses = [];
  for (const email of emails) {
    responses.push(await requestPasswordReset({ email, ip: "203.0.113.9", locale: "zh-CN" }, harness.deps));
  }
  for (const response of responses) assert.deepEqual(response, { delivery: "email" });
  assert.equal(new Set(responses.map((response) => JSON.stringify(response))).size, 1);
  assert.deepEqual(fake.log, [], "no account lookup, token write or email before the response");
  assert.equal(harness.emails.length, 0);
  assert.equal(harness.rateCalls.length, emails.length * 3, "every request is counted the same way");
  assert.equal(harness.pending(), emails.length, "every request defers exactly one task");

  /// 响应之后：只有正常账号拿到令牌与邮件；停用 / 演示 / 测试域名 / 不存在一律跳过
  assert.deepEqual(await harness.flush(), ["sent", "skipped", "skipped", "skipped", "skipped"]);
  assert.equal(harness.emails.length, 1);
  assert.equal(harness.emails[0]?.to, "owner@sunnyshutter.ca");
  assert.deepEqual(
    fake.state.tokens.map((token) => token.userId),
    ["u-active"],
  );
});

test("限流：网段每小时 + 邮箱每小时 / 每天三个桶；桶键是单向哈希，不含原始 IP 与邮箱", async () => {
  const fake = createFakePrisma({ users: seedUsers() });
  const first = requestHarness(fake);
  await requestPasswordReset({ email: "Owner@SunnyShutter.ca", ip: "203.0.113.9", locale: "en-US" }, first.deps);
  const [network, hourly, daily] = first.rateCalls;
  assert.ok(network && hourly && daily);
  assert.deepEqual(network, {
    bucketKey: `password-reset:net:${hashVisitorNetwork("203.0.113.9")}`,
    windowKey: "2026-10-25T16",
    max: PASSWORD_RESET_RATE_LIMIT.perNetworkPerHour,
  });
  assert.match(hourly.bucketKey, /^password-reset:email-hour:[0-9a-f]{32}$/);
  assert.equal(hourly.windowKey, "2026-10-25T16");
  assert.equal(hourly.max, PASSWORD_RESET_RATE_LIMIT.perEmailPerHour);
  assert.match(daily.bucketKey, /^password-reset:email-day:[0-9a-f]{32}$/);
  assert.equal(daily.windowKey, "2026-10-25");
  assert.equal(daily.max, PASSWORD_RESET_RATE_LIMIT.perEmailPerDay);
  for (const call of first.rateCalls) assert.doesNotMatch(call.bucketKey, /203\.0\.113|owner|sunnyshutter/i);

  /// 同一 /24 网段换地址、邮箱换大小写：仍落在同一组桶里
  const second = requestHarness(fake);
  await requestPasswordReset({ email: " owner@sunnyshutter.ca", ip: "203.0.113.200", locale: "en-US" }, second.deps);
  assert.deepEqual(
    second.rateCalls.map((call) => call.bucketKey),
    first.rateCalls.map((call) => call.bucketKey),
  );
});

test("超限：存在与不存在的邮箱都抛 RateLimitExceededError，不查账号、不排后续任务", async () => {
  for (const email of ["owner@sunnyshutter.ca", "nobody@sunnyshutter.ca"]) {
    const fake = createFakePrisma({ users: seedUsers() });
    const harness = requestHarness(fake, {
      rateLimit: async (bucketKey) => {
        if (bucketKey.includes(":email-day:")) throw new RateLimitExceededError("申请太频繁了，请稍后再试");
      },
    });
    await assert.rejects(
      requestPasswordReset({ email, ip: "198.51.100.1", locale: "zh-CN" }, harness.deps),
      RateLimitExceededError,
    );
    assert.equal(harness.pending(), 0);
    assert.deepEqual(fake.log, []);
  }
});

test("发信没开通（缺 key / 发件人 / 站点根地址）：一律 unavailable，不计数、不查账号", async () => {
  const fake = createFakePrisma({ users: seedUsers() });
  const harness = requestHarness(fake);
  const variants = [
    { ...CONFIGURED_ENV, RESEND_API_KEY: "" },
    { ...CONFIGURED_ENV, EMAIL_FROM: undefined },
    { RESEND_API_KEY: "re_test_not_a_real_key", EMAIL_FROM: "Aivora <notify@aivora.test>" },
  ] as unknown as NodeJS.ProcessEnv[];
  for (const env of variants) {
    for (const email of ["owner@sunnyshutter.ca", "nobody@sunnyshutter.ca", "gone@sunnyshutter.ca"]) {
      assert.deepEqual(
        await requestPasswordReset({ email, ip: "203.0.113.9", locale: "zh-CN" }, { ...harness.deps, env }),
        { delivery: "unavailable" },
      );
    }
  }
  assert.equal(harness.rateCalls.length, 0);
  assert.equal(harness.pending(), 0);
  assert.deepEqual(fake.log, []);
});

test("发链接：旧的未用链接写 usedAt 作废（不删行），库里只有 sha256，30 分钟有效，来源只存网段哈希", async () => {
  const fake = createFakePrisma({
    users: seedUsers(),
    tokens: [
      tokenRow("tok-old", TOKEN_A),
      tokenRow("tok-used", TOKEN_B, { usedAt: new Date("2026-10-20T00:00:00.000Z") }),
      tokenRow("tok-other-user", TOKEN_C, { userId: "u-demo" }),
    ],
  });
  const harness = requestHarness(fake);
  await requestPasswordReset({ email: "owner@sunnyshutter.ca", ip: "203.0.113.9", locale: "en-US" }, harness.deps);
  assert.deepEqual(await harness.flush(), ["sent"]);

  assert.equal(fake.state.tokens.length, 4, "one row added, none deleted");
  assert.equal(tokenById(fake, "tok-old").usedAt?.getTime(), NOW.getTime(), "previous unused link superseded");
  assert.equal(tokenById(fake, "tok-used").usedAt?.toISOString(), "2026-10-20T00:00:00.000Z", "already-used link untouched");
  assert.equal(tokenById(fake, "tok-other-user").usedAt, null, "other users' links untouched");
  assert.equal(fake.log.filter((entry) => entry === "$transaction").length, 1, "supersede + create share one transaction");

  const fresh = fake.state.tokens.find((token) => token.id.startsWith("tok-new"));
  assert.ok(fresh);
  const sent = harness.emails[0];
  assert.ok(sent);
  const link = new URL(sent.link);
  assert.equal(`${link.origin}${link.pathname}`, "https://app.aivora.test/reset-password");
  const token = link.searchParams.get("token") ?? "";
  assert.ok(isWellFormedResetToken(token));
  assert.equal(fresh.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(fake.state).includes(token), "the plaintext token is never stored");
  assert.equal(fresh.expiresAt.getTime() - NOW.getTime(), 30 * MINUTE);
  assert.equal(fresh.usedAt, null);
  assert.equal(fresh.requestedIp, hashVisitorNetwork("203.0.113.9"));
  assert.equal(sent.locale, "en-US");
  assert.equal(sent.expiresInMinutes, 30);
});

test("响应之后那一半绝不抛：查库失败 / 发信失败都只回 send_failed", async () => {
  const fake = createFakePrisma({ users: seedUsers() });
  const broken = {
    ...fake.store,
    findAccountByEmail: async () => {
      throw new Error("db down");
    },
  };
  const input = { email: "owner@sunnyshutter.ca", ip: null, locale: "zh-CN" as const, now: NOW, baseUrl: "https://app.aivora.test" };
  assert.equal(await issuePasswordReset(input, { store: broken }), "send_failed");
  assert.equal(
    await issuePasswordReset(input, { store: fake.store, sendEmail: async () => ({ sent: false, reason: "send_failed" }) }),
    "send_failed",
  );
  assert.equal(fake.state.tokens[0]?.requestedIp, null, "unknown IP is stored as null, not as a hash of 'unknown'");
});

/* ── 确认：校验、CAS、只能用一次 ───────────────────────────────────── */

test("确认：密码不合规先拒（不碰库）；令牌格式不对不碰库；令牌不存在 → invalid_or_expired", async () => {
  const fake = createFakePrisma({ users: seedUsers() });
  const deps = confirmDeps(fake);
  assert.deepEqual(await confirmPasswordReset({ token: TOKEN_A.token, password: "short" }, deps), {
    ok: false,
    reason: "weak_password",
  });
  assert.deepEqual(await confirmPasswordReset({ token: TOKEN_A.token, password: "x".repeat(129) }, deps), {
    ok: false,
    reason: "weak_password",
  });
  assert.deepEqual(await confirmPasswordReset({ token: "not-a-token", password: "new-password-1" }, deps), {
    ok: false,
    reason: "invalid_or_expired",
  });
  assert.deepEqual(fake.log, []);
  assert.deepEqual(await confirmPasswordReset({ token: TOKEN_A.token, password: "new-password-1" }, deps), {
    ok: false,
    reason: "invalid_or_expired",
  });
  assert.deepEqual(fake.log, ["passwordResetToken.findUnique"]);
});

test("确认：过期 / 已用 / 账号停用 → invalid_or_expired，密码不变、不进事务", async () => {
  const fake = createFakePrisma({
    users: seedUsers(),
    tokens: [
      tokenRow("tok-expired", TOKEN_A, { expiresAt: new Date(NOW.getTime() - 1) }),
      tokenRow("tok-used", TOKEN_B, { usedAt: new Date(NOW.getTime() - MINUTE) }),
      tokenRow("tok-disabled", TOKEN_C, { userId: "u-disabled" }),
    ],
  });
  for (const token of [TOKEN_A, TOKEN_B, TOKEN_C]) {
    assert.deepEqual(await confirmPasswordReset({ token: token.token, password: "new-password-1" }, confirmDeps(fake)), {
      ok: false,
      reason: "invalid_or_expired",
    });
  }
  assert.equal(userById(fake, "u-active").hashedPassword, "old-hash");
  assert.equal(userById(fake, "u-disabled").hashedPassword, "old-hash");
  assert.ok(!fake.log.includes("$transaction"));
});

test("确认成功：写新密码、令牌用掉、同一用户其余未用链接作废；同一链接第二次用不了", async () => {
  const fake = createFakePrisma({
    users: seedUsers(),
    tokens: [tokenRow("tok-a", TOKEN_A), tokenRow("tok-b", TOKEN_B), tokenRow("tok-c", TOKEN_C, { userId: "u-demo" })],
  });
  assert.deepEqual(await confirmPasswordReset({ token: TOKEN_A.token, password: "new-password-1" }, confirmDeps(fake)), {
    ok: true,
  });
  assert.equal(userById(fake, "u-active").hashedPassword, "hashed:new-password-1");
  assert.equal(tokenById(fake, "tok-a").usedAt?.getTime(), NOW.getTime());
  assert.equal(tokenById(fake, "tok-b").usedAt?.getTime(), NOW.getTime(), "sibling link superseded");
  assert.equal(tokenById(fake, "tok-c").usedAt, null, "other users untouched");
  assert.equal(fake.state.tokens.length, 3, "nothing deleted");

  assert.deepEqual(await confirmPasswordReset({ token: TOKEN_A.token, password: "another-password" }, confirmDeps(fake)), {
    ok: false,
    reason: "invalid_or_expired",
  });
  assert.deepEqual(await confirmPasswordReset({ token: TOKEN_B.token, password: "another-password" }, confirmDeps(fake)), {
    ok: false,
    reason: "invalid_or_expired",
  });
  assert.equal(userById(fake, "u-active").hashedPassword, "hashed:new-password-1");
});

test("CAS：同一链接并发提交两次，只有一次成功，密码只写一次", async () => {
  const fake = createFakePrisma({ users: seedUsers(), tokens: [tokenRow("tok-a", TOKEN_A)] });
  let hashes = 0;
  const deps = confirmDeps(fake, {
    /// 模拟 bcrypt 的耗时：两个请求都先通过只读校验，再一起去抢令牌
    hashPassword: async (password) => {
      hashes += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return `hashed:${password}`;
    },
  });
  const results = await Promise.all([
    confirmPasswordReset({ token: TOKEN_A.token, password: "first-password" }, deps),
    confirmPasswordReset({ token: TOKEN_A.token, password: "second-password" }, deps),
  ]);
  assert.equal(hashes, 2, "both requests passed the read-only check");
  assert.deepEqual(
    results.map((result) => result.ok).sort(),
    [false, true],
  );
  assert.deepEqual(results.find((result) => !result.ok), { ok: false, reason: "invalid_or_expired" });
  assert.equal(userById(fake, "u-active").hashedPassword, "hashed:first-password");
  assert.equal(fake.log.filter((entry) => entry === "adminUser.updateMany").length, 1, "the loser never writes a password");
  assert.ok(fake.log.includes("rollback"));
});

test("CAS 带过期条件：哈希期间链接刚好过期 → 整笔回滚，密码不变、令牌仍未用", async () => {
  const fake = createFakePrisma({
    users: seedUsers(),
    tokens: [tokenRow("tok-a", TOKEN_A, { expiresAt: new Date(NOW.getTime() + 1000) })],
  });
  const clock = [NOW, new Date(NOW.getTime() + 2000)];
  const result = await confirmPasswordReset(
    { token: TOKEN_A.token, password: "new-password-1" },
    confirmDeps(fake, { now: () => clock.shift() ?? new Date(NOW.getTime() + 2000) }),
  );
  assert.deepEqual(result, { ok: false, reason: "invalid_or_expired" });
  assert.equal(userById(fake, "u-active").hashedPassword, "old-hash");
  assert.equal(tokenById(fake, "tok-a").usedAt, null);
  assert.ok(fake.log.includes("rollback"));
});

test("校验之后账号被停用：不写密码，令牌回滚为未用", async () => {
  const fake = createFakePrisma({ users: seedUsers(), tokens: [tokenRow("tok-a", TOKEN_A)] });
  const result = await confirmPasswordReset(
    { token: TOKEN_A.token, password: "new-password-1" },
    confirmDeps(fake, {
      hashPassword: async (password) => {
        userById(fake, "u-active").disabledAt = NOW;
        return `hashed:${password}`;
      },
    }),
  );
  assert.deepEqual(result, { ok: false, reason: "invalid_or_expired" });
  assert.equal(userById(fake, "u-active").hashedPassword, "old-hash");
  assert.equal(tokenById(fake, "tok-a").usedAt, null, "token claim rolled back together with the failed password write");
});

test("默认用 bcrypt 12 轮写新密码（与注册同一口径）", async () => {
  const fake = createFakePrisma({ users: seedUsers(), tokens: [tokenRow("tok-a", TOKEN_A)] });
  const result = await confirmPasswordReset(
    { token: TOKEN_A.token, password: "brand-new-password" },
    { store: fake.store, now: () => NOW },
  );
  assert.deepEqual(result, { ok: true });
  const stored = userById(fake, "u-active").hashedPassword;
  assert.equal(bcrypt.getRounds(stored), 12);
  assert.equal(await bcrypt.compare("brand-new-password", stored), true);
});

test("重置页预检：只读，不消费令牌；格式不对不碰库", async () => {
  const fake = createFakePrisma({
    users: seedUsers(),
    tokens: [tokenRow("tok-a", TOKEN_A), tokenRow("tok-expired", TOKEN_B, { expiresAt: NOW })],
  });
  const deps = { store: fake.store, now: () => NOW };
  assert.equal(await inspectPasswordResetToken(null, deps), "invalid");
  assert.equal(await inspectPasswordResetToken("garbage", deps), "invalid");
  assert.deepEqual(fake.log, []);
  assert.equal(await inspectPasswordResetToken(TOKEN_A.token, deps), "valid");
  assert.equal(await inspectPasswordResetToken(TOKEN_A.token, deps), "valid", "inspecting twice does not consume it");
  assert.equal(await inspectPasswordResetToken(TOKEN_B.token, deps), "invalid");
  assert.equal(tokenById(fake, "tok-a").usedAt, null);
  assert.ok(fake.log.every((entry) => entry === "passwordResetToken.findUnique"));
});

/* ── 路由：稳定错误码；申请的响应不随账号变化 ───────────────────────── */

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

function setEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const NO_EMAIL_ENV = {
  RESEND_API_KEY: undefined,
  EMAIL_FROM: undefined,
  APP_BASE_URL: undefined,
  NEXT_PUBLIC_APP_URL: undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined,
};

const EMAIL_ENV = {
  ...NO_EMAIL_ENV,
  RESEND_API_KEY: "re_test_not_a_real_key",
  EMAIL_FROM: "Aivora <notify@aivora.test>",
  APP_BASE_URL: "https://app.aivora.test",
};

function forbidDb(t: TestContext) {
  const boom = async () => {
    throw new Error("this request must not touch the database");
  };
  patch(t, db.rateLimitBucket, { upsert: boom });
  patch(t, db.adminUser, { findUnique: boom, updateMany: boom });
  patch(t, db.passwordResetToken, { findUnique: boom, updateMany: boom, create: boom });
  patch(t, db, { $transaction: boom });
}

const REQUEST_URL = "https://aivora.test/api/auth/password-reset/request";
const CONFIRM_URL = "https://aivora.test/api/auth/password-reset/confirm";

function jsonPost(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function settle(rounds = 10) {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("申请路由：请求体坏 / 邮箱无效 / 语言不认识 → 400 + 稳定 code，不碰库", async (t) => {
  forbidDb(t);
  const garbage = await postResetRequest(jsonPost(REQUEST_URL, "{nope"));
  assert.equal(garbage.status, 400);
  assert.deepEqual(await garbage.json(), { ok: false, code: "INVALID_INPUT", error: "请求格式错误" });

  const badEmail = await postResetRequest(jsonPost(REQUEST_URL, { email: "not-an-email" }));
  assert.equal(badEmail.status, 400);
  assert.equal((await badEmail.json()).code, "INVALID_EMAIL");

  const badLocale = await postResetRequest(jsonPost(REQUEST_URL, { email: "a@b.co", locale: "fr-FR" }));
  assert.equal(badLocale.status, 400);
  assert.equal((await badLocale.json()).code, "INVALID_INPUT");

  const huge = await postResetRequest(jsonPost(REQUEST_URL, { email: "a@b.co", pad: "x".repeat(9000) }));
  assert.equal(huge.status, 400, "oversized bodies are rejected before parsing");
});

test("申请路由：发信没开通 → 200 delivery=unavailable，注册过与没注册一样，不碰库", async (t) => {
  setEnv(t, NO_EMAIL_ENV);
  forbidDb(t);
  for (const email of ["owner@sunnyshutter.ca", "nobody@sunnyshutter.ca"]) {
    const response = await postResetRequest(jsonPost(REQUEST_URL, { email, locale: "zh-CN" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, delivery: "unavailable" });
  }
});

test("申请路由：注册过 / 没注册 / 已停用 → 同样的 200；只有注册过的邮箱在响应之后收到信", async (t) => {
  setEnv(t, EMAIL_ENV);
  fetchCalls.length = 0;
  const accounts = new Map([
    ["owner@sunnyshutter.ca", { id: "u-active", email: "owner@sunnyshutter.ca", disabledAt: null }],
    ["gone@sunnyshutter.ca", { id: "u-disabled", email: "gone@sunnyshutter.ca", disabledAt: NOW }],
  ]);
  const created: Array<{ userId: string; tokenHash: string; expiresAt: Date; requestedIp: string | null }> = [];
  patch(t, db.rateLimitBucket, { upsert: async () => ({ count: 1 }) });
  patch(t, db.adminUser, {
    findUnique: async (args: { where: { email: string } }) => accounts.get(args.where.email) ?? null,
  });
  patch(t, db, {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        passwordResetToken: {
          updateMany: async () => ({ count: 0 }),
          create: async (args: { data: { userId: string; tokenHash: string; expiresAt: Date; requestedIp: string | null } }) => {
            created.push(args.data);
            return args.data;
          },
        },
      }),
  });

  const observed = [];
  const startedAt = Date.now();
  for (const email of ["owner@sunnyshutter.ca", "nobody@sunnyshutter.ca", "gone@sunnyshutter.ca"]) {
    const response = await postResetRequest(jsonPost(REQUEST_URL, { email, locale: "en-US" }));
    observed.push({ status: response.status, body: await response.json() });
  }
  for (const entry of observed) assert.deepEqual(entry, { status: 200, body: { ok: true, delivery: "email" } });

  await settle();
  assert.equal(fetchCalls.length, 1, "exactly one email, for the active account");
  const call = fetchCalls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.resend.com/emails");
  const payload = JSON.parse(String(call.init.body)) as { to: string[]; subject: string; text: string };
  assert.deepEqual(payload.to, ["owner@sunnyshutter.ca"]);
  assert.equal(payload.subject, "Reset your Aivora password / 重置你的 Aivora 密码");
  const token = /reset-password\?token=([A-Za-z0-9_-]{43})/.exec(payload.text)?.[1];
  assert.ok(token, "the email carries the reset link");
  assert.ok(payload.text.includes(`https://app.aivora.test/reset-password?token=${token}`));

  assert.equal(created.length, 1, "only the active account gets a token row");
  const row = created[0];
  assert.ok(row);
  assert.equal(row.userId, "u-active");
  assert.equal(row.tokenHash, hashResetToken(token), "the row stores the sha256 of the emailed token");
  assert.equal(row.requestedIp, hashVisitorNetwork("203.0.113.9"));
  const ttl = row.expiresAt.getTime() - startedAt;
  assert.ok(ttl >= 30 * MINUTE - 5000 && ttl <= 30 * MINUTE + 5000, `expires ~30 minutes out (got ${ttl}ms)`);
});

test("申请路由：超限 → 429 RATE_LIMITED + Retry-After，存在与不存在的邮箱一样", async (t) => {
  setEnv(t, EMAIL_ENV);
  forbidDb(t);
  patch(t, db.rateLimitBucket, { upsert: async () => ({ count: 999 }) });
  for (const email of ["owner@sunnyshutter.ca", "nobody@sunnyshutter.ca"]) {
    const response = await postResetRequest(jsonPost(REQUEST_URL, { email }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "3600");
    assert.deepEqual(await response.json(), { ok: false, code: "RATE_LIMITED", error: "申请太频繁了，请稍后再试" });
  }
});

test("确认路由：INVALID_INPUT / WEAK_PASSWORD / 令牌格式不对 → 400 + 稳定 code，不碰库", async (t) => {
  forbidDb(t);
  const cases: Array<[unknown, string]> = [
    ["{nope", "INVALID_INPUT"],
    [{ token: 1, password: "long-enough-1" }, "INVALID_INPUT"],
    [{ token: TOKEN_A.token }, "INVALID_INPUT"],
    [{ token: TOKEN_A.token, password: "short" }, "WEAK_PASSWORD"],
    [{ token: TOKEN_A.token, password: "x".repeat(129) }, "WEAK_PASSWORD"],
    [{ token: "garbage", password: "long-enough-1" }, "INVALID_OR_EXPIRED"],
  ];
  for (const [body, code] of cases) {
    const response = await postResetConfirm(jsonPost(CONFIRM_URL, body));
    assert.equal(response.status, 400, JSON.stringify(body));
    const json = (await response.json()) as { ok: boolean; code: string; error: string };
    assert.equal(json.ok, false);
    assert.equal(json.code, code, JSON.stringify(body));
    assert.ok(json.error.length > 0);
  }
});

test("确认路由：令牌不存在 → INVALID_OR_EXPIRED；有效令牌 → 200，事务里先 CAS 占令牌再写 bcrypt 12 轮密码", async (t) => {
  const txLog: Array<{ op: string; where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patch(t, db.passwordResetToken, {
    findUnique: async (args: { where: { tokenHash: string } }) =>
      args.where.tokenHash === TOKEN_A.tokenHash
        ? {
            id: "tok-a",
            userId: "u-active",
            expiresAt: new Date(Date.now() + 10 * MINUTE),
            usedAt: null,
            user: { disabledAt: null },
          }
        : null,
  });
  const record = (op: string) => async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    txLog.push({ op, where: args.where, data: args.data });
    return { count: 1 };
  };
  patch(t, db, {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        passwordResetToken: { updateMany: record("passwordResetToken.updateMany") },
        adminUser: { updateMany: record("adminUser.updateMany") },
      }),
  });

  const unknown = await postResetConfirm(jsonPost(CONFIRM_URL, { token: TOKEN_B.token, password: "long-enough-1" }));
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).code, "INVALID_OR_EXPIRED");
  assert.equal(txLog.length, 0);

  const ok = await postResetConfirm(jsonPost(CONFIRM_URL, { token: TOKEN_A.token, password: "long-enough-1" }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  assert.deepEqual(
    txLog.map((entry) => entry.op),
    ["passwordResetToken.updateMany", "adminUser.updateMany", "passwordResetToken.updateMany"],
  );
  const [claim, write, supersede] = txLog;
  assert.ok(claim && write && supersede);
  assert.equal(claim.where.id, "tok-a");
  assert.equal(claim.where.usedAt, null, "CAS on usedAt: null");
  assert.ok((claim.where.expiresAt as { gt?: unknown }).gt instanceof Date, "CAS also requires expiresAt > now");
  assert.deepEqual(write.where, { id: "u-active", disabledAt: null });
  const hashed = String(write.data.hashedPassword);
  assert.equal(bcrypt.getRounds(hashed), 12);
  assert.equal(await bcrypt.compare("long-enough-1", hashed), true);
  assert.deepEqual(supersede.where, { userId: "u-active", usedAt: null });
});

/* ── middleware：两页两接口不需要登录 ───────────────────────────────── */

test("middleware：/forgot-password、/reset-password 与两个接口匿名可达；前缀不误放", async (t) => {
  setEnv(t, { AUTH_SECRET: "password-reset-middleware-secret", NEXTAUTH_URL: "https://contract.aivora.test" });
  const origin = "https://contract.aivora.test";
  const allowed: Array<[string, string]> = [
    ["GET", "/forgot-password"],
    ["GET", "/reset-password"],
    ["GET", `/reset-password?token=${TOKEN_A.token}`],
    ["POST", "/api/auth/password-reset/request"],
    ["POST", "/api/auth/password-reset/confirm"],
  ];
  for (const [method, path] of allowed) {
    const response = await middleware(new NextRequest(`${origin}${path}`, { method }));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
  }
  for (const path of ["/forgot-password-evil", "/reset-passwordx", "/app/create"]) {
    const response = await middleware(new NextRequest(`${origin}${path}`));
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get("location") ?? "").pathname, "/login", path);
  }
});

/* ── 文案与邮件 ─────────────────────────────────────────────────────── */

const CJK = /[㐀-鿿！-｠　-〿]/;

function keyShape(value: unknown): unknown {
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, keyShape(inner)]));
  }
  return typeof value;
}

function entries(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => entries(inner, `${path}.${key}`));
  }
  return [];
}

const placeholders = (text: string) => [...text.matchAll(/\{[a-z]+\}/g)].map((match) => match[0]).sort();

test("文案：中英结构一致、全部非空、英文无中文；占位符两种语言逐条对得上", () => {
  const zh = getPasswordResetCopy("zh-CN");
  const en = getPasswordResetCopy("en-US");
  assert.deepEqual(keyShape(en), keyShape(zh));
  const zhEntries = new Map(entries(zh));
  for (const [path, text] of entries(en)) {
    assert.ok(text.trim().length > 0, `en${path} is empty`);
    assert.doesNotMatch(text, CJK, `en${path}: ${text}`);
    const zhText = zhEntries.get(path) ?? "";
    assert.ok(zhText.trim().length > 0, `zh${path} is empty`);
    assert.deepEqual(placeholders(text), placeholders(zhText), `placeholders differ at ${path}`);
  }
  assert.deepEqual(placeholders(en.email.help), ["{contact}"]);
  assert.deepEqual(placeholders(en.forgot.sent), ["{minutes}"]);

  const zhAuth = getPlatformCopy("zh-CN").auth;
  const enAuth = getPlatformCopy("en-US").auth;
  assert.equal(zhAuth.forgotPassword, "忘记密码？");
  assert.equal(enAuth.forgotPassword, "Forgot password?");
  for (const text of [enAuth.forgotPassword, enAuth.passwordResetDone]) assert.doesNotMatch(text, CJK);
  assert.ok(zhAuth.passwordResetDone.length > 0);
});

test("申请页的回执是中性的：不说「没找到账号」，也不说「已发送到你的邮箱」", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const forgot = getPasswordResetCopy(locale).forgot;
    const neutral = `${forgot.sent}${forgot.sentHint}`;
    assert.doesNotMatch(neutral, /不存在|没有找到|未注册|not found|no account|doesn't exist|does not exist/i);
  }
  assert.match(getPasswordResetCopy("en-US").forgot.sent, /^If that email has an Aivora account/);
  assert.match(getPasswordResetCopy("zh-CN").forgot.sent, /^如果这个邮箱注册过 Aivora/);
});

test("重置邮件：中英双语、两段都带链接、按申请时的语言排序、主题没有换行", () => {
  const link = `https://app.aivora.test/reset-password?token=${TOKEN_A.token}`;
  const en = passwordResetEmailMessage({ link, locale: "en-US", expiresInMinutes: 30, contact: "help@aivora.test" });
  const zh = passwordResetEmailMessage({ link, locale: "zh-CN", expiresInMinutes: 30, contact: "help@aivora.test" });
  const enIntro = getPasswordResetCopy("en-US").email.intro;
  const zhIntro = getPasswordResetCopy("zh-CN").email.intro;

  assert.equal(en.subject, "Reset your Aivora password / 重置你的 Aivora 密码");
  assert.equal(zh.subject, "重置你的 Aivora 密码 / Reset your Aivora password");
  assert.doesNotMatch(en.subject + zh.subject, /[\r\n]/);
  assert.ok(en.text.indexOf(enIntro) < en.text.indexOf(zhIntro));
  assert.ok(zh.text.indexOf(zhIntro) < zh.text.indexOf(enIntro));
  for (const message of [en, zh]) {
    assert.equal(message.text.split(link).length - 1, 2, "the link appears in both language blocks");
    assert.match(message.text, /30/);
    assert.match(message.text, /help@aivora\.test/);
    assert.doesNotMatch(message.text, /\{minutes\}|\{contact\}/);
  }
});

test("sendPasswordResetEmail：没配只记日志；Resend 拒收 / 网络异常都不抛", async () => {
  const input = { to: "owner@sunnyshutter.ca", link: "https://app.aivora.test/reset-password?token=x", locale: "zh-CN" as const, expiresInMinutes: 30 };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const okFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  assert.deepEqual(await sendPasswordResetEmail(input, { env: {} as NodeJS.ProcessEnv, fetchImpl: okFetch }), {
    sent: false,
    reason: "not_configured",
  });
  assert.equal(calls.length, 0);

  assert.deepEqual(await sendPasswordResetEmail(input, { env: CONFIGURED_ENV, fetchImpl: okFetch }), { sent: true });
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal((call.init.headers as Record<string, string>).Authorization, "Bearer re_test_not_a_real_key");
  const body = JSON.parse(String(call.init.body)) as { from: string; to: string[]; subject: string; text: string };
  assert.equal(body.from, "Aivora <notify@aivora.test>");
  assert.deepEqual(body.to, ["owner@sunnyshutter.ca"]);
  assert.ok(body.text.includes(input.link));
  assert.ok(body.text.includes("help@aivora.test"), "help line uses the configured contact email");

  const rejected = (async () => new Response("{}", { status: 422 })) as unknown as typeof fetch;
  assert.deepEqual(await sendPasswordResetEmail(input, { env: CONFIGURED_ENV, fetchImpl: rejected }), {
    sent: false,
    reason: "send_failed",
  });
  const offline = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.deepEqual(await sendPasswordResetEmail(input, { env: CONFIGURED_ENV, fetchImpl: offline }), {
    sent: false,
    reason: "send_failed",
  });
});

/* ── 源码契约：客户端不碰服务端、只加表、不物理删除 ─────────────────── */

const read = (file: string) => readFileSync(file, "utf8");

test("客户端表单不引用服务端模块；联系邮箱由服务端页面传入；重置页不外发 Referer", () => {
  for (const file of ["src/components/auth/forgot-password-form.tsx", "src/components/auth/reset-password-form.tsx"]) {
    const source = read(file);
    assert.match(source, /^"use client";/);
    assert.doesNotMatch(source, /@\/lib\/services|@\/lib\/db|@\/lib\/config\/contact|process\.env/, file);
  }
  const forgotPage = read("src/app/(auth)/forgot-password/page.tsx");
  assert.doesNotMatch(forgotPage, /"use client"/);
  assert.match(forgotPage, /contactEmail=\{contactEmail\(\)\}/);
  const resetPage = read("src/app/(auth)/reset-password/page.tsx");
  assert.doesNotMatch(resetPage, /"use client"/);
  assert.match(resetPage, /referrer: "no-referrer"/);
  assert.match(resetPage, /inspectPasswordResetToken\(token\)/);
  const resetForm = read("src/components/auth/reset-password-form.tsx");
  assert.match(resetForm, /router\.replace\("\/login\?reset=done"\)/);
});

test("登录页：「忘记密码？」在密码框下、提交钮之上；提交钮与默认落点不变；成功回来有提示", () => {
  const login = read("src/app/(auth)/login/page.tsx");
  const passwordInput = login.indexOf('id="password"');
  const forgotLink = login.indexOf('href="/forgot-password"');
  const submit = login.indexOf('<Button type="submit" disabled={loading} className="w-full">');
  assert.ok(passwordInput > 0 && forgotLink > passwordInput && submit > forgotLink);
  assert.match(login, /\{copy\.forgotPassword\}/);
  assert.match(login, /: "\/app\/create";/);
  assert.match(login, /searchParams\.get\("reset"\) === "done"/);
  assert.match(login, /\{copy\.passwordResetDone\}/);
});

test("一页一枚实心钮：两个表单各自只有一枚默认样式的 Button", () => {
  for (const file of ["src/components/auth/forgot-password-form.tsx"]) {
    const buttons = read(file).match(/<Button\b[^>]*>/g) ?? [];
    assert.equal(buttons.filter((tag) => !/variant=/.test(tag)).length, 1, file);
  }
  /// 重置页两种状态互斥：链接失效时只有「重新获取链接」，有效时只有「保存新密码」
  const reset = read("src/components/auth/reset-password-form.tsx");
  const solid = (reset.match(/<Button\b[^>]*>/g) ?? []).filter((tag) => !/variant=/.test(tag));
  assert.equal(solid.length, 2);
  assert.match(reset, /\{linkInvalid \? \([\s\S]*?<Button render=\{<Link href="\/forgot-password" \/>\}[\s\S]*?\) : \([\s\S]*?<Button type="submit"/);
});

test("迁移只加一张表（带唯一索引与级联外键）；schema 与迁移一致；service 里没有物理删除", () => {
  const migration = read("prisma/migrations/20261025160000_password_reset_token/migration.sql");
  assert.match(migration, /CREATE TABLE "PasswordResetToken"/);
  assert.match(migration, /"tokenHash" TEXT NOT NULL/);
  assert.match(migration, /"usedAt" TIMESTAMP\(3\),/);
  assert.match(migration, /"requestedIp" TEXT,/);
  assert.match(migration, /CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"\("tokenHash"\)/);
  assert.match(migration, /CREATE INDEX "PasswordResetToken_userId_createdAt_idx"/);
  assert.match(
    migration,
    /FOREIGN KEY \("userId"\) REFERENCES "AdminUser"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(migration, /\bDROP\b|DELETE\s+FROM|TRUNCATE|ALTER\s+COLUMN|ALTER TABLE "AdminUser"/i);

  const schema = read("prisma/schema.prisma");
  const model = /model PasswordResetToken \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
  assert.match(model, /tokenHash\s+String\s+@unique/);
  assert.match(model, /usedAt\s+DateTime\?/);
  assert.match(model, /requestedIp\s+String\?/);
  assert.match(model, /@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(schema, /passwordResetTokens\s+PasswordResetToken\[\]/);

  const service = read("src/lib/services/password-reset-service.ts");
  assert.doesNotMatch(service, /\.delete\(|deleteMany\(/);
});
