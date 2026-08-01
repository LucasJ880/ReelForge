import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  triageRetake,
  RETAKE_VERDICTS,
  MECHANISM_DIAGNOSIS,
  DELIVERY_PREFLIGHT,
  QC_FAILURE_ROUTING,
} from "../src/lib/video-generation/director-methodology";

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

test("🔴 C2.1 重复出图不重复计费：已出图短路返回", () => {
  const source = read("src/lib/services/content-post-render-service.ts");
  assert.match(source, /renderedImageUrls\.length > 0[\s\S]{0,120}skipped: true/);
});

test("🔴 C2.3 取消永远免费：discard 路径没有扣费，且保留素材", () => {
  const source = read("src/lib/services/content-post-render-service.ts");
  const discard = source.slice(source.indexOf("discardContentPost"));
  assert.doesNotMatch(discard, /quota|credit|charge/i);
  assert.doesNotMatch(discard, /renderedImageUrls: \[\]/, "取消不清素材");
});

test("C2.1 失败零计费：出图失败时保留已产出素材并可重试，无扣费调用", () => {
  const source = read("src/lib/services/content-post-render-service.ts");
  const catchBlock = source.slice(source.indexOf("} catch (err) {"));
  assert.match(catchBlock.slice(0, 500), /renderedImageUrls: urls/);
  assert.doesNotMatch(catchBlock, /quota|credit|charge/i);
});

/// ── 主线五编译产物的完整性 ──

test("重拍分诊五档齐全，两次同瑕疵强制改写不许赌种子", () => {
  assert.equal(RETAKE_VERDICTS.length, 5);
  const rewrite = triageRetake({
    sameFlawCount: 2,
    attemptsUsed: 1,
    attemptBudget: 5,
    postDomainFlaw: false,
    primaryDelivered: false,
  });
  assert.equal(rewrite.verdict, "rewrite");

  /// 预算过半无进展 → 停止，不是继续烧。
  const stop = triageRetake({
    sameFlawCount: 1,
    attemptsUsed: 3,
    attemptBudget: 5,
    postDomainFlaw: false,
    primaryDelivered: false,
  });
  assert.equal(stop.verdict, "stop");
});

test("后期域瑕疵绝不烧重拍额度", () => {
  const result = triageRetake({
    sameFlawCount: 0,
    attemptsUsed: 0,
    attemptBudget: 5,
    postDomainFlaw: true,
    primaryDelivered: false,
  });
  assert.equal(result.verdict, "fix_in_post");
});

test("八机制诊断表完整，文字问题的修法是「不让模型画字」", () => {
  assert.equal(MECHANISM_DIAGNOSIS.length, 8);
  const textRoute = QC_FAILURE_ROUTING.find((r) => r.failure.includes("字幕"));
  assert.ok(textRoute);
  assert.match(textRoute.route, /不让模型重画字/);
});

test("交付前检查覆盖八个域，含权利与人工 QC", () => {
  const areas: string[] = DELIVERY_PREFLIGHT.map((row) => row.area);
  for (const required of ["画面", "色彩", "音频", "文字", "连续性", "权利", "元数据", "人工 QC"]) {
    assert.ok(areas.includes(required), `缺 ${required} 域`);
  }
});

test("编译产物锁定了确切 commit，且刻意不含平台数据", () => {
  const lock = read("skills-lock.json");
  assert.match(lock, /db601eccc95733da02849066c783800b794ec4fd/);
  assert.match(lock, /刻意不编译/);
  const compiled = read("src/lib/video-generation/director-methodology.ts");
  assert.match(compiled, /MIT License, Copyright \(c\) 2026 Iamemily2050/);
  /// PRD §7 边界：平台信息以 video-route-registry 与审计契约为准。
  assert.match(compiled, /刻意没有编译进来/);
});
