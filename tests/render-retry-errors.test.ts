import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { __test__ as authTest } from "../src/lib/auth";
import {
  customerApiErrorSchema,
  isCustomerRecoverySemanticallyValid,
} from "../src/lib/contracts/customer-api";
import { POST as renderRetry } from "../src/app/api/briefs/[id]/render-retry/route";

/**
 * P05-D（链 T）：render-retry 的 404 / 403 / 400 必须用客户契约里的真实错误码
 * （RESOURCE_NOT_FOUND / FORBIDDEN / VALIDATION_FAILED），不再一律 INTERNAL_ERROR——
 * 客户端按 code 分流，INTERNAL_ERROR 会被当成「稍后重试」。
 *
 * 全部 patch next-auth 与 Prisma：不连库、不提交任何任务。
 */

const require = createRequire(import.meta.url);
const nextAuthRuntime = require("next-auth/next") as Record<string, unknown>;

function patch(t: TestContext, target: object, values: Record<string, unknown>) {
  const record = target as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = record[key];
    record[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) record[key] = value;
  });
}

const SESSION = {
  user: { id: "customer-1", email: "owner@shop.test", role: "CUSTOMER", userType: "PERSONAL" },
  expires: "2099-01-01T00:00:00.000Z",
};

function signIn(t: TestContext) {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  patch(t, nextAuthRuntime, { getServerSession: async () => structuredClone(SESSION) });
  patch(t, db.adminUser, {
    findUnique: async () => ({ role: "CUSTOMER", userType: "PERSONAL", disabledAt: null, email: SESSION.user.email }),
  });
}

function request(briefId: string, body: unknown) {
  return renderRetry(
    new NextRequest(`http://localhost/api/briefs/${briefId}/render-retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: briefId }) },
  );
}

async function contractBody(response: Response) {
  const body = customerApiErrorSchema.parse(await response.json());
  assert.ok(
    isCustomerRecoverySemanticallyValid({ code: body.code, retryable: body.retryable, action: body.action }),
    `${body.code} 的 retryable/action 组合必须在契约允许表里`,
  );
  return body;
}

test("P05-D：brief 不存在 → 404 RESOURCE_NOT_FOUND", async (t) => {
  signIn(t);
  patch(t, db.videoBrief, { findUnique: async () => null });
  const response = await request("missing-brief", { all: true });
  assert.equal(response.status, 404);
  const body = await contractBody(response);
  assert.equal(body.code, "RESOURCE_NOT_FOUND");
  assert.equal(body.action, "contact_support");
});

test("P05-D：别人的 brief → 403 FORBIDDEN", async (t) => {
  signIn(t);
  patch(t, db.videoBrief, {
    findUnique: async () => ({
      id: "brief-of-someone-else",
      persona: "PERSONAL",
      contentAngle: { round: { deliveryOrder: { createdById: "customer-2" } } },
    }),
  });
  const response = await request("brief-of-someone-else", { all: true });
  assert.equal(response.status, 403);
  const body = await contractBody(response);
  assert.equal(body.code, "FORBIDDEN");
});

test("P05-D：body 既没 jobId 也没 all → 400 VALIDATION_FAILED（fix_request）", async (t) => {
  signIn(t);
  patch(t, db.videoBrief, {
    findUnique: async () => ({
      id: "brief-1",
      persona: "PERSONAL",
      contentAngle: { round: { deliveryOrder: { createdById: "customer-1" } } },
    }),
  });
  const response = await request("brief-1", {});
  assert.equal(response.status, 400);
  const body = await contractBody(response);
  assert.equal(body.code, "VALIDATION_FAILED");
  assert.equal(body.action, "fix_request");
});

test("P05-D：jobId 不属于该 brief → 404 RESOURCE_NOT_FOUND", async (t) => {
  signIn(t);
  patch(t, db.videoBrief, {
    findUnique: async () => ({
      id: "brief-1",
      persona: "PERSONAL",
      contentAngle: { round: { deliveryOrder: { createdById: "customer-1" } } },
    }),
  });
  patch(t, db.videoJob, { findUnique: async () => ({ id: "job-x", videoBriefId: "other-brief", status: "FAILED" }) });
  const response = await request("brief-1", { jobId: "job-x" });
  assert.equal(response.status, 404);
  const body = await contractBody(response);
  assert.equal(body.code, "RESOURCE_NOT_FOUND");
});
