import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

/**
 * Phase 5 — register endpoint validation tests。
 *
 * 我们不在单测里启 Next route handler（避免 db / NextAuth 依赖），
 * 而是直接测 schema 行为，再用「外形断言」确保 route 文件对外契约稳定。
 */

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("请输入有效的邮箱"),
  password: z.string().min(8, "密码至少 8 位").max(128, "密码过长"),
  name: z.string().trim().max(80, "昵称过长").optional(),
});

test("register schema: 合法 payload 通过", () => {
  const r = registerSchema.safeParse({
    email: "  Foo@Bar.com  ",
    password: "12345678",
    name: "Alice",
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.email, "foo@bar.com", "email trimmed + lowercased");
    assert.equal(r.data.name, "Alice");
  }
});

test("register schema: 短密码被拒", () => {
  const r = registerSchema.safeParse({
    email: "foo@bar.com",
    password: "1234567",
  });
  assert.equal(r.success, false);
});

test("register schema: 无效邮箱被拒", () => {
  const r = registerSchema.safeParse({
    email: "not-an-email",
    password: "12345678",
  });
  assert.equal(r.success, false);
});

test("register schema: 缺密码字段被拒", () => {
  const r = registerSchema.safeParse({ email: "foo@bar.com" });
  assert.equal(r.success, false);
});

test("register schema: 超长 name 被拒", () => {
  const r = registerSchema.safeParse({
    email: "foo@bar.com",
    password: "12345678",
    name: "x".repeat(81),
  });
  assert.equal(r.success, false);
});

test("register schema: 超长 password 被拒", () => {
  const r = registerSchema.safeParse({
    email: "foo@bar.com",
    password: "x".repeat(129),
  });
  assert.equal(r.success, false);
});

/**
 * 契约外形断言：route 文件必须仍存在，且对外暴露 POST handler，
 * userType 写死为 PERSONAL，role 走 schema default = OPERATOR。
 *
 * 用文本断言是最低成本的方式：避免引入 next handler runtime 依赖。
 */
test("register route 文件契约：POST + 仅创建 PERSONAL persona 的账号", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.resolve(
    process.cwd(),
    "src/app/api/auth/register/route.ts",
  );
  const content = fs.readFileSync(file, "utf8");
  assert.match(content, /export async function POST/, "register endpoint must be POST");
  assert.match(content, /userType:\s*"PERSONAL"/, "must hard-code userType=PERSONAL");
  assert.doesNotMatch(
    content,
    /userType:\s*"BUSINESS"/,
    "register endpoint must never create BUSINESS accounts (invite-only)",
  );
  assert.doesNotMatch(
    content,
    /role:\s*"SUPER_ADMIN"/,
    "must not allow caller-controlled role escalation",
  );
  assert.match(
    content,
    /bcrypt\.hash\(/,
    "must hash password with bcrypt",
  );
});

/**
 * 跨文件契约：register page 必须把 userType=PERSONAL 的注册成功跳到 /personal
 * （不能跳 /business，避免误把个人用户带去商家表面）。
 */
test("register page 契约：成功后 router.push('/personal')", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.resolve(
    process.cwd(),
    "src/app/(auth)/register/page.tsx",
  );
  const content = fs.readFileSync(file, "utf8");
  assert.match(content, /router\.push\("\/personal"\)/, "must redirect to /personal post-signup");
  assert.doesNotMatch(content, /router\.push\("\/business"\)/);
  assert.match(content, /signIn\(/, "must auto-login via next-auth signIn");
});
