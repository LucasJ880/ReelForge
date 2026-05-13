import assert from "node:assert/strict";
import test from "node:test";
import { decideBriefAccess } from "../src/lib/services/brief-access";

/**
 * Phase 6 — brief 访问控制矩阵。
 * 测试纯决策函数（无 db）；checkBriefAccess 的 IO wrapper 在集成测试覆盖。
 *
 * 表格（行=调用方，列=brief 状态）：
 *
 *   caller                    own brief    other PERSONAL    other BUSINESS    not-found
 *   ──────────────────────────────────────────────────────────────────────────────────────
 *   PERSONAL self            allow:owner  forbidden          forbidden          not-found
 *   BUSINESS self            allow:owner  forbidden          forbidden          not-found
 *   internal OPERATOR        allow:staff  allow:staff        allow:staff        allow:staff
 *   internal SUPER_ADMIN     allow:staff  allow:staff        allow:staff        allow:staff
 *   未登录                    forbidden    forbidden          forbidden          not-found
 */

test("PERSONAL 用户访问自己的 PERSONAL brief：allow / owner", () => {
  const r = decideBriefAccess({
    callerUserId: "user-1",
    callerUserType: "PERSONAL",
    ownerUserId: "user-1",
    ownerPersona: "PERSONAL",
    briefId: "brief-x",
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "owner");
});

test("PERSONAL 用户访问别人的 brief：forbidden", () => {
  const r = decideBriefAccess({
    callerUserId: "user-1",
    callerUserType: "PERSONAL",
    ownerUserId: "user-2",
    ownerPersona: "PERSONAL",
    briefId: "brief-x",
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "forbidden");
});

test("BUSINESS 用户访问自己的 BUSINESS brief：allow / owner", () => {
  const r = decideBriefAccess({
    callerUserId: "user-1",
    callerUserType: "BUSINESS",
    ownerUserId: "user-1",
    ownerPersona: "BUSINESS",
    briefId: "brief-x",
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "owner");
});

test("BUSINESS 用户访问自己的 PERSONAL brief（persona 错配）：forbidden", () => {
  /// 防御：同一账号在 db 里被改 persona，BUSINESS session 不能看到自己以前
  /// 创建的 PERSONAL brief（quota / UI 渲染不同；分清楚）
  const r = decideBriefAccess({
    callerUserId: "user-1",
    callerUserType: "BUSINESS",
    ownerUserId: "user-1",
    ownerPersona: "PERSONAL",
    briefId: "brief-x",
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "forbidden");
});

test("OPERATOR 内部 staff：always allow（含 not-found 也允许；让 caller 区分）", () => {
  for (const persona of ["BUSINESS", "PERSONAL", null] as const) {
    const r = decideBriefAccess({
      callerUserId: "ops-1",
      callerUserType: "OPERATOR",
      ownerUserId: "user-1",
      ownerPersona: persona,
      briefId: "brief-x",
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "internal-staff");
  }
});

test("SUPER_ADMIN：always allow", () => {
  const r = decideBriefAccess({
    callerUserId: "super-1",
    callerUserType: "SUPER_ADMIN",
    ownerUserId: "user-1",
    ownerPersona: "PERSONAL",
    briefId: "brief-x",
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "internal-staff");
});

test("brief 不存在 + caller 是客户：not-found", () => {
  const r = decideBriefAccess({
    callerUserId: "user-1",
    callerUserType: "PERSONAL",
    ownerUserId: null,
    ownerPersona: null,
    briefId: "brief-x",
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "not-found");
});

test("无 callerUserId（理论上 requireAuth 已挡住）：forbidden 兜底", () => {
  const r = decideBriefAccess({
    callerUserId: null,
    callerUserType: "PERSONAL",
    ownerUserId: "user-1",
    ownerPersona: "PERSONAL",
    briefId: "brief-x",
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "forbidden");
});

test("老 brief（persona=null）+ owner 一致：allow（兼容历史数据）", () => {
  const r = decideBriefAccess({
    callerUserId: "user-1",
    callerUserType: "PERSONAL",
    ownerUserId: "user-1",
    ownerPersona: null,
    briefId: "legacy-brief",
  });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "owner");
});
