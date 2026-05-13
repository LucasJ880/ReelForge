import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/**
 * Phase 6.5 — persona landing 页面契约：
 *   - 未登录访客必须能看到"创建账号"入口（PERSONAL 走 /register）
 *   - BUSINESS 卡片仍是 invite-only（链接 /login）
 *   - PERSONAL 卡片走自助注册（链接 /register）
 *   - 顶栏同时有 Sign in 和 Get started 两个入口，确保任何方向都不卡
 *
 * 这些都是「能不能让一个真实陌生访客 5 秒内点对地方」的硬性 user-flow 检查。
 */

test("persona landing 页面：未登录访客必须看到 PERSONAL 自助注册入口", async () => {
  const file = path.join(ROOT, "src/app/(public)/persona/page.tsx");
  const src = await readFile(file, "utf-8");
  /// 顶栏 "Get started" 按钮必须指向 /register
  assert.ok(
    /href="\/register"/.test(src),
    "persona page 顶栏必须有 /register 链接",
  );
  /// PERSONAL 卡片 ctaHref 必须是 /register（公开自助）
  assert.ok(
    /persona="PERSONAL"[\s\S]*?ctaHref={isAuthed \? undefined : "\/register"}/m.test(
      src,
    ),
    "PERSONAL 卡片未登录态必须把访客送到 /register",
  );
  /// BUSINESS 卡片 ctaHref 必须是 /login（invite-only）
  assert.ok(
    /persona="BUSINESS"[\s\S]*?ctaHref={isAuthed \? undefined : "\/login\?from=\/business"}/m.test(
      src,
    ),
    "BUSINESS 卡片未登录态应把访客送到 /login（invite-only）",
  );
});

test("persona landing 页面：BUSINESS 卡片明示 invite-only，PERSONAL 卡片明示 free", async () => {
  const file = path.join(ROOT, "src/app/(public)/persona/page.tsx");
  const src = await readFile(file, "utf-8");
  assert.ok(
    /invite-only/i.test(src),
    "BUSINESS 卡片应明示 invite-only，避免访客白点 /login 后困惑",
  );
  assert.ok(
    /Free to start|free/i.test(src),
    "PERSONAL 卡片应明示 free / 无需邀请",
  );
});

test("PersonaCard 组件支持 ctaLabel + secondaryNote，避免硬编码 'Sign in as ...'", async () => {
  const file = path.join(ROOT, "src/app/(public)/persona/persona-card.tsx");
  const src = await readFile(file, "utf-8");
  assert.ok(/ctaLabel\?:\s*string/.test(src), "PersonaCard 应支持 ctaLabel");
  assert.ok(
    /secondaryNote\?:\s*string/.test(src),
    "PersonaCard 应支持 secondaryNote",
  );
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
