import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { feedbackNextSteps } from "../src/lib/library/feedback-next-steps";
import { applyHookAngle, detectHookAngle, HOOK_ANGLES } from "../src/lib/create/hook-angles";
import { getPlatformCopy } from "../src/i18n/platform-copy";

/**
 * 2026-11-10：不满意之后原来只有一句固定的话，让商家自己在页面上找「重做这一段」。
 * 现在按原因把人指到能解决它的动作上，先便宜的后贵的；这条成片做不了的动作不出现。
 */
const ALL = { restitch: true, redo_segment: true, make_another: true };

test("按原因给下一步：字幕 → 只重新合成；商品 / 动作 → 重做一段；没按描述拍 → 再做一条", () => {
  assert.deepEqual(feedbackNextSteps(["voice_caption"], ALL), ["restitch"]);
  assert.deepEqual(feedbackNextSteps(["product_mismatch"], ALL), ["redo_segment", "make_another"]);
  assert.deepEqual(feedbackNextSteps(["unnatural_motion"], ALL), ["redo_segment", "make_another"]);
  assert.deepEqual(feedbackNextSteps(["off_brief"], ALL), ["make_another"]);
  assert.deepEqual(feedbackNextSteps(["other"], ALL), ["make_another"]);
  assert.deepEqual(feedbackNextSteps([], ALL), []);
});

test("多个原因合并去重，顺序固定为便宜的在前，不跟点选先后变", () => {
  assert.deepEqual(feedbackNextSteps(["off_brief", "voice_caption", "product_mismatch"], ALL), ["restitch", "redo_segment", "make_another"]);
  assert.deepEqual(feedbackNextSteps(["product_mismatch", "unnatural_motion"], ALL), ["redo_segment", "make_another"]);
});

test("这条成片做不了的动作不出现（批量条目不能再做一条、不能重拼的不指过去）", () => {
  assert.deepEqual(feedbackNextSteps(["voice_caption"], { ...ALL, restitch: false }), []);
  assert.deepEqual(feedbackNextSteps(["product_mismatch"], { ...ALL, redo_segment: false }), ["make_another"]);
  assert.deepEqual(feedbackNextSteps(["product_mismatch"], { restitch: true, redo_segment: false, make_another: false }), []);
});

test("详情页把下一步接到页内真实的位置；评价面板只在记下不满意后显示", () => {
  const page = readFileSync("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(page, /restitch: canRestitch \? "#captions-music" : null,/);
  assert.match(page, /redo_segment: canRedoSegment \? "#segment-redo" : null,/);
  assert.match(page, /make_another: canMakeAnother \? `\/app\/create\?retry=\$\{encodeURIComponent\(item\.id\)\}` : null,/);
  assert.match(page, /\{canRestitch \? <span id="captions-music" aria-hidden className="-mb-4 block h-0 scroll-mt-24" \/> : null\}/);
  assert.match(page, /\{canRedoSegment \? <span id="segment-redo" aria-hidden className="-mb-4 block h-0 scroll-mt-24" \/> : null\}/);
  const panel = readFileSync("src/components/library/video-feedback-panel.tsx", "utf8");
  assert.match(panel, /nextTargets && saved\?\.rating === "down" && !downDirty/);
  assert.match(panel, /data-testid="feedback-next-steps"/);
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getPlatformCopy(locale).library.feedback;
    assert.ok(copy.nextTitle.length > 0);
    assert.deepEqual(Object.keys(copy.nextSteps).sort(), ["make_another", "redo_segment", "restitch"]);
  }
  /// 只重新合成是不扣额度的：按钮上写明，商家才敢点
  assert.match(getPlatformCopy("zh-CN").library.feedback.nextSteps.restitch, /不扣额度/);
});

test("换个开头再做一条：详情页四个入口带着 hook 回创作页，创作页把带回的描述换上这个开头", () => {
  const page = readFileSync("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(page, /data-testid="hook-again"/);
  assert.match(page, /`\/app\/create\?retry=\$\{encodeURIComponent\(item\.id\)\}&hook=\$\{angle\.id\}`/);
  const create = readFileSync("src/app/(platform)/app/create/page.tsx", "utf8");
  assert.match(create, /const hookAngle = HOOK_ANGLES\.find\(\(angle\) => angle\.id === hook\)\?\.id \?\? null;/, "认不出的 hook 当作没带");
  assert.match(create, /retryPrefill\?\.prompt && hookAngle/, "只和 retry 一起生效");
  /// 带回的描述原来带着「痛点开场」，换成「结果前置」后只剩新的那一句
  const pain = applyHookAngle("这只保温杯通勤用。", "pain", "zh");
  const swapped = applyHookAngle(pain, "result", "zh");
  assert.equal(detectHookAngle(swapped), "result");
  assert.ok(!swapped.includes(HOOK_ANGLES[0].zh.direction));
  assert.ok(swapped.startsWith("这只保温杯通勤用。"));
});
