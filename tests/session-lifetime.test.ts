import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SESSION_IDLE_MAX_AGE_SECONDS, authOptions } from "../src/lib/auth";
import { SESSION_ABSOLUTE_MAX_AGE_SECONDS } from "../src/lib/session-policy";
import { getPlatformCopy } from "../src/i18n/platform-copy";

/**
 * 2026-07-29：登录页承诺「7 天免登录」，但 authOptions 里 maxAge 是 12 小时，
 * 而且过期只在下一次导航时才被 middleware 发现 —— 开着的标签页看起来永远在线，
 * 直到所有操作都静默 401。会话时长、文案、过期出口三者必须锁在一起。
 *
 * 2026-10-30：CEO 两天前的登录还在，点开 /app/create 直接进。闲置超时收到 12 小时，
 * 另加 7 天绝对上限与「发布即失效」（session-policy），文案同步。
 */
test("会话时长与登录页文案一致", () => {
  assert.equal(SESSION_IDLE_MAX_AGE_SECONDS, 12 * 60 * 60);
  assert.equal(SESSION_ABSOLUTE_MAX_AGE_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(authOptions.session?.maxAge, SESSION_IDLE_MAX_AGE_SECONDS);
  const idleHours = String(SESSION_IDLE_MAX_AGE_SECONDS / 3_600);
  const absoluteDays = String(SESSION_ABSOLUTE_MAX_AGE_SECONDS / 86_400);
  for (const locale of ["zh-CN", "en-US"] as const) {
    const { sessionHint, sessionExpired } = getPlatformCopy(locale).auth;
    assert.ok(sessionHint.includes(idleHours), `${locale} 登录提示必须写明真实的闲置超时小时数`);
    assert.ok(sessionHint.includes(absoluteDays), `${locale} 登录提示必须写明真实的绝对上限天数`);
    assert.ok(sessionExpired.includes(idleHours), `${locale} 过期说明必须与闲置超时一致`);
    assert.ok(sessionExpired.includes(absoluteDays), `${locale} 过期说明必须与绝对上限一致`);
  }
});

test("滚动续期：updateAge 必须短于 maxAge，活跃用户不会被中途踢出", () => {
  const updateAge = authOptions.session?.updateAge;
  assert.ok(typeof updateAge === "number" && updateAge > 0, "必须显式设置 updateAge");
  assert.ok(
    updateAge < SESSION_IDLE_MAX_AGE_SECONDS,
    "updateAge >= maxAge 时 token 永远不会续签，滚动会话失效",
  );
});

test("过期后有可见出口：watcher 挂载在根布局，登录页解释原因", () => {
  const rootLayout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
  assert.match(rootLayout, /<SessionExpiryWatcher \/>/);
  const loginPage = readFileSync(
    resolve(process.cwd(), "src/app/(auth)/login/page.tsx"),
    "utf8",
  );
  assert.match(loginPage, /reason"\) === "expired"/);
  assert.match(loginPage, /copy\.sessionExpired/);
  for (const locale of ["zh-CN", "en-US"] as const) {
    assert.ok(getPlatformCopy(locale).auth.sessionExpired.length > 0);
  }
});
