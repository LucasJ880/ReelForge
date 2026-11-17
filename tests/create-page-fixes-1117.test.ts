/**
 * 2026-11-17 线上实测发现的三处创作页问题：
 * 1. 上一轮没走完的故事板晚到，把刚填的内容整个换掉（其中一次带回来的还是一天前失败的一轮）；
 * 2. 有故事板之后贴底的操作条是透明的（bg-surface 在主题里没有定义），滚动时和下面的镜头清单叠在一起；
 * 3. 把新的品牌包存成默认后，页面上旧的那个也还标着「默认」。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideStoryboardResume } from "../src/lib/create/storyboard-resume";

const base = { runStatus: "AWAITING_APPROVAL", formTouched: false, resumeRequested: false, dismissed: false, storyboardOnPage: false };

test("恢复上一轮故事板：表单是空的、那一轮还在进行中才直接带回来", () => {
  for (const runStatus of ["GENERATING", "AWAITING_APPROVAL", "APPROVED"]) {
    assert.equal(decideStoryboardResume({ ...base, runStatus }), "apply", runStatus);
  }
});

test("恢复上一轮故事板：表单已经有内容就不动表单，只给一条提示——不管那一轮是什么状态、是不是点「回创作页继续」来的", () => {
  for (const runStatus of ["GENERATING", "AWAITING_APPROVAL", "APPROVED", "FAILED"]) {
    assert.equal(decideStoryboardResume({ ...base, runStatus, formTouched: true }), "offer", runStatus);
    assert.equal(decideStoryboardResume({ ...base, runStatus, formTouched: true, resumeRequested: true }), "offer", runStatus);
  }
});

test("恢复上一轮故事板：早就失败的那一轮不自动填回表单；点「回创作页继续」明确过来的才直接带回来", () => {
  assert.equal(decideStoryboardResume({ ...base, runStatus: "FAILED" }), "offer");
  assert.equal(decideStoryboardResume({ ...base, runStatus: "FAILED", resumeRequested: true }), "apply");
});

test("恢复上一轮故事板：已取消、说过不用了、或者页面上已经新做了一轮 → 什么都不做", () => {
  assert.equal(decideStoryboardResume({ ...base, runStatus: "CANCELLED" }), "ignore");
  assert.equal(decideStoryboardResume({ ...base, dismissed: true }), "ignore");
  assert.equal(decideStoryboardResume({ ...base, storyboardOnPage: true }), "ignore");
  /// 说过不用了，之后又点「回创作页继续」明确回来找它：照常带回来（表单有内容就只提示）
  assert.equal(decideStoryboardResume({ ...base, runStatus: "FAILED", resumeRequested: true, dismissed: true }), "apply");
  assert.equal(decideStoryboardResume({ ...base, resumeRequested: true, dismissed: true, formTouched: true }), "offer");
  assert.equal(decideStoryboardResume({ ...base, runStatus: "CANCELLED", resumeRequested: true }), "ignore");
});

test("创作页接线：恢复按请求回来那一刻的表单现状判断；提示条两个按钮；成品库入口带 resume=1", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /formTouched: interactedRef\.current \|\| formDirtyRef\.current/);
  /// 表单现状：描述、商品图、参考图、正在上传，四样都算
  assert.match(studio, /formDirtyRef\.current =\s+rawPrompt\.trim\(\) !== initialPrompt\.trim\(\)\s+\|\| productAssets\.length !== initialProductAssets\.length\s+\|\| referenceAssets\.length !== initialReferenceAssets\.length\s+\|\| uploadingTarget !== null;/);
  assert.match(studio, /storyboardOnPage: storyboardOnPageRef\.current/);
  assert.match(studio, /if \(decision === "apply"\) applyResume\(payload\.resume\);\s+else if \(decision === "offer"\) setResumeOffer\(payload\.resume\);/);
  assert.match(studio, /data-testid="storyboard-resume-offer"/);
  assert.match(studio, /onClick=\{\(\) => applyResume\(resumeOffer\)\}/);
  assert.match(studio, /markStoryboardRunDismissed\(resumeOffer\.run\.id\);\s+setResumeOffer\(null\);/);
  assert.match(studio, /resumeOfferHint: "接着处理会把那一轮的商品图和描述带回来，替换现在填的内容。"/);
  const page = readFileSync("src/app/(platform)/app/create/page.tsx", "utf8");
  assert.match(page, /resumeRequested=\{resume === "1"\}/);
  const library = readFileSync("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(library, /href="\/app\/create\?resume=1"\s+data-testid="library-pending-storyboard"/);
});

test("贴底操作条有不透明的底色：用主题里真有的颜色；bg-surface 也补进了主题", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  const bar = /data-testid="storyboard-sticky-bar"\s+className="([^"]+)"/.exec(studio);
  assert.ok(bar, "找不到贴底操作条");
  assert.match(bar[1]!, /\bsticky\b/);
  /// 操作条浮在面板之上：抬升色（不透明），在主题里有定义
  assert.match(bar[1]!, /\bbg-raised\b/);
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  assert.match(tokens, /--color-raised: var\(--surface-raised\);/);
  assert.match(tokens, /--surface-raised: #[0-9a-f]{6};/i);
  /// 主题里每一个写得出来的面板色工具类都要有定义：bg-surface 之前漏了，五处卡片因此是透明的
  assert.match(tokens, /--color-surface: var\(--surface\);/);
  assert.match(tokens, /--surface: #[0-9a-f]{6};/i);
});

test("品牌包存成默认后，页面上别的工作区品牌包不再标「默认」", () => {
  const manager = readFileSync("src/components/brand/brand-package-manager.tsx", "utf8");
  assert.match(manager, /saved\.isDefault && item\.scope === "workspace" && item\.isDefault \? \{ \.\.\.item, isDefault: false \} : item/);
  assert.match(manager, /return saved\.isDefault \? \[saved, \.\.\.others\] : \[\.\.\.others, saved\];/);
  /// 服务端本来就只留一个默认（同一个事务里先把别的取消）
  const service = readFileSync("src/lib/services/workspace-brand-package-service.ts", "utf8");
  assert.match(service, /where: \{ workspaceId: workspace\.id, isDefault: true \},\s+data: \{ isDefault: false \},/);
});
