import assert from "node:assert/strict";
import test from "node:test";

import { createProductImageTaskRetryPostHandler } from "../src/app/api/product-images/tasks/[taskId]/retry/route";

test("authenticated owner can retry only an eligible rejected provider task", async () => {
  const calls: Array<{ taskId: string; userId: string }> = [];
  const handler = createProductImageTaskRetryPostHandler({
    requireAuth: async () => ({ ok: true, session: { user: { id: "owner-1" } } as never }),
    retryTask: async (taskId, userId) => {
      calls.push({ taskId, userId });
      return {
        id: "job-1",
        status: "PROCESSING",
        sourceAsset: null,
        outputs: [],
        providerTasks: [],
        createdAt: new Date(),
      } as never;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/product-images/tasks/task-2/retry", { method: "POST" }) as never,
    { params: Promise.resolve({ taskId: "task-2" }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ taskId: "task-2", userId: "owner-1" }]);
  assert.equal((await response.json()).job.id, "job-1");
});

test("retry route does not disclose foreign or ineligible tasks", async () => {
  const handler = createProductImageTaskRetryPostHandler({
    requireAuth: async () => ({ ok: true, session: { user: { id: "owner-1" } } as never }),
    retryTask: async () => null,
  });
  const response = await handler(
    new Request("http://localhost/api/product-images/tasks/foreign/retry", { method: "POST" }) as never,
    { params: Promise.resolve({ taskId: "foreign" }) },
  );
  assert.equal(response.status, 404);
});
