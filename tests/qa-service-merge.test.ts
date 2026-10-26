import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  FINAL_FRAME_QA_ISSUE_PREFIX,
  mergeAiQaReview,
  mergeFinalFrameQaReview,
} from "../src/lib/services/qa-review-merge";
import { runAIQA } from "../src/lib/services/qa-service";
import { mockQaReviewCasStore } from "./helpers/qa-review-cas-store";

/**
 * P01-E1（链 T）：QAReview 的 aiScoreBreakdown / aiIssues 按归属合并（#16 审查 item 4 否决了通用并集）：
 *   - runAIQA 整块替换自己的 8 维打分与自己的问题，只保留 finalFrameQa 键与「[成片复检]」前缀的问题；
 *   - 成片级复检整体替换 finalFrameQa 与自己前缀的问题，不碰 8 维打分与别人的问题。
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

const RECHECK_ISSUE = `${FINAL_FRAME_QA_ISSUE_PREFIX} 第3帧 检测到假字标`;

test("mergeAiQaReview：替换自己的打分与问题，保留 finalFrameQa 键与复检前缀问题；旧打分 / 旧问题不残留", () => {
  const merged = mergeAiQaReview(
    {
      aiScoreBreakdown: { hook_quality: 3, stale_dimension: 1, finalFrameQa: { status: "ok", checkedAt: "t1" } },
      aiIssues: ["旧的 AI 问题", RECHECK_ISSUE],
    },
    { breakdown: { hook_quality: 8, cta_quality: 6 }, issues: ["新的 AI 问题"] },
  );
  assert.deepEqual(merged.aiScoreBreakdown, {
    hook_quality: 8,
    cta_quality: 6,
    finalFrameQa: { status: "ok", checkedAt: "t1" },
  });
  assert.deepEqual(merged.aiIssues, ["新的 AI 问题", RECHECK_ISSUE]);
  /// 没有复检键 / 坏数据：只写自己的
  assert.deepEqual(mergeAiQaReview({ aiScoreBreakdown: null, aiIssues: "junk" }, { breakdown: { a: 1 }, issues: [] }), {
    aiScoreBreakdown: { a: 1 },
    aiIssues: [],
  });
});

test("mergeFinalFrameQaReview：整体替换 finalFrameQa（不深合并）与自己前缀的问题；打分与别人的问题原样", () => {
  const existing = {
    aiScoreBreakdown: { hook_quality: 7, finalFrameQa: { status: "issues", requestedAt: "t0", issues: [{ frameIndex: 2 }] } },
    aiIssues: ["AI 问题", RECHECK_ISSUE],
  };
  /// 先出 issues、再复检为 ok：旧问题子对象与「[成片复检]」问题都要清空
  const ok = mergeFinalFrameQaReview(existing, { mark: { status: "ok", requestedAt: "t0", checkedAt: "t2" }, issues: [] });
  assert.deepEqual(ok.aiScoreBreakdown, { hook_quality: 7, finalFrameQa: { status: "ok", requestedAt: "t0", checkedAt: "t2" } });
  assert.deepEqual(ok.aiIssues, ["AI 问题"]);

  const issues = mergeFinalFrameQaReview(existing, { mark: { status: "issues" }, issues: ["第1帧 假字", `${FINAL_FRAME_QA_ISSUE_PREFIX} 已带前缀`] });
  assert.deepEqual(issues.aiIssues, ["AI 问题", `${FINAL_FRAME_QA_ISSUE_PREFIX} 第1帧 假字`, `${FINAL_FRAME_QA_ISSUE_PREFIX} 已带前缀`]);
  assert.deepEqual(mergeFinalFrameQaReview({ aiScoreBreakdown: null, aiIssues: null }, { mark: { status: "pending" }, issues: [] }), {
    aiScoreBreakdown: { finalFrameQa: { status: "pending" } },
    aiIssues: [],
  });
});

test("runAIQA 更新既有 PENDING 行：8 维打分整块替换，finalFrameQa 与复检问题保留，旧 AI 问题不残留", async (t) => {
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
    aiScoreBreakdown: { hook_quality: 3, finalFrameQa: { status: "pending", requestedAt: "2026-10-26T12:00:00.000Z" } },
    aiIssues: [RECHECK_ISSUE, "上一轮 AI 的旧问题"],
  };
  patchModel(t, db.qAReview, {
    findFirst: async () => existing,
    create: async () => { throw new Error("已有 PENDING 行不该新建"); },
  });
  const store = mockQaReviewCasStore(t, existing);
  /// 打分期间成片复检把结论写回：CAS 冲突后按新快照重合并，复检的新结论与新问题不被盖掉
  const recheck = { status: "issues", requestedAt: "2026-10-26T12:00:00.000Z", checkedAt: "2026-10-26T12:01:00.000Z" };
  let raced = false;
  store.beforeWrite((current) => {
    if (raced) return;
    raced = true;
    current.aiScoreBreakdown = { ...(current.aiScoreBreakdown as Record<string, unknown>), finalFrameQa: recheck };
    current.aiIssues = ["上一轮 AI 的旧问题", `${FINAL_FRAME_QA_ISSUE_PREFIX} 新结论`];
  });

  const saved = await runAIQA("brief-1");
  assert.equal(store.writes.length, 2, "第一次 CAS 冲突，第二次落库");
  const data = store.get();
  const breakdown = data.aiScoreBreakdown as Record<string, unknown>;
  assert.deepEqual(breakdown.finalFrameQa, recheck, "成片复检标记不被覆盖");
  assert.equal(breakdown.hook_quality, 7, "自己的打分整块替换");
  assert.equal(breakdown.technical_completeness, 7);
  assert.deepEqual(data.aiIssues, ["[Mock] LLM 未配置，全维度按 7 分打分", `${FINAL_FRAME_QA_ISSUE_PREFIX} 新结论`], "旧 AI 问题不残留，复检问题保留");
  assert.equal(typeof data.aiOverallScore, "number");
  assert.equal(saved.id, "qa-1");
});
