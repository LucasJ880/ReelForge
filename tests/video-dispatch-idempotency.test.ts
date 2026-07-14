import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  Prisma,
  VideoDispatchRequestState,
} from "@prisma/client";
import { db } from "../src/lib/db";
import {
  claimVideoDispatchRequest,
  completeVideoDispatchRequest,
  hashVideoDispatchRequest,
  markVideoDispatchQuotaConsumed,
  validateIdempotencyKey,
} from "../src/lib/services/video-dispatch-idempotency";
import { toCustomerVideoDispatchResponse } from "../src/lib/api/customer-video-dispatch";

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

test("RF-003 request hash is stable across object key order and validates bounded keys", () => {
  assert.equal(
    hashVideoDispatchRequest({ request: { b: 2, a: [1, { z: true, y: null }] } }),
    hashVideoDispatchRequest({ request: { a: [1, { y: null, z: true }], b: 2 } }),
  );
  assert.equal(validateIdempotencyKey("dispatch_abc-123"), "dispatch_abc-123");
  assert.equal(validateIdempotencyKey(" bad"), null);
  assert.equal(validateIdempotencyKey("x".repeat(201)), null);
});

test("RF-003 concurrent duplicate dispatch claims have one winner and no duplicate quota owner", async (t) => {
  let row: Record<string, unknown> | null = null;
  let creates = 0;
  const model = db.videoDispatchRequest as unknown as Record<string, unknown>;
  patch(t, model, {
    findUnique: async () => (row ? { ...row } : null),
    create: async (args: { data: Record<string, unknown> }) => {
      creates += 1;
      if (row) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "6.19.3",
          meta: { target: ["userId", "idempotencyKey"] },
        });
      }
      row = {
        id: "dispatch-request-1",
        state: VideoDispatchRequestState.PROCESSING,
        responseStatus: null,
        responseBody: null,
        quotaConsumedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      };
      return { ...row };
    },
  });

  const claims = await Promise.all(
    Array.from({ length: 3 }, () =>
      claimVideoDispatchRequest({
        userId: "user-1",
        idempotencyKey: "same-key",
        requestHash: "same-hash",
      }),
    ),
  );

  assert.equal(creates, 3, "并发请求都可能尝试 INSERT，但唯一约束只能产生一行");
  assert.equal(claims.filter((claim) => claim.outcome === "acquired").length, 1);
  assert.equal(claims.filter((claim) => claim.outcome === "in_progress").length, 2);
});

test("RF-003 completed response replays exactly; same key with another body conflicts", async (t) => {
  const row: Record<string, unknown> = {
    id: "dispatch-request-2",
    userId: "user-1",
    idempotencyKey: "stable-key",
    requestHash: "hash-1",
    state: VideoDispatchRequestState.PROCESSING,
    responseStatus: null,
    responseBody: null,
    quotaConsumedAt: null,
  };
  const model = db.videoDispatchRequest as unknown as Record<string, unknown>;
  patch(t, model, {
    findUnique: async () => ({ ...row }),
    updateMany: async (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (
        args.where.state &&
        args.where.state !== row.state
      ) {
        return { count: 0 };
      }
      if (args.where.quotaConsumedAt === null && row.quotaConsumedAt != null) {
        return { count: 0 };
      }
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });

  const quota = await markVideoDispatchQuotaConsumed(String(row.id));
  assert.equal(quota.count, 1);
  assert.ok(row.quotaConsumedAt instanceof Date);

  const body = {
    ok: true,
    deliveryOrderId: "order-1",
    briefId: "brief-1",
    videoJobs: [
      {
        id: "job-1",
        status: "RUNNING",
        provider: "LEAK_PERSISTED_PROVIDER",
        externalJobId: "LEAK_PERSISTED_EXTERNAL_ID",
        providerRequestKey: "LEAK_PERSISTED_REQUEST_KEY",
        promptText: "LEAK_PERSISTED_PROMPT",
        errorMessage: "LEAK_PERSISTED_ERROR",
      },
    ],
    batch: [{ briefId: "brief-1", deliveryOrderId: "order-1" }],
    planPreview: {
      summary: "1 AI clip, 15 second vertical video",
      breakdown: {
        aiClipCount: 1,
        uploadedClipCount: 0,
        hasBrandEndCard: false,
        finalDurationSec: 15,
        aspectRatio: "9:16",
      },
    },
    nextUrl: "/app/library?highlight=order-1",
    userStatus: {
      status: "generating",
      label: "AI 正在生成画面",
      shortLabel: "生成中",
      progressHint: 0.2,
      cta: null,
      assemblingPhase: null,
    },
  };
  const safeBody = toCustomerVideoDispatchResponse(body);
  const completed = await completeVideoDispatchRequest({
    requestId: String(row.id),
    status: 200,
    body,
  });
  assert.equal(completed.count, 1);
  assert.deepEqual(row.responseBody, safeBody);
  assert.doesNotMatch(JSON.stringify(row.responseBody), /LEAK_PERSISTED/);

  const replay = await claimVideoDispatchRequest({
    userId: "user-1",
    idempotencyKey: "stable-key",
    requestHash: "hash-1",
  });
  assert.deepEqual(replay, { outcome: "replay", status: 200, body: safeBody });

  const conflict = await claimVideoDispatchRequest({
    userId: "user-1",
    idempotencyKey: "stable-key",
    requestHash: "different-hash",
  });
  assert.deepEqual(conflict, { outcome: "conflict" });
});

test("RF-003 corrupt success replay is nonretryable and never returns HTTP success", async (t) => {
  const model = db.videoDispatchRequest as unknown as Record<string, unknown>;
  patch(t, model, {
    findUnique: async () => ({
      id: "dispatch-request-corrupt-replay",
      userId: "user-1",
      idempotencyKey: "corrupt-replay-key",
      requestHash: "corrupt-replay-hash",
      state: VideoDispatchRequestState.COMPLETED,
      responseStatus: 200,
      responseBody: { ok: true },
      quotaConsumedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  });

  const replay = await claimVideoDispatchRequest({
    userId: "user-1",
    idempotencyKey: "corrupt-replay-key",
    requestHash: "corrupt-replay-hash",
  });
  assert.deepEqual(replay, {
    outcome: "replay",
    status: 409,
    body: {
      ok: false,
      code: "SUBMISSION_ACK_UNKNOWN",
      error:
        "生成结果记录不完整。为避免重复计费，系统已停止重试，请联系支持核对。",
      retryable: false,
      action: "contact_support",
    },
  });
});

test("RF-003 corrupt new success is persisted as failed instead of completed", async (t) => {
  const persistedWrites: Array<Record<string, unknown>> = [];
  patch(t, db.videoDispatchRequest as unknown as Record<string, unknown>, {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      persistedWrites.push(args.data);
      return { count: 1 };
    },
  });

  await completeVideoDispatchRequest({
    requestId: "dispatch-request-corrupt-new",
    status: 200,
    body: { ok: true },
  });
  assert.equal(persistedWrites.length, 1);
  const persisted = persistedWrites[0];
  assert.equal(persisted.state, VideoDispatchRequestState.FAILED);
  assert.equal(persisted.responseStatus, 409);
  assert.deepEqual(persisted.responseBody, {
    ok: false,
    code: "SUBMISSION_ACK_UNKNOWN",
    error:
      "生成结果记录不完整。为避免重复计费，系统已停止重试，请联系支持核对。",
    retryable: false,
    action: "contact_support",
  });
});

test("RF-035 quota and response CAS misses fail closed", async (t) => {
  patch(t, db.videoDispatchRequest as unknown as Record<string, unknown>, {
    updateMany: async () => ({ count: 0 }),
  });

  await assert.rejects(
    () => markVideoDispatchQuotaConsumed("lost-quota-owner"),
    /quota ownership marker was not persisted/,
  );
  await assert.rejects(
    () =>
      completeVideoDispatchRequest({
        requestId: "lost-response-owner",
        status: 200,
        body: { ok: true, briefId: "brief-never-persisted" },
      }),
    /dispatch response was not persisted/,
  );
});
