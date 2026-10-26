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
/// C1：首页「免费试做 3 条」入口的必填项（店名 / 行业 / 条款同意），见 route 文件契约测试。

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
 * role 必须写死为 CUSTOMER，并原子创建 starter Workspace。
 *
 * 用文本断言是最低成本的方式：避免引入 next handler runtime 依赖。
 */
test("register route 文件契约：POST + CUSTOMER/starter，拒绝公开提权", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.resolve(
    process.cwd(),
    "src/app/api/auth/register/route.ts",
  );
  const content = fs.readFileSync(file, "utf8");
  assert.match(content, /export async function POST/, "register endpoint must be POST");
  assert.match(content, /role:\s*"CUSTOMER"/, "must hard-code role=CUSTOMER");
  assert.match(content, /workspace:\s*\{[\s\S]*?create:/, "must create a default workspace atomically");
  assert.match(content, /planId:\s*"starter"/, "public registration must receive starter");
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
 * 跨文件契约（C1）：注册成功先进上手向导 /app/welcome，不再经过 B/C persona 选择。
 */
test("register page 契约：成功后 router.push('/app/welcome')", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.resolve(
    process.cwd(),
    "src/app/(auth)/register/page.tsx",
  );
  const content = fs.readFileSync(file, "utf8");
  assert.match(content, /router\.push\("\/app\/welcome"\)/, "must enter the onboarding wizard post-signup");
  assert.doesNotMatch(content, /router\.push\("\/(?:business|personal)"\)/);
  assert.match(content, /signIn\(/, "must auto-login via next-auth signIn");
});

test("register route（C1）：店名、行业、条款同意必填；同意时间与条款版本入库；错误带稳定 code", async () => {
  const fs = await import("node:fs");
  const content = fs.readFileSync("src/app/api/auth/register/route.ts", "utf8");
  assert.match(content, /businessName: z\.string\(\)\.trim\(\)\.min\(1/);
  assert.match(content, /industry: z\.enum\(BUSINESS_INDUSTRIES/);
  assert.match(content, /acceptTerms: z\.literal\(true/);
  assert.match(content, /termsAcceptedAt: new Date\(\)/);
  assert.match(content, /termsVersion: TERMS_VERSION/);
  assert.match(content, /name: businessName/, "workspace is named after the business");
  for (const code of ["EMAIL_TAKEN", "RATE_LIMITED", "INVALID_INPUT"]) {
    assert.ok(content.includes(`"${code}" satisfies RegisterErrorCode`), code);
  }
  const page = fs.readFileSync("src/app/(auth)/register/page.tsx", "utf8");
  assert.match(page, /reg\.errors\[code\]/, "page localizes errors by code");
});
