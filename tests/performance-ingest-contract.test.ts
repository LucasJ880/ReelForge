import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  performanceIngestRequestSchema,
  performanceIngestResponseSchema,
  performanceSampleSchema,
} from "../src/lib/contracts/performance-api";

function sample(extra: Record<string, unknown> = {}) {
  return {
    subjectType: "post",
    subjectId: "cm123",
    platform: "instagram",
    windowHours: 48,
    observedAt: "2026-08-01T00:00:00.000Z",
    impressions: 1000,
    likes: 50,
    ...extra,
  };
}

test("🔴 回流方不能指定配方：contract 里根本没有 recipeId 字段", () => {
  const parsed = performanceSampleSchema.parse(
    sample({ recipeId: "post:Pain:text" }),
  );
  assert.ok(
    !("recipeId" in parsed),
    "配方是我方生成时确定的事实，让外部能覆盖等于给赛马开一个能写脏的口子",
  );
});

test("配方只从我方 subject 上读，服务层不读入参", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/performance-ingest-service.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /sample\.recipeId/,
    "服务层不得从回流入参取 recipeId",
  );
  /// 维度必须来自我方 subject 的查询结果，而不是回流入参。
  assert.match(source, /videoDims\.get\(subjectId\)/);
  assert.match(source, /postDims\.get\(subjectId\)/);
  /// 五个分组维度同样不许从回流入参取。
  assert.doesNotMatch(
    source,
    /sample\.(hookType|templateId|brandPlacement|aspectRatio|durationSec)/,
  );
});

test("窗口必须显式给，不设默认值", () => {
  const { windowHours, ...withoutWindow } = sample();
  void windowHours;
  assert.throws(
    () => performanceSampleSchema.parse(withoutWindow),
    "不知道是几小时的数据就不该收",
  );
});

test("分母可以两个都缺 —— 平台口径不同，缺就是缺，不换算", () => {
  const parsed = performanceSampleSchema.parse(
    sample({ impressions: null, views: null }),
  );
  assert.equal(parsed.impressions, null);
  assert.equal(parsed.views, null);
});

test("计数字段拒绝负数", () => {
  assert.throws(() => performanceSampleSchema.parse(sample({ likes: -1 })));
  assert.throws(() =>
    performanceSampleSchema.parse(sample({ impressions: -100 })),
  );
});

test("批量上限 500，防止一次灌穿", () => {
  const many = Array.from({ length: 501 }, () => sample());
  assert.throws(() => performanceIngestRequestSchema.parse({ samples: many }));
  assert.ok(
    performanceIngestRequestSchema.parse({ samples: many.slice(0, 500) }),
  );
});

test("回执把对不上与无配方分开报，两者含义不同", () => {
  const parsed = performanceIngestResponseSchema.parse({
    accepted: 10,
    unmatched: 2,
    withoutRecipe: 3,
  });
  /// unmatched 持续 >0 = 两边 id 对不齐，要查；
  /// withoutRecipe >0 = 历史内容没有配方，数据留着但进不了配方统计。
  assert.equal(parsed.unmatched, 2);
  assert.equal(parsed.withoutRecipe, 3);
});

test("subjectId 的来源前缀会被归一化 —— /api/videos 给的是带前缀的 id", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/performance-ingest-service.ts"),
    "utf8",
  );
  assert.match(source, /\^\(batch-\|brief-\)/);
});

test("回流是机器鉴权，无会话回退；赛马查询是客户会话", () => {
  const ingest = readFileSync(
    path.join(process.cwd(), "src/app/api/performance/route.ts"),
    "utf8",
  );
  assert.match(ingest, /machineAuthFailure\(req\)/);
  assert.doesNotMatch(ingest, /requireAuth|requireOperator/);

  const racing = readFileSync(
    path.join(process.cwd(), "src/app/api/racing/route.ts"),
    "utf8",
  );
  assert.match(racing, /requireAuth\(\)/);
  /// 赛马只解释**我方内容**的胜负，不做全账号看板（PRD §12）。
  /// 判据只能来自 judgeRecipes，且样本只取当前用户名下的内容。
  assert.match(racing, /judgeRecipes\(rows, /);
  assert.match(racing, /userId: guard\.session\.user\.id/);
  assert.match(
    racing,
    /summary: explainVerdict\(verdict\)/,
    "前端要显示这句话，而不是自己解读 verdict",
  );
});
