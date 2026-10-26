import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  mergeJsonArray,
  mergeJsonObject,
  mergeQaReviewAiFields,
} from "../src/lib/services/qa-review-merge";
import { runAIQA } from "../src/lib/services/qa-service";

/**
 * P01-E1（链 T）：qa-service 对 aiScoreBreakdown / aiIssues 合并写，不整块覆盖。
 * 同一 QAReview 行还挂着成片级复检（P01-E）的 finalFrameQa 子对象与追加的问题。
 * monkey-patch Prisma，不连库；brief 没有脚本 → runAIQA 走 mock 打分，不调 LLM。
 */

function patchModel(t: TestContext, model: object, patches: Record<string, unknown>) {
  const record = model as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = record[key];
    record[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) record[key] = originals[key];
  });
}

test("mergeJsonObject：深合并，同键新值胜出，其它键保留；嵌套数组去重追加；undefined 不覆盖", () => {
  const merged = mergeJsonObject(
    { hook_quality: 3, finalFrameQa: { status: "pending", requestedAt: "t0", issues: ["a"] }, keep: true },
    { hook_quality: 8, finalFrameQa: { status: "ok", checkedAt: "t1", issues: ["a", "b"] }, gone: undefined },
  );
  assert.deepEqual(merged, {
    hook_quality: 8,
    finalFrameQa: { status: "ok", requestedAt: "t0", checkedAt: "t1", issues: ["a", "b"] },
    keep: true,
  });
  /// 坏数据（非对象）按空对象起步
  assert.deepEqual(mergeJsonObject(null, { a: 1 }), { a: 1 });
  assert.deepEqual(mergeJsonObject(["x"], { a: 1 }), { a: 1 });
  assert.deepEqual(mergeJsonObject({ a: 1 }, "junk"), { a: 1 });
});

test("mergeJsonArray：保留旧顺序，追加未出现的新项；对象按 JSON 身份判重", () => {
  assert.deepEqual(mergeJsonArray(["旧问题", "重复"], ["重复", "新问题"]), ["旧问题", "重复", "新问题"]);
  assert.deepEqual(mergeJsonArray(null, ["a"]), ["a"]);
  assert.deepEqual(mergeJsonArray([{ k: 1 }], [{ k: 1 }, { k: 2 }]), [{ k: 1 }, { k: 2 }]);
  assert.deepEqual(mergeJsonArray(["a"], undefined), ["a"]);
});

test("mergeQaReviewAiFields：只返回被触碰的列", () => {
  const out = mergeQaReviewAiFields(
    { aiScoreBreakdown: { finalFrameQa: { status: "pending" } }, aiIssues: ["旧"] },
    { breakdown: { hook_quality: 7 } },
  );
  assert.deepEqual(out, { aiScoreBreakdown: { finalFrameQa: { status: "pending" }, hook_quality: 7 } });
  assert.deepEqual(mergeQaReviewAiFields({ aiScoreBreakdown: null, aiIssues: null }, {}), {});
});

test("runAIQA 更新既有 PENDING 行：8 维打分合并进去，finalFrameQa 子对象与已有问题保留，重复问题不翻倍", async (t) => {
  patchModel(t, db.videoBrief, {
    findUnique: async () => ({
      id: "brief-1",
      durationSec: 15,
      onCameraMode: "NONE",
      contentAngle: { title: "t", hook: "h", narrative: "n" },
      scripts: [],
      videoJobs: [],
    }),
  });
  const existing = {
    id: "qa-1",
    aiScoreBreakdown: { finalFrameQa: { status: "pending", requestedAt: "2026-10-26T12:00:00.000Z" } },
    aiIssues: ["[成片复检] 第3帧 检测到假字标", "[Mock] LLM 未配置，全维度按 7 分打分"],
  };
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  patchModel(t, db.qAReview, {
    findFirst: async () => existing,
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push(args);
      return { id: args.where.id, ...args.data };
    },
    create: async () => { throw new Error("已有 PENDING 行不该新建"); },
  });

  await runAIQA("brief-1");
  assert.equal(updates.length, 1);
  const data = updates[0].data;
  const breakdown = data.aiScoreBreakdown as Record<string, unknown>;
  assert.deepEqual(breakdown.finalFrameQa, existing.aiScoreBreakdown.finalFrameQa, "成片复检标记不被覆盖");
  assert.equal(breakdown.hook_quality, 7);
  assert.equal(breakdown.technical_completeness, 7);
  assert.deepEqual(data.aiIssues, existing.aiIssues, "旧问题保留，重复的 mock 问题不翻倍");
  assert.equal(typeof data.aiOverallScore, "number");
});
