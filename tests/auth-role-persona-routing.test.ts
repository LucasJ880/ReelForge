import assert from "node:assert/strict";
import test from "node:test";
import { isInternalRole, normalizeUserTypeForRole } from "../src/lib/auth-role-policy";

test("RF-008 staff role wins over legacy customer persona", () => {
  for (const role of ["SUPER_ADMIN", "OPERATOR"] as const) {
    for (const userType of ["BUSINESS", "PERSONAL", null] as const) {
      assert.equal(normalizeUserTypeForRole(userType, role), role);
      assert.equal(isInternalRole(role), true);
    }
  }
});

/// 内部页面的跳转判定（decideInternalAccess / requireInternalPage）随 (internal) 页面一起删了（2026-11-16）；
/// 内部接口只认系统角色，判据是 isInternalRole。
test("RF-008 customer roles never inherit internal access from persona", () => {
  for (const role of ["CUSTOMER", "REVIEWER"] as const) {
    assert.equal(isInternalRole(role), false);
    for (const userType of ["BUSINESS", "PERSONAL", "OPERATOR", "SUPER_ADMIN", null] as const) {
      const normalized = normalizeUserTypeForRole(userType, role);
      assert.ok(normalized !== "OPERATOR" && normalized !== "SUPER_ADMIN", "遗留的 userType 不能把客户抬成内部身份");
    }
  }
  assert.equal(isInternalRole(null), false);
  assert.equal(isInternalRole(undefined), false);
});
