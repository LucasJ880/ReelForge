import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import { evaluateDispatchBreaker } from "../src/lib/services/dispatch-breaker";
import { __test__ as batchTest } from "../src/lib/services/batch-service";

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

test("AC-B5：高 Provider 失败率触发暂停，成功样本注入后自动恢复", async (t) => {
  const originalEnabled = process.env.DISPATCH_BREAKER_ENABLED;
  const originalThreshold = process.env.DISPATCH_BREAKER_UNHEALTHY_RATE;
  process.env.DISPATCH_BREAKER_ENABLED = "true";
  process.env.DISPATCH_BREAKER_UNHEALTHY_RATE = "0.8";
  t.after(() => {
    if (originalEnabled == null) delete process.env.DISPATCH_BREAKER_ENABLED;
    else process.env.DISPATCH_BREAKER_ENABLED = originalEnabled;
    if (originalThreshold == null) {
      delete process.env.DISPATCH_BREAKER_UNHEALTHY_RATE;
    } else {
      process.env.DISPATCH_BREAKER_UNHEALTHY_RATE = originalThreshold;
    }
  });

  let recovered = false;
  const videoModel = db.videoJob as unknown as Record<string, unknown>;
  const batchModel = db.batchJob as unknown as Record<string, unknown>;
  const prisma = db as unknown as Record<string, unknown>;
  const videoWrites: Array<Record<string, unknown>> = [];
  const batchWrites: Array<Record<string, unknown>> = [];
  patch(t, videoModel, {
    findMany: async () =>
      recovered
        ? [
            ...Array.from({ length: 3 }, () => ({
              status: VideoJobStatus.FAILED,
              errorMessage: "[provider:failed] injected outage",
            })),
            ...Array.from({ length: 7 }, () => ({
              status: VideoJobStatus.SUCCEEDED,
              errorMessage: null,
            })),
          ]
        : [
            ...Array.from({ length: 3 }, () => ({
              status: VideoJobStatus.FAILED,
              errorMessage: "[provider:failed] injected outage",
            })),
            { status: VideoJobStatus.RUNNING, errorMessage: null },
          ],
    updateMany: async (args: Record<string, unknown>) => {
      videoWrites.push(args);
      return { count: 97 };
    },
  });
  patch(t, batchModel, {
    update: async (args: Record<string, unknown>) => {
      batchWrites.push(args);
      return {};
    },
    updateMany: async (args: Record<string, unknown>) => {
      batchWrites.push(args);
      return { count: 1 };
    },
  });
  patch(t, prisma, {
    $transaction: async (promises: Promise<unknown>[]) => Promise.all(promises),
  });

  const open = await evaluateDispatchBreaker();
  assert.equal(open.state, "open");
  assert.equal(open.sample.providerFailed, 3);
  await batchTest.applyBreaker("batch_ac_b5", open);
  assert.equal(
    (videoWrites[0].data as { status: string }).status,
    VideoJobStatus.PAUSED,
  );

  recovered = true;
  const closed = await evaluateDispatchBreaker();
  assert.equal(closed.state, "closed");
  await batchTest.applyBreaker("batch_ac_b5", closed);
  assert.equal(
    (videoWrites[1].data as { status: string }).status,
    VideoJobStatus.QUEUED,
  );
});
