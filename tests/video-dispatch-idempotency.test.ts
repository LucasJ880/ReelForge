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

  const body = { ok: true, briefId: "brief-1" };
  const completed = await completeVideoDispatchRequest({
    requestId: String(row.id),
    status: 200,
    body,
  });
  assert.equal(completed.count, 1);

  const replay = await claimVideoDispatchRequest({
    userId: "user-1",
    idempotencyKey: "stable-key",
    requestHash: "hash-1",
  });
  assert.deepEqual(replay, { outcome: "replay", status: 200, body });

  const conflict = await claimVideoDispatchRequest({
    userId: "user-1",
    idempotencyKey: "stable-key",
    requestHash: "different-hash",
  });
  assert.deepEqual(conflict, { outcome: "conflict" });
});
