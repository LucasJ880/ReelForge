import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/api-auth";

const { classifyAccess } = __test__;

/**
 * Phase 5 — persona-aware auth access matrix。
 * 这些测试只验证「pure 决策函数」classifyAccess，与 NextAuth / DB 解耦。
 * 真正的 require* helper 会读 session，但底层判定逻辑必须与下表完全一致。
 *
 * 表格（行=账号 persona，列=要进的端点类别）：
 *
 *   account                        operator  reviewer  business  personal  generation
 *   ─────────────────────────────────────────────────────────────────────────────────
 *   role=SUPER_ADMIN ut=SUPER_ADMIN  allow    allow     allow     allow     allow
 *   role=OPERATOR    ut=OPERATOR     allow    allow     allow     allow     allow
 *   role=REVIEWER    ut=OPERATOR     deny     allow     allow     allow     allow
 *   role=OPERATOR    ut=BUSINESS     deny     deny      allow     deny      allow
 *   role=OPERATOR    ut=PERSONAL     deny     deny      deny      allow     allow
 *   role=OPERATOR    ut=null         deny     deny      deny      deny      deny
 *   not-logged-in                    deny401  deny401   deny401   deny401   deny401
 */

test("SUPER_ADMIN/OPERATOR persona: 全通行（含 internal 端点）", () => {
  const acct = { role: "SUPER_ADMIN" as const, userType: "SUPER_ADMIN" as const };
  for (const expecting of [
    "operator",
    "reviewer",
    "business",
    "personal",
    "generation",
    "internal",
  ] as const) {
    assert.equal(
      classifyAccess({ ...acct, expecting }),
      "allow",
      `SUPER_ADMIN must access ${expecting}`,
    );
  }
});

test("OPERATOR/OPERATOR persona: 全通行", () => {
  const acct = { role: "OPERATOR" as const, userType: "OPERATOR" as const };
  for (const expecting of [
    "operator",
    "reviewer",
    "business",
    "personal",
    "generation",
    "internal",
  ] as const) {
    assert.equal(
      classifyAccess({ ...acct, expecting }),
      "allow",
      `OPERATOR/OPERATOR must access ${expecting}`,
    );
  }
});

test("REVIEWER role + internal userType: 仅 reviewer / customer 表面，不能 operator", () => {
  const acct = { role: "REVIEWER" as const, userType: "OPERATOR" as const };
  assert.equal(classifyAccess({ ...acct, expecting: "operator" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "internal" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "reviewer" }), "allow");
  assert.equal(classifyAccess({ ...acct, expecting: "business" }), "allow");
  assert.equal(classifyAccess({ ...acct, expecting: "personal" }), "allow");
  assert.equal(classifyAccess({ ...acct, expecting: "generation" }), "allow");
});

test("自助注册的 PERSONAL（role=OPERATOR, userType=PERSONAL）只能 personal+generation", () => {
  const acct = { role: "OPERATOR" as const, userType: "PERSONAL" as const };
  assert.equal(
    classifyAccess({ ...acct, expecting: "operator" }),
    "deny-forbidden",
    "PERSONAL 不应得到 admin 权限（即便 default role=OPERATOR）",
  );
  assert.equal(classifyAccess({ ...acct, expecting: "internal" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "reviewer" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "business" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "personal" }), "allow");
  assert.equal(classifyAccess({ ...acct, expecting: "generation" }), "allow");
});

test("BUSINESS 客户（role=OPERATOR, userType=BUSINESS）只能 business+generation", () => {
  const acct = { role: "OPERATOR" as const, userType: "BUSINESS" as const };
  assert.equal(classifyAccess({ ...acct, expecting: "operator" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "reviewer" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "business" }), "allow");
  assert.equal(
    classifyAccess({ ...acct, expecting: "personal" }),
    "deny-forbidden",
    "BUSINESS 不能进 personal 表面",
  );
  assert.equal(classifyAccess({ ...acct, expecting: "generation" }), "allow");
});

test("userType=null（未选 persona）：generation 端点拒绝，避免无 persona 调用", () => {
  const acct = { role: "OPERATOR" as const, userType: null };
  assert.equal(classifyAccess({ ...acct, expecting: "business" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "personal" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...acct, expecting: "generation" }), "deny-forbidden");
});

test("未登录：所有端点都返回 deny-not-logged-in", () => {
  for (const expecting of [
    "operator",
    "reviewer",
    "business",
    "personal",
    "generation",
    "internal",
  ] as const) {
    assert.equal(
      classifyAccess({ role: null, userType: null, expecting }),
      "deny-not-logged-in",
    );
  }
});

test("跨 persona 防护：BUSINESS 不能进 personal，PERSONAL 不能进 business（非 internal staff）", () => {
  const business = { role: "OPERATOR" as const, userType: "BUSINESS" as const };
  const personal = { role: "OPERATOR" as const, userType: "PERSONAL" as const };
  assert.equal(classifyAccess({ ...business, expecting: "personal" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...personal, expecting: "business" }), "deny-forbidden");
});

test("回归：旧账号（role=OPERATOR, userType=OPERATOR）的运营行为不被破坏", () => {
  /// 模拟 normalizeUserType 把 db userType=null 的旧 OPERATOR 升级成 ut=OPERATOR
  const legacy = { role: "OPERATOR" as const, userType: "OPERATOR" as const };
  for (const expecting of [
    "operator",
    "reviewer",
    "business",
    "personal",
    "generation",
    "internal",
  ] as const) {
    assert.equal(
      classifyAccess({ ...legacy, expecting }),
      "allow",
      `legacy operator must keep access to ${expecting}`,
    );
  }
});
