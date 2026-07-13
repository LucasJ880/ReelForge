import assert from "node:assert/strict";
import test from "node:test";
import { decideBriefAccess } from "../src/lib/services/brief-access";

function decide(overrides: Partial<Parameters<typeof decideBriefAccess>[0]> = {}) {
  return decideBriefAccess({
    callerUserId: "user-1",
    callerRole: "CUSTOMER",
    ownerUserId: "user-1",
    ownerPersona: "PERSONAL",
    briefId: "brief-x",
    ...overrides,
  });
}

test("CUSTOMER owner 可访问自己的 brief，plan/persona 不参与授权", () => {
  for (const ownerPersona of ["PERSONAL", "BUSINESS", null] as const) {
    const result = decide({ ownerPersona });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, "owner");
  }
});

test("CUSTOMER 访问其他 workspace/owner 的 brief：forbidden", () => {
  const result = decide({ ownerUserId: "user-2", ownerPersona: "BUSINESS" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "forbidden");
});

test("OPERATOR/SUPER_ADMIN 显式系统角色保留受信任 bypass", () => {
  for (const callerRole of ["OPERATOR", "SUPER_ADMIN"] as const) {
    const result = decide({ callerRole, callerUserId: "staff-1", ownerUserId: "user-2" });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, "internal-staff");
  }
});

test("REVIEWER 不获得 ownership bypass", () => {
  const result = decide({ callerRole: "REVIEWER", callerUserId: "reviewer-1", ownerUserId: "user-2" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "forbidden");
});

test("brief 不存在对客户返回 not-found", () => {
  const result = decide({ ownerUserId: null, ownerPersona: null });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not-found");
});

test("缺 callerUserId 时 fail-closed", () => {
  const result = decide({ callerUserId: null });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "forbidden");
});
