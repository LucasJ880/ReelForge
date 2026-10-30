import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { middleware } from "../src/middleware";
import { authOptions } from "../src/lib/auth";
import {
  decideDemoAccess,
  demoAccountEmails,
  isDemoAccountEmail,
  isDemoLoginAllowed,
  isReservedTestEmail,
  isTestAccountLoginAllowed,
} from "../src/lib/demo-account";

/// 演示账号守卫（2026-10-23 安全止血）：凭据曾以明文打进客户端登录页，
/// 付费路由又不拦 demo。这里用行为测试钉住三件事：生产禁止登录、旧会话作废、只读。

const SECRET = "demo-account-guard-secret";
const ORIGIN = "http://localhost:3120";
const env = process.env as Record<string, string | undefined>;

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });
}

async function requestAs(email: string, path: string, method = "GET") {
  /// loginAt：会话安全闸（session-policy）要求新签发的 token 带登录时刻，否则视为旧版本作废
  const token = await encode({
    secret: SECRET,
    token: { sub: `user-${email}`, email, loginAt: Math.floor(Date.now() / 1000) },
  });
  return middleware(
    new NextRequest(`${ORIGIN}${path}`, {
      method,
      headers: { cookie: `next-auth.session-token=${token}` },
    }),
  );
}

const MIDDLEWARE_ENV = { AUTH_SECRET: SECRET, NEXTAUTH_URL: ORIGIN, VERCEL: undefined };

test("demo 名单：默认账号不可被环境变量移出，大小写与空格不影响识别", async () => {
  await withEnv({ DEMO_ACCOUNT_EMAILS: "" }, async () => {
    assert.ok(isDemoAccountEmail("demo@aivora.app"));
    assert.ok(isDemoAccountEmail("  Demo@Aivora.App "));
    assert.ok(!isDemoAccountEmail("someone@example.com"));
    assert.ok(!isDemoAccountEmail(null));
  });
  await withEnv({ DEMO_ACCOUNT_EMAILS: "trial@aivora.app" }, async () => {
    assert.deepEqual(demoAccountEmails(), ["demo@aivora.app", "trial@aivora.app"]);
  });
});

test("demo 登录：生产环境即使设置 ALLOW_DEMO_LOGIN=1 也不放行", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1" }, async () => {
    assert.equal(isDemoLoginAllowed(), false);
  });
  await withEnv({ NODE_ENV: "development", ALLOW_DEMO_LOGIN: undefined }, async () => {
    assert.equal(isDemoLoginAllowed(), false);
  });
  await withEnv({ NODE_ENV: "development", ALLOW_DEMO_LOGIN: "1" }, async () => {
    assert.equal(isDemoLoginAllowed(), true);
  });
});

test("authorize：生产环境的演示账号登录在查库之前就被拒绝", async () => {
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: (credentials: Record<string, string>) => Promise<unknown> };
  };
  await withEnv({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1", DATABASE_URL: undefined }, async () => {
    /// 没有 DATABASE_URL：若守卫没在查库前返回，这里会抛 Prisma 错误而不是 null。
    assert.equal(
      await provider.options.authorize({ email: " Demo@Aivora.app ", password: "anything" }),
      null,
    );
  });
});

test("测试域名账号：真实生产禁止登录，本地开发与验收演练放行", async () => {
  assert.ok(isReservedTestEmail("mock-walkthrough@aivora.test"));
  assert.ok(isReservedTestEmail("Onboarding-1@Aivora.INVALID"));
  assert.ok(!isReservedTestEmail("owner@contest.com"));
  assert.ok(!isReservedTestEmail("bill@sunnyshutter.ca"));
  await withEnv({ NODE_ENV: "production", AIVORA_DRY_RUN: undefined, VERCEL_ENV: undefined }, async () => {
    assert.equal(isTestAccountLoginAllowed(), false);
  });
  await withEnv({ NODE_ENV: "production", AIVORA_DRY_RUN: "1", VERCEL_ENV: "production" }, async () => {
    assert.equal(isTestAccountLoginAllowed(), false);
  });
  await withEnv({ NODE_ENV: "production", AIVORA_DRY_RUN: "1", VERCEL_ENV: "preview" }, async () => {
    assert.equal(isTestAccountLoginAllowed(), true);
  });
  await withEnv({ NODE_ENV: "development", AIVORA_DRY_RUN: undefined }, async () => {
    assert.equal(isTestAccountLoginAllowed(), true);
  });
  assert.equal(
    decideDemoAccess({
      email: "sunny-shutter@aivora.test",
      method: "POST",
      pathname: "/api/batches",
      testAccountLoginAllowed: false,
    }),
    "unauthenticated",
  );
});

test("authorize：真实生产里测试域名账号在查库之前就被拒绝", async () => {
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: (credentials: Record<string, string>) => Promise<unknown> };
  };
  await withEnv(
    { NODE_ENV: "production", AIVORA_DRY_RUN: undefined, VERCEL_ENV: "production", DATABASE_URL: undefined },
    async () => {
      assert.equal(
        await provider.options.authorize({ email: "mock-walkthrough@aivora.test", password: "anything" }),
        null,
      );
    },
  );
});

test("demo 判定：不允许登录时作废会话；允许登录时 API 写请求一律 blocked", () => {
  const demo = "demo@aivora.app";
  assert.equal(
    decideDemoAccess({ email: demo, method: "GET", pathname: "/app/library", loginAllowed: false }),
    "unauthenticated",
  );
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.equal(
      decideDemoAccess({ email: demo, method, pathname: "/api/batches", loginAllowed: true }),
      "blocked",
      method,
    );
  }
  assert.equal(
    decideDemoAccess({ email: demo, method: "GET", pathname: "/api/batches", loginAllowed: true }),
    "allow",
  );
  assert.equal(
    decideDemoAccess({
      email: "owner@example.com",
      method: "POST",
      pathname: "/api/video-generation/dispatch",
      loginAllowed: false,
    }),
    "allow",
  );
});

test("middleware：生产环境的 demo 会话被当作未登录（页面跳登录、API 401）", async () => {
  await withEnv({ ...MIDDLEWARE_ENV, NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1" }, async () => {
    const page = await requestAs("demo@aivora.app", "/app/library");
    assert.equal(page.status, 307);
    assert.equal(new URL(page.headers.get("location") ?? "").pathname, "/login");

    const api = await requestAs("demo@aivora.app", "/api/video-generation/dispatch", "POST");
    assert.equal(api.status, 401);
    assert.equal((await api.json()).code, "AUTH_REQUIRED");

    const owner = await requestAs("owner@example.com", "/api/video-generation/dispatch", "POST");
    assert.equal(owner.status, 200);
    assert.equal(owner.headers.get("x-middleware-next"), "1");
  });
});

test("middleware：允许 demo 登录的环境里，demo 对付费入口的写请求返回 403 DEMO_BLOCKED", async () => {
  await withEnv({ ...MIDDLEWARE_ENV, NODE_ENV: "development", ALLOW_DEMO_LOGIN: "1" }, async () => {
    const paidRoutes = [
      "/api/video-generation/dispatch",
      "/api/video-generation/storyboards",
      "/api/batches",
      "/api/product-images",
      "/api/brand-packaging",
      "/api/content-plans",
      "/api/product-link",
    ];
    for (const path of paidRoutes) {
      const response = await requestAs("demo@aivora.app", path, "POST");
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).code, "DEMO_BLOCKED", path);
    }
    const read = await requestAs("demo@aivora.app", "/api/batches", "GET");
    assert.equal(read.status, 200);
  });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

test("仓库里不再出现曾经公开过的口令，登录页不再有一键体验", () => {
  /// 拼接写法，避免本测试文件自己命中。
  const leaked = [
    ["aivora", "2026"].join(""),
    ["testpass", "123"].join(""),
    ["SunnyShutter", "2026!"].join(""),
  ];
  const roots = ["src", "prisma", "scripts", "tests"];
  const offenders = roots
    .flatMap((root) => listFiles(join(process.cwd(), root)))
    .filter((path) => /\.(ts|tsx|mjs|js)$/.test(path))
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return leaked.some((value) => source.includes(value));
    });
  assert.deepEqual(offenders, []);

  const login = readFileSync(join(process.cwd(), "src/app/(auth)/login/page.tsx"), "utf8");
  assert.doesNotMatch(login, /DEMO_(EMAIL|PASSWORD)/);
  assert.doesNotMatch(login, /demo@aivora\.app/);
});
