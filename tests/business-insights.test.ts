import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecommendations,
  type BusinessInsightsSummary,
  type BusinessVideoInsight,
} from "../src/lib/services/business-insights-service";

const emptySummary: BusinessInsightsSummary = {
  totalVideos: 0,
  readyCount: 0,
  inProgressCount: 0,
  failedCount: 0,
  withMetricsCount: 0,
  totalViews: 0,
  avgCompletionRate: null,
};

test("buildRecommendations: 无视频时建议创建首支广告", () => {
  const recs = buildRecommendations("zh-CN", emptySummary, []);
  assert.equal(recs[0]?.id, "first-ad");
});

test("buildRecommendations: 失败视频优先提示重试", () => {
  const videos: BusinessVideoInsight[] = [
    {
      orderId: "o1",
      title: "Test ad",
      briefId: "b1",
      status: "failed",
      statusLabel: "未成功",
      updatedAt: new Date(),
      views: null,
      completionRate: null,
      hook: null,
    },
  ];
  const summary = { ...emptySummary, totalVideos: 1, failedCount: 1 };
  const recs = buildRecommendations("zh-CN", summary, videos);
  assert.ok(recs.some((r) => r.id === "retry-failed"));
});
