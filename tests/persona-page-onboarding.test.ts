import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/**
 * Phase 1 — legacy /persona is now an account-neutral editorial entry.
 *
 * 这些都是「能不能让一个真实陌生访客 5 秒内点对地方」的硬性 user-flow 检查。
 */

test("统一公开入口：注册与登录均可达，不再要求选择 B/C persona", async () => {
  const file = path.join(ROOT, "src/app/(public)/persona/page.tsx");
  const src = await readFile(file, "utf-8");
  assert.ok(/\/register/.test(src), "公开入口必须有 /register 链接");
  assert.ok(/\/login/.test(src), "公开入口必须有 /login 链接");
  assert.ok(/\/app\/create/.test(src), "已登录用户必须直达统一工作区");
  assert.doesNotMatch(src, /PersonaCard|persona="(?:BUSINESS|PERSONAL)"|invite-only/i);
});

test("登录页有'创建个人账号'入口，注册页有'立即登录'入口（双向打通）", async () => {
  const login = await readFile(
    path.join(ROOT, "src/app/(auth)/login/page.tsx"),
    "utf-8",
  );
  const register = await readFile(
    path.join(ROOT, "src/app/(auth)/register/page.tsx"),
    "utf-8",
  );
  assert.ok(/href="\/register"/.test(login), "登录页应链接到 /register");
  assert.ok(/href="\/login"/.test(register), "注册页应链接到 /login");
});

test("注册入口引用的隐私政策与服务条款保持公开，不得被登录中间件拦截", async () => {
  const middleware = await readFile(path.join(ROOT, "src/middleware.ts"), "utf-8");
  assert.match(middleware, /"\/privacy"/, "隐私政策必须在公开路由白名单");
  assert.match(middleware, /"\/terms"/, "服务条款必须在公开路由白名单");
});
