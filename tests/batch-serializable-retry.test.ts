import assert from "node:assert/strict";
import { test } from "node:test";
import { __test__ } from "../src/lib/services/batch-service";

test("批次 claim：可重试写冲突使用有界退避后成功", async () => {
  let attempts = 0;
  const result = await __test__.withSerializableRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("Transaction failed due to a write conflict or a deadlock");
    }
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("批次 claim：非事务冲突不得被吞掉或重试", async () => {
  let attempts = 0;
  await assert.rejects(
    __test__.withSerializableRetry(async () => {
      attempts += 1;
      throw new Error("provider request failed");
    }),
    /provider request failed/,
  );
  assert.equal(attempts, 1);
});

test("批次 claim：持续冲突最多重试三次", async () => {
  let attempts = 0;
  await assert.rejects(
    __test__.withSerializableRetry(async () => {
      attempts += 1;
      throw new Error("write conflict");
    }),
    /write conflict/,
  );
  assert.equal(attempts, 4);
});
