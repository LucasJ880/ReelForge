import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * C2 · 定价不惩罚迭代（PRD §6 / M7，决策 4）+ 主线五编译产物。
 *
 * 调研结论：流失头号原因不是质量差，是积分模型惩罚正常使用。
 * 这组测试把新功能已实现的计费口径焊死成回归 —— 谁往这些路径里
 * 加计费，测试就红。
 */

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

test("🔴 C2.1 生成一周计划不计费：content-plans 路由没有任何扣费调用", () => {
  const route = read("src/app/api/content-plans/route.ts");
  const store = read("src/lib/services/content-plan-store.ts");
  for (const source of [route, store]) {
    assert.doesNotMatch(
      source,
      /quota|credit|charge|billing|consume/i,
      "计划生成的成本只有一次 LLM 调用，对它收费等于惩罚迭代",
    );
  }
});

test("🔴 C2.1 重复出图不重复计费：已出齐的帖子短路返回", () => {
  const source = read("src/lib/services/content-post-render-service.ts");
  /// A4 5.3 起按 slide 补缺：每屏都有图才短路（以前「有任意一张就返回」，半套轮播永远补不齐）。
  /// 行为级回归见 tests/content-post-render-lock.test.ts。
  assert.match(source, /if \(missing\.length === 0\)[\s\S]{0,160}skipped: true/);
});

test("🔴 C2.3 取消永远免费：discard 路径没有扣费，且保留素材", () => {
  const source = read("src/lib/services/content-post-render-service.ts");
  const discard = source.slice(source.indexOf("discardContentPost"));
  assert.doesNotMatch(discard, /quota|credit|charge/i);
  assert.doesNotMatch(discard, /renderedImageUrls: \[\]/, "取消不清素材");
});

test("C2.1 失败零计费：出图失败时保留已产出素材并可重试，无扣费调用", () => {
  const source = read("src/lib/services/content-post-render-service.ts");
  /// A4 5.3 起失败分支是「if (failure) {」（逐屏出图，失败即停并按位置落库）。
  const failureBlock = source.slice(source.indexOf("if (failure) {"));
  assert.match(failureBlock.slice(0, 500), /renderedImageUrls: urls/);
  assert.doesNotMatch(source, /quota|credit|charge/i);
});

/// ── 主线五编译产物的完整性 ──

