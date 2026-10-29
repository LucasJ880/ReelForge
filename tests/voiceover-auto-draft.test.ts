import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { awaitVoiceoverDraft } from "../src/lib/video-generation/voiceover-draft-wait";

/**
 * 出故事板前自动请 AI 写口播稿（2026-10-29 灰度真机）：预填的描述（重新生成 / 帮我写 / 试试这些 / 贴链接）
 * 从不触发「离开输入框就起稿」，成片口播是「先看它如何改变日常体验」这类模板套话。
 */

const STUDIO = "src/components/video-generation/streamlined-video-studio.tsx";

test("等 AI 稿：写好就用；超时、取消、失败、空稿一律放手返回 null（照旧用模板，不卡住出故事板）", async () => {
  const live = () => new AbortController().signal;
  assert.equal(await awaitVoiceoverDraft(Promise.resolve("早上出门带上它，一上午都是热的。"), live(), 1000), "早上出门带上它，一上午都是热的。");
  assert.equal(await awaitVoiceoverDraft(new Promise(() => undefined), live(), 20), null, "超时");
  assert.equal(await awaitVoiceoverDraft(Promise.reject(new Error("down")), live(), 1000), null, "起稿抛错");
  assert.equal(await awaitVoiceoverDraft(Promise.resolve("   "), live(), 1000), null, "空稿");
  const controller = new AbortController();
  const pending = awaitVoiceoverDraft(new Promise(() => undefined), controller.signal, 60_000);
  controller.abort();
  assert.equal(await pending, null, "取消这一轮时立刻放手，不等满 25 秒");
  const already = new AbortController();
  already.abort();
  assert.equal(await awaitVoiceoverDraft(Promise.resolve("x"), already.signal, 1000), null);
});

test("出故事板：口播稿还停在模板（或正有一份在写）就先等 AI 稿，再拿它出方案", async () => {
  const studio = await readFile(STUDIO, "utf8");
  const start = studio.indexOf("async function handleCreateStoryboard()");
  const body = studio.slice(start, studio.indexOf("\n  async function ", start + 10));
  const wait = body.indexOf("await awaitVoiceoverDraft(");
  const plan = body.indexOf("activePlan = await fetchPlan(request, controller.signal);");
  assert.ok(wait > 0 && plan > wait, "起稿在出方案之前");
  assert.match(body, /voiceoverEnabled\s*&& !narrationFromTemplate\s*&& rawPrompt\.trim\(\)\.length >= 12\s*&& \(voiceoverDraftRef\.current !== null \|\| !voiceoverEditedRef\.current\)/);
  assert.match(body, /draftVoiceoverWithAi\(controller\.signal\),\s*controller\.signal,\s*VOICEOVER_AUTO_DRAFT_WAIT_MS,/);
  assert.match(body, /if \(drafted\) \{\s*request = buildRequest\(drafted\);\s*requestKey = JSON\.stringify\(request\);/);
  /// 同一次点击里 state 还没刷新：buildRequest 直接用刚写好的稿
  assert.match(studio, /function buildRequest\(voiceoverScriptOverride\?: string \| null\)[^{]*\{\s*const script = voiceoverScriptOverride \?\? voiceoverScript;/);
  assert.doesNotMatch(studio.slice(studio.indexOf("function buildRequest("), studio.indexOf("function validateBeforeRequest(")), /detectScriptLanguage\(voiceoverScript/);
});

test("起稿只有一份：离开输入框、「生成口播稿」、出故事板前共用；写的时候主按钮如实说", async () => {
  const studio = await readFile(STUDIO, "utf8");
  assert.match(studio, /if \(voiceoverDraftRef\.current\) return voiceoverDraftRef\.current;/);
  assert.match(studio, /const script = await draftVoiceoverWithAi\(\);\s*if \(!script\) applyTemplate\(\);\s*invalidatePlan\(\);/);
  assert.equal((studio.match(/fetch\("\/api\/video-generation\/voiceover-draft"/g) ?? []).length, 1);
  assert.match(studio, /planningShots \? \(voiceoverDrafting \? copy\.writingVoiceover : copy\.planningShots\)/);
  assert.match(studio, /writingVoiceover: "正在写口播稿…",/);
  assert.match(studio, /writingVoiceover: "Writing the voiceover…",/);
});
