import assert from "node:assert/strict";
import test from "node:test";
import {
  decideInternalAccess,
  normalizeUserTypeForRole,
} from "../src/lib/auth-role-policy";

test("RF-008 staff role wins over legacy customer persona", () => {
  for (const role of ["SUPER_ADMIN", "OPERATOR"] as const) {
    for (const userType of ["BUSINESS", "PERSONAL", null] as const) {
      assert.equal(normalizeUserTypeForRole(userType, role), role);
      assert.equal(decideInternalAccess({ authenticated: true, role, userType }), "allow");
    }
  }
});

test("RF-008 customer roles never inherit internal access from persona", () => {
  for (const role of ["CUSTOMER", "REVIEWER"] as const) {
    for (const userType of ["BUSINESS", "PERSONAL", "OPERATOR", "SUPER_ADMIN", null] as const) {
      assert.notEqual(decideInternalAccess({ authenticated: true, role, userType }), "allow");
    }
  }
});

test("RF-008 unauthenticated requests always return the login decision", () => {
  assert.equal(
    decideInternalAccess({ authenticated: false, role: null, userType: "SUPER_ADMIN" }),
    "login",
  );
});
