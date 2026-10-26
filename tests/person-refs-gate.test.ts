/**
 * P02-D(s) · 主播参考图开关 STORYBOARD_PERSON_REFS 的门不能被绕过：
 * - 门按生效角色（userAssignedRole ?? inferredRole）判断，与文字锚同一判据；
 * - 新建请求的 inferredRole 不接受 person（分类器从不推断它），客户端填了直接 400；
 * - /plan 路由级：mode=internal + 客户账号 + person → 400，不进 buildPlan；内部员工放行。
 * 依赖注入，不触鉴权 / DB / 供应商。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createPlanPostHandler } from "../src/app/api/video-generation/plan/route";
import {
  ownedCreationAssetSchema,
  unifiedVideoGenerationRequestSchema,
} from "../src/lib/schemas/unified-input";
import { hasPersonTaggedAttachment } from "../src/lib/video-generation/storyboard-person-refs";

test("hasPersonTaggedAttachment 看生效角色：inferredRole=person 也算；userAssignedRole 覆盖 inferredRole", () => {
  assert.equal(hasPersonTaggedAttachment([{ inferredRole: "person" }]), true);
  assert.equal(hasPersonTaggedAttachment([{ inferredRole: "reference_image", userAssignedRole: "person" }]), true);
  assert.equal(hasPersonTaggedAttachment([{ inferredRole: "person", userAssignedRole: "product_image" }]), false);
  assert.equal(hasPersonTaggedAttachment([{ inferredRole: "product_image" }, { userAssignedRole: null }]), false);
});

const attachment = {
  assetId: "asset-1",
  inferredRole: "reference_image",
  roleConfidence: 0.6,
  fileName: "presenter.jpg",
};

test("新建请求 schema：inferredRole=person 被拒绝；userAssignedRole=person 仍可表达（由开关决定放行）", () => {
  assert.equal(ownedCreationAssetSchema.safeParse({ ...attachment, inferredRole: "person" }).success, false);
  assert.equal(ownedCreationAssetSchema.safeParse({ ...attachment, userAssignedRole: "person" }).success, true);
  assert.equal(ownedCreationAssetSchema.safeParse(attachment).success, true);
});

const validRequest = {
  userType: "business",
  rawPrompt: "Show the shade lowering over a sunny window at breakfast time.",
  attachments: [{ ...attachment, userAssignedRole: "person" }],
  selectedDuration: 15,
  selectedAspectRatio: "9:16",
  selectedBrandEndingMode: "none",
};

test("fixture 本身通过统一请求 schema（否则下面的 400 就不是门给的）", () => {
  assert.equal(unifiedVideoGenerationRequestSchema.safeParse(validRequest).success, true);
});

function planHarness(options: { mode: "off" | "internal" | "on"; role: "CUSTOMER" | "OPERATOR" | "SUPER_ADMIN" }) {
  const calls: string[] = [];
  const handler = createPlanPostHandler({
    requireUserOfTypeForGeneration: (async () => ({
      ok: true as const,
      session: { user: { id: "user-1", email: "merchant@example.test", role: options.role } },
    })) as never,
    canUseRequestedBrandName: async () => true,
    personRefsMode: () => options.mode,
    resolveOwnedCreationRequest: (async ({ request }: { request: Record<string, unknown> }) => {
      calls.push("resolve");
      return request;
    }) as never,
    assertQuotaForSession: (async () => { calls.push("quota"); }) as never,
    buildPlan: (async () => {
      calls.push("buildPlan");
      return { stub: true };
    }) as never,
  });
  return { handler, calls };
}

function planRequest(body: unknown): Request {
  return new Request("http://localhost/api/video-generation/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("/plan：mode=internal、客户账号、inferredRole=person → 400（schema 拒绝），不进 buildPlan", async () => {
  const h = planHarness({ mode: "internal", role: "CUSTOMER" });
  const response = await h.handler(planRequest({
    ...validRequest,
    attachments: [{ ...attachment, inferredRole: "person" }],
  }) as never);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "请求参数不合法");
  assert.deepEqual(h.calls, []);
});

test("/plan：mode=internal、客户账号、userAssignedRole=person → 400（开关门），不进 buildPlan", async () => {
  const h = planHarness({ mode: "internal", role: "CUSTOMER" });
  const response = await h.handler(planRequest(validRequest) as never);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /主播参考图暂未开放/);
  assert.deepEqual(h.calls, []);
});

test("/plan：mode=internal 的内部员工、mode=on 的客户账号 → 放行到 buildPlan；mode=off 一律 400", async () => {
  for (const role of ["OPERATOR", "SUPER_ADMIN"] as const) {
    const staff = planHarness({ mode: "internal", role });
    const response = await staff.handler(planRequest(validRequest) as never);
    assert.equal(response.status, 200, role);
    assert.deepEqual(staff.calls, ["resolve", "quota", "buildPlan"]);
  }
  const open = planHarness({ mode: "on", role: "CUSTOMER" });
  assert.equal((await open.handler(planRequest(validRequest) as never)).status, 200);
  assert.deepEqual(open.calls, ["resolve", "quota", "buildPlan"]);

  const closed = planHarness({ mode: "off", role: "SUPER_ADMIN" });
  assert.equal((await closed.handler(planRequest(validRequest) as never)).status, 400);
  assert.deepEqual(closed.calls, []);

  // 没有主播素材的请求不受开关影响
  const plain = planHarness({ mode: "off", role: "CUSTOMER" });
  assert.equal((await plain.handler(planRequest({ ...validRequest, attachments: [attachment] }) as never)).status, 200);
});
