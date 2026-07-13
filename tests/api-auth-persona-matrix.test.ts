import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/api-auth";

const { classifyAccess } = __test__;
const surfaces = ["operator", "reviewer", "platform", "generation", "internal"] as const;

test("SUPER_ADMIN 与 OPERATOR 保留系统权限并可使用统一平台", () => {
  for (const role of ["SUPER_ADMIN", "OPERATOR"] as const) {
    for (const expecting of surfaces) {
      assert.equal(classifyAccess({ role, userType: role, expecting }), "allow");
    }
  }
});

test("REVIEWER 可使用 reviewer/platform/generation，但不可进入 operator/internal", () => {
  const account = { role: "REVIEWER" as const, userType: "OPERATOR" as const };
  assert.equal(classifyAccess({ ...account, expecting: "operator" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...account, expecting: "internal" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...account, expecting: "reviewer" }), "allow");
  assert.equal(classifyAccess({ ...account, expecting: "platform" }), "allow");
  assert.equal(classifyAccess({ ...account, expecting: "generation" }), "allow");
});

test("starter/studio CUSTOMER 只获得 platform/generation，plan 不提升系统权限", () => {
  for (const userType of ["PERSONAL", "BUSINESS"] as const) {
    const account = { role: "CUSTOMER" as const, userType, hasWorkspace: true };
    assert.equal(classifyAccess({ ...account, expecting: "operator" }), "deny-forbidden");
    assert.equal(classifyAccess({ ...account, expecting: "reviewer" }), "deny-forbidden");
    assert.equal(classifyAccess({ ...account, expecting: "internal" }), "deny-forbidden");
    assert.equal(classifyAccess({ ...account, expecting: "platform" }), "allow");
    assert.equal(classifyAccess({ ...account, expecting: "generation" }), "allow");
  }
});

test("CUSTOMER 缺默认 Workspace 时 platform/generation 均 fail-closed", () => {
  const account = { role: "CUSTOMER" as const, userType: null, hasWorkspace: false };
  assert.equal(classifyAccess({ ...account, expecting: "platform" }), "deny-forbidden");
  assert.equal(classifyAccess({ ...account, expecting: "generation" }), "deny-forbidden");
});

test("未登录时所有统一权限面返回 deny-not-logged-in", () => {
  for (const expecting of surfaces) {
    assert.equal(
      classifyAccess({ role: null, userType: null, hasWorkspace: false, expecting }),
      "deny-not-logged-in",
    );
  }
});

test("历史 BUSINESS/PERSONAL 字段不再决定统一平台授权", () => {
  for (const userType of ["BUSINESS", "PERSONAL"] as const) {
    assert.equal(
      classifyAccess({ role: "CUSTOMER", userType, hasWorkspace: true, expecting: "platform" }),
      "allow",
    );
  }
});
