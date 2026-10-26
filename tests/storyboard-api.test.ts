import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("storyboard APIs are owner-scoped and expose create, status, regenerate, and approval", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/app/api/video-generation/storyboards/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/video-generation/storyboards/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/video-generation/storyboards/[id]/approve/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/video-generation/storyboards/[id]/frames/[frameId]/regenerate/route.ts", import.meta.url), "utf8"),
  ]);
  const source = files.join("\n");
  assert.match(source, /createStoryboardRun/);
  assert.match(source, /reconcileStoryboardRun/);
  assert.match(source, /approveStoryboard/);
  assert.match(source, /regenerateStoryboardFrame/);
  assert.match(source, /session\.user\.id/);
});

test("the storyboard collection route exposes an owner-scoped resume entry point", async () => {
  const route = await readFile(
    new URL("../src/app/api/video-generation/storyboards/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /export async function GET/);
  assert.match(route, /findResumableStoryboardRunForUser\(guard\.session\.user\.id\)/);

  const service = await readFile(
    new URL("../src/lib/video-generation/storyboard-service.ts", import.meta.url),
    "utf8",
  );
  // Resume only surfaces runs that were never attached to a video and stays
  // inside a bounded window, so stale runs cannot hijack a fresh visit.
  assert.match(service, /videoBriefId: null/);
  assert.match(service, /videoJobId: null/);
  assert.match(service, /STORYBOARD_RESUME_WINDOW_MS/);
});

test("video dispatch requires an approved storyboard before provider submission", async () => {
  const route = await readFile(
    new URL("../src/app/api/video-generation/dispatch/route.ts", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../src/lib/services/video-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /storyboardRunId/);
  assert.match(route, /getApprovedStoryboardVideoReferences/);
  assert.match(route, /dispatchReservationKey: dispatchRequestId/);
  // round 1025 · A2 3.4：派发取「实拍在前 + 已确认故事板帧」，仍以已确认故事板为前提。
  assert.match(service, /requireApprovedStoryboardVideo(?:References|Inputs)ForBrief/);
});

/**
 * P02-D(s) · 主播参考图契约：`personAssetIds` ≤4；开关 STORYBOARD_PERSON_REFS（默认 off）决定谁能传。
 * 依赖注入：不触鉴权与 DB，createStoryboardRun 用替身记录收到的入参。
 */
import { createStoryboardPostHandler } from "../src/app/api/video-generation/storyboards/route";

function storyboardSession(role: "CUSTOMER" | "OPERATOR" | "SUPER_ADMIN") {
  return async () => ({
    ok: true as const,
    session: { user: { id: "user-1", email: "merchant@example.test", role } } as never,
  });
}

function storyboardRequest(body: unknown): Request {
  return new Request("http://localhost/api/video-generation/storyboards", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  prompt: "Show the shade lowering over a sunny window at breakfast time",
  durationSec: 15,
  aspectRatio: "9:16",
  sourceAssetIds: ["asset-1"],
};

function storyboardHarness(options: {
  mode: "off" | "internal" | "on";
  role?: "CUSTOMER" | "OPERATOR" | "SUPER_ADMIN";
}) {
  const received: Array<Record<string, unknown>> = [];
  const handler = createStoryboardPostHandler({
    requireAuth: storyboardSession(options.role ?? "CUSTOMER") as never,
    personRefsMode: () => options.mode,
    createStoryboardRun: (async (input: Record<string, unknown>) => {
      received.push(input);
      return { id: "run-1", status: "GENERATING", frames: [] } as never;
    }) as never,
  });
  return { handler, received };
}

test("personAssetIds：路由只做形状校验并算好 personRefsAllowed；开关 off 时非空也进 service（由 service 在幂等回放之后给 400）", async () => {
  const h = storyboardHarness({ mode: "off" });
  const response = await h.handler(storyboardRequest({ ...validBody, personAssetIds: ["person-1"] }) as never);
  assert.equal(response.status, 201);
  assert.equal(h.received.length, 1);
  assert.deepEqual(h.received[0].personAssetIds, ["person-1"]);
  assert.equal(h.received[0].personRefsAllowed, false);
});

test("personAssetIds：省略或空数组照常创建，service 收到空数组与 personRefsAllowed=false（开关 off）", async () => {
  const h = storyboardHarness({ mode: "off" });
  const omitted = await h.handler(storyboardRequest(validBody) as never);
  assert.equal(omitted.status, 201);
  const empty = await h.handler(storyboardRequest({ ...validBody, personAssetIds: [] }) as never);
  assert.equal(empty.status, 201);
  assert.equal(h.received.length, 2);
  assert.deepEqual(h.received[0].personAssetIds, []);
  assert.deepEqual(h.received[1].personAssetIds, []);
  assert.equal(h.received[0].personRefsAllowed, false);
  assert.equal(h.received[0].userInitiated, true);
});

test("personAssetIds：开关 on 时 ≤4 张原样传给 service 且 personRefsAllowed=true；第 5 张被 zod 拒绝", async () => {
  const h = storyboardHarness({ mode: "on" });
  const four = ["p1", "p2", "p3", "p4"];
  const accepted = await h.handler(storyboardRequest({ ...validBody, personAssetIds: four }) as never);
  assert.equal(accepted.status, 201);
  assert.deepEqual(h.received[0].personAssetIds, four, "保留原始顺序（首张 = 主播）");
  assert.equal(h.received[0].personRefsAllowed, true);
  assert.deepEqual(h.received[0].sourceAssetIds, ["asset-1"]);

  const rejected = await h.handler(
    storyboardRequest({ ...validBody, personAssetIds: [...four, "p5"] }) as never,
  );
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "VALIDATION_FAILED");
  assert.equal(h.received.length, 1);
});

test("personAssetIds：开关 internal 时只有内部员工放行（SUPER_ADMIN / OPERATOR），客户账号 personRefsAllowed=false", async () => {
  const customer = storyboardHarness({ mode: "internal", role: "CUSTOMER" });
  await customer.handler(storyboardRequest({ ...validBody, personAssetIds: ["p1"] }) as never);
  assert.equal(customer.received[0].personRefsAllowed, false);

  for (const role of ["OPERATOR", "SUPER_ADMIN"] as const) {
    const staff = storyboardHarness({ mode: "internal", role });
    await staff.handler(storyboardRequest({ ...validBody, personAssetIds: ["p1"] }) as never);
    assert.equal(staff.received[0].personRefsAllowed, true, role);
  }
});

test("统一创作路由（/plan、/dispatch）的 userAssignedRole=person 受同一个开关控制（静态接线）", async () => {
  const [plan, dispatch] = await Promise.all([
    readFile(new URL("../src/app/api/video-generation/plan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/video-generation/dispatch/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [plan, dispatch]) {
    assert.match(source, /hasPersonTaggedAttachment\(/);
    assert.match(source, /canSubmitStoryboardPersonRefs\(/);
    // plan 路由走依赖注入（dependencies.personRefsMode()），dispatch 直接调模块函数
    assert.match(source, /(?:storyboardPersonRefsMode|personRefsMode)\(\)/);
  }
});
