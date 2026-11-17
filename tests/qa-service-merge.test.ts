import assert from "node:assert/strict";
import test from "node:test";
import {
  FINAL_FRAME_QA_ISSUE_PREFIX,
  mergeAiQaReview,
  mergeFinalFrameQaReview,
} from "../src/lib/services/qa-review-merge";

/**
 * P01-E1（链 T）：QAReview 的 aiScoreBreakdown / aiIssues 按归属合并（#16 审查 item 4 否决了通用并集）：
 *   - AI 打分一方整块替换自己的 8 维打分与自己的问题，只保留 finalFrameQa 键与「[成片复检]」前缀的问题；
 *   - 成片级复检整体替换 finalFrameQa 与自己前缀的问题，不碰 8 维打分与别人的问题。
 * 纯函数。原来还有一条走 runAIQA 的集成断言，随旧的 /api/briefs/[id]/qa 与 qa-service 一起删了（2026-11-16）；
 * 写回时的 CAS 冲突重试由 final-frame-qa.test.ts 守着。
 */

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
