import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPERIMENT_BATCH_KEY_PREFIX,
  isExperimentBatchKey,
  notExperimentBatchWhere,
} from "../src/lib/experiments/run-key";

/**
 * X-SCAF-0：实验批次（BatchJob.idempotencyKey 以 exp-2611- 开头）走生产批量管线写库，
 * 但不是商家的生成质量、也不是平台故障。
 *
 * 用到这个前缀的两处平台读数都已删除（2026-11-16）：创始人日报的失败视频
 *（platformBatchFailureWhere）与战绩页的一次通过率（notExperimentVideoJobWhere 是它的 where 片段）。
 * 这里只剩运行键本身：压测脚本（scripts/lib/soak-run.ts）沿用同一个前缀，约定不能悄悄变。
 */

test("运行键：前缀固定为 exp-2611-，判定只看前缀", () => {
  assert.equal(EXPERIMENT_BATCH_KEY_PREFIX, "exp-2611-");
  assert.equal(isExperimentBatchKey("exp-2611-bakeoff-01"), true);
  assert.equal(isExperimentBatchKey("exp-2611-"), true);
  assert.equal(isExperimentBatchKey("batch-exp-2611-01"), false, "前缀必须在开头");
  assert.equal(isExperimentBatchKey("EXP-2611-01"), false, "幂等键大小写敏感，不放宽");
  assert.equal(isExperimentBatchKey(null), false);
  assert.equal(isExperimentBatchKey(undefined), false);
});

test("where 片段：BatchJob 维度按前缀排除实验批次", () => {
  assert.deepEqual(notExperimentBatchWhere(), { idempotencyKey: { not: { startsWith: "exp-2611-" } } });
});
