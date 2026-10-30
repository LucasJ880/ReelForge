import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { middleware } from "../src/middleware";
import { SessionInvalidatedError, authOptions } from "../src/lib/auth";
import {
  SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  evaluateSessionClaims,
} from "../src/lib/session-policy";

/**
 * 2026-10-30 CEO 反馈：两天前的登录还在，点开 /app/create 直接进，没输密码。
 * 三道闸：闲置超时（token exp）、7 天绝对上限、发布即失效。后两道在 middleware 与
 * jwt 回调里用同一个纯函数判，这里分别从两个入口验。
 */

const SECRET = "session-policy-regression-secret";
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const nowSeconds = Math.floor(NOW / 1000);

test("判定：本策略上线前的旧 token（没有登录时刻）一律重新登录", () => {
  assert.equal(evaluateSessionClaims({}, { nowMs: NOW, release: null }), "superseded");
  assert.equal(evaluateSessionClaims(null, { nowMs: NOW, release: null }), "superseded");
  assert.equal(
    evaluateSessionClaims({ loginAt: "1730000000" }, { nowMs: NOW, release: null }),
    "superseded",
  );
});

test("判定：登录满 7 天必须重新输密码，不管期间多活跃", () => {
  const justInside = { loginAt: nowSeconds - SESSION_ABSOLUTE_MAX_AGE_SECONDS };
  const justOutside = { loginAt: nowSeconds - SESSION_ABSOLUTE_MAX_AGE_SECONDS - 1 };
  assert.equal(evaluateSessionClaims(justInside, { nowMs: NOW, release: null }), "ok");
  assert.equal(evaluateSessionClaims(justOutside, { nowMs: NOW, release: null }), "expired");
});

test("判定：发布即失效——不是本次发布签发的登录作废；本地没有发布号时不按发布判", () => {
  const claims = { loginAt: nowSeconds - 60, release: "sha-old" };
  assert.equal(evaluateSessionClaims(claims, { nowMs: NOW, release: "sha-new" }), "superseded");
  assert.equal(evaluateSessionClaims(claims, { nowMs: NOW, release: "sha-old" }), "ok");
  assert.equal(evaluateSessionClaims(claims, { nowMs: NOW, release: null }), "ok");
  assert.equal(
    evaluateSessionClaims({ loginAt: nowSeconds - 60, release: null }, { nowMs: NOW, release: "sha-new" }),
    "superseded",
  );
});

async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function requestWithToken(pathname: string, claims: Record<string, unknown>) {
  const token = await encode({
    secret: SECRET,
    token: { sub: "session-policy-user", email: "session-policy@example.com", ...claims },
  });
  return middleware(
    new NextRequest(`http://localhost:3120${pathname}`, {
      headers: { cookie: `next-auth.session-token=${token}` },
    }),
  );
}

const middlewareEnv = {
  AUTH_SECRET: SECRET,
  NEXTAUTH_URL: "http://localhost:3120",
  AIVORA_SESSION_RELEASE: "sha-current",
};

test("middleware：本次发布签发、未满 7 天的登录放行", async () => {
  await withEnv(middlewareEnv, async () => {
    const response = await requestWithToken("/app/create", {
      loginAt: Math.floor(Date.now() / 1000) - 60,
      release: "sha-current",
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});

test("middleware：旧 token / 上一版签发 / 满 7 天 → 回登录页说明原因，并清掉 cookie", async () => {
  await withEnv(middlewareEnv, async () => {
    const stale = [
      {},
      { loginAt: Math.floor(Date.now() / 1000) - 60, release: "sha-previous" },
      { loginAt: Math.floor(Date.now() / 1000) - SESSION_ABSOLUTE_MAX_AGE_SECONDS - 60, release: "sha-current" },
    ];
    for (const claims of stale) {
      const response = await requestWithToken("/app/create", claims);
      assert.equal(response.status, 307, JSON.stringify(claims));
      const location = new URL(response.headers.get("location") ?? "");
      assert.equal(location.pathname, "/login");
      assert.equal(location.searchParams.get("from"), "/app/create");
      assert.equal(location.searchParams.get("reason"), "expired");
      assert.match(response.headers.get("set-cookie") ?? "", /next-auth\.session-token=;/);
    }
  });
});

test("middleware：API 请求拿作废的会话回 401 sign_in，不是放行到路由", async () => {
  await withEnv(middlewareEnv, async () => {
    const response = await requestWithToken("/api/upload/blob/ticket", {
      loginAt: Math.floor(Date.now() / 1000) - 60,
      release: "sha-previous",
    });
    assert.equal(response.status, 401);
    const body = (await response.json()) as { code: string; action: string; error: string };
    assert.equal(body.code, "AUTH_REQUIRED");
    assert.equal(body.action, "sign_in");
    assert.equal(body.error, "登录已失效，请重新登录");
  });
});

test("jwt 回调：新登录写入登录时刻与发布号；作废的旧会话在查库之前就抛错", async () => {
  await withEnv({ AIVORA_SESSION_RELEASE: "sha-current" }, async () => {
    const jwt = authOptions.callbacks?.jwt;
    assert.ok(jwt);
    const signedIn = await jwt({
      token: {},
      user: { id: "u-1", email: "a@example.com", role: "CUSTOMER", userType: "BUSINESS" } as never,
      account: null,
      trigger: "signIn",
    });
    assert.equal(typeof signedIn.loginAt, "number");
    assert.equal(signedIn.release, "sha-current");

    await assert.rejects(
      async () => jwt({ token: { id: "u-1" }, user: undefined as never, account: null }),
      SessionInvalidatedError,
    );
    await assert.rejects(
      async () =>
        jwt({
          token: { id: "u-1", loginAt: Math.floor(Date.now() / 1000), release: "sha-previous" },
          user: undefined as never,
          account: null,
        }),
      SessionInvalidatedError,
    );
  });
});
