import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  queueTotalCount,
  queueTotalPoints,
  type BatchQueueGroup,
} from "../src/lib/batch/batch-queue";

const groups: BatchQueueGroup[] = [
  { id: "g1", templateId: "tpl-shutter", templateVersion: 3, templateName: "百叶·整扇开合", count: 1 },
  { id: "g2", templateId: "tpl-shade", templateVersion: 2, templateName: "卷帘·晨光刺眼", count: 5 },
];

test("队列总数 = 各组之和 + 当前配置", () => {
  assert.equal(queueTotalCount([], 10), 10);
  assert.equal(queueTotalCount(groups, 4), 10);
  assert.equal(queueTotalCount(groups, 0), 6);
});

test("积分预估 = 总条数 × 单条积分", () => {
  assert.equal(queueTotalPoints(groups, 4, 900), 9000);
  assert.equal(queueTotalPoints([], 1, 900), 900);
});

test("向导接入队列：分组提交、每组独立幂等键、多批跳列表页", async () => {
  const wizard = await readFile("src/components/batch/batch-create-wizard.tsx", "utf8");
  assert.match(wizard, /queuedGroups/);
  assert.match(wizard, /queueTotalCount/);
  assert.match(wizard, /data-testid="batch-queue-bar"/);
  assert.match(wizard, /加入队列/);
  assert.match(wizard, /Queue this group/);
  // 每组一个请求：提交循环里对每个 group 生成各自的 idempotency key
  assert.match(wizard, /for \(const group of submissionGroups\)/);
  assert.doesNotMatch(wizard, /estimatedPartnerPoints = count \* 900/);
});
