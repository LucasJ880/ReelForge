import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  ProductImageRequestError,
  cancelProductImageJob,
} from "../src/lib/services/product-image-service";

/**
 * A4 5.5：产品图取消加 CAS。
 * （A4 5.6 的本周内容兜底文案用例随「本周内容」2026-11-16 删除。）
 */

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

function installProductImageCancel(
  t: TestContext,
  options: { jobClaimCount: number },
) {
  const log: Array<{ op: string; args: unknown }> = [];
  const tx = {
    productImageJob: {
      updateMany: async (args: unknown) => {
        log.push({ op: "job.updateMany", args });
        return { count: options.jobClaimCount };
      },
    },
    productImageProviderTask: {
      updateMany: async (args: unknown) => {
        log.push({ op: "task.updateMany", args });
        return { count: 1 };
      },
    },
  };
  patch(t, db, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  });
  patch(t, db.productImageJob, {
    findFirst: async (args: { select?: unknown }) => {
      if (args.select) {
        return { id: "job-1", status: "PROCESSING", idempotencyKey: "key-1" };
      }
      return { id: "job-1", status: "CANCELLED" };
    },
  });
  return log;
}

test("🔴 产品图取消 CAS：读完状态后 poll 抢先收成 SUCCEEDED，取消不能把成功覆盖掉", async (t) => {
  const log = installProductImageCancel(t, { jobClaimCount: 0 });
  await assert.rejects(
    cancelProductImageJob({ jobId: "job-1", userId: "user-1" }),
    (err: unknown) =>
      err instanceof ProductImageRequestError && err.status === 409 && err.code === "INVALID_STATE",
  );
  const claim = log.find((entry) => entry.op === "job.updateMany")?.args as {
    where: { status: { in: string[] }; userId: string };
  };
  assert.deepEqual(claim.where.status.in.sort(), ["PROCESSING", "QUEUED"], "写入必须带源状态条件");
  assert.equal(claim.where.userId, "user-1");
  assert.ok(
    !log.some((entry) => entry.op === "task.updateMany"),
    "抢输了就不能再动 provider task",
  );
});

test("产品图取消 CAS 抢到：任务与未终态 provider task 一起改已取消，幂等键改写", async (t) => {
  const log = installProductImageCancel(t, { jobClaimCount: 1 });
  const job = await cancelProductImageJob({ jobId: "job-1", userId: "user-1" });
  assert.equal(job.status, "CANCELLED");
  const claim = log.find((entry) => entry.op === "job.updateMany")?.args as {
    data: { status: string; idempotencyKey: string };
  };
  assert.equal(claim.data.status, "CANCELLED");
  assert.match(claim.data.idempotencyKey, /^cancelled:\d+:key-1$/);
  assert.ok(log.some((entry) => entry.op === "task.updateMany"));
});
