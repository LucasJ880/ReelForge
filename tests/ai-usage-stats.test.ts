import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAIUsageRows,
  type AIUsageRowForStats,
} from "../src/lib/services/ai-usage-stats-service";

test("aggregateAIUsageRows: empty input → zero stats", () => {
  const stats = aggregateAIUsageRows([], 30);
  assert.equal(stats.windowDays, 30);
  assert.equal(stats.totals.calls, 0);
  assert.equal(stats.totals.totalCostUsd, 0);
  assert.equal(stats.byFeature.length, 0);
  assert.equal(stats.byModel.length, 0);
});

test("aggregateAIUsageRows: counts SUCCESS/FAILED/MOCK + sums tokens & cost", () => {
  const rows: AIUsageRowForStats[] = [
    {
      feature: "client_script",
      model: "gpt-4o-mini",
      status: "SUCCESS",
      costEstimateUsd: 0.01,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
    {
      feature: "client_script",
      model: "gpt-4o-mini",
      status: "MOCK",
      costEstimateUsd: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    },
    {
      feature: "storyboard",
      model: "gpt-4o",
      status: "FAILED",
      costEstimateUsd: 0.005,
      promptTokens: 80,
      completionTokens: 0,
      totalTokens: 80,
    },
    {
      feature: "storyboard",
      model: "gpt-4o",
      status: "SUCCESS",
      costEstimateUsd: 0.02,
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    },
  ];
  const stats = aggregateAIUsageRows(rows, 7);

  assert.equal(stats.totals.calls, 4);
  assert.equal(stats.totals.successCalls, 2);
  assert.equal(stats.totals.failedCalls, 1);
  assert.equal(stats.totals.mockCalls, 1);
  assert.equal(stats.totals.totalCostUsd, 0.035);
  assert.equal(stats.totals.totalTokens, 530);

  /// byFeature 按 calls 降序
  assert.equal(stats.byFeature.length, 2);
  assert.equal(stats.byFeature[0]!.calls, 2);
  const cs = stats.byFeature.find((x) => x.feature === "client_script");
  assert.ok(cs);
  assert.equal(cs!.successCalls, 1);
  assert.equal(cs!.mockCalls, 1);
  assert.equal(cs!.failedCalls, 0);

  /// byModel
  const gpt4o = stats.byModel.find((x) => x.model === "gpt-4o");
  assert.ok(gpt4o);
  assert.equal(gpt4o!.calls, 2);
  assert.equal(gpt4o!.promptTokens, 280);
  assert.equal(gpt4o!.completionTokens, 100);
});

test("aggregateAIUsageRows: null model 归到 (unknown)", () => {
  const stats = aggregateAIUsageRows(
    [
      {
        feature: "shooting_guide",
        model: null,
        status: "SUCCESS",
        costEstimateUsd: 0.001,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    ],
    30,
  );
  assert.equal(stats.byModel[0]!.model, "(unknown)");
});
