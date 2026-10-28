import assert from "node:assert/strict";
import test from "node:test";
import { voiceoverBudget, writeVoiceoverScript } from "../src/lib/video-generation/voiceover-writer";

/**
 * 2026-10-28 闭环轮 E2E：「生成口播稿」原来是纯本地模板（固定开场 + 截取描述 + 固定结尾），成片原样念出来。
 * 改成 LLM 按商家原话写；不可用 / 超时 / 超长一律返回 null，前端保留模板稿。
 */

const input = { prompt: "早上把热茶倒进陶土橙保温杯，中午打开还冒热气。", durationSec: 15, language: "zh-CN", cta: "免费上门量尺" };
const reply = (script: unknown) => async () => ({ data: { script }, modelUsed: "m", tokenUsage: null, raw: "" });

test("预算：中文 4 字 / 秒，英文 2.2 词 / 秒（至少 12 词），与模板同一把尺", () => {
  assert.equal(voiceoverBudget(15, false), 60);
  assert.equal(voiceoverBudget(15, true), 33);
  assert.equal(voiceoverBudget(5, true), 12);
});

test("正常：返回 AI 稿，请求带时长预算、结尾行动与商家原话，走 fast 档", async () => {
  let seen: { tier?: string; stage?: string; user?: string } = {};
  const script = await writeVoiceoverScript(input, {
    llmAvailable: () => true,
    chat: (async (options: { tier?: string; stage?: string; user?: string }) => {
      seen = options;
      return reply("早上倒进去的热茶，中午打开还是暖的。陶土橙保温杯，陪你从出门到下班。想看实物，欢迎来店里。")();
    }) as never,
  });
  assert.match(script ?? "", /中午打开还是暖的/);
  assert.equal(seen.tier, "fast");
  assert.equal(seen.stage, "voiceover_draft");
  assert.match(seen.user!, /at most 60 Chinese characters/);
  assert.match(seen.user!, /免费上门量尺/);
  assert.match(seen.user!, /陶土橙保温杯/);
});

test("退回模板：AI 不可用、抛错、超时、空稿、超长都返回 null；空描述不调用", async () => {
  let called = 0;
  const counting = (async () => {
    called += 1;
    return reply("x")();
  }) as never;
  assert.equal(await writeVoiceoverScript({ ...input, prompt: "  " }, { llmAvailable: () => true, chat: counting }), null);
  assert.equal(called, 0);
  assert.equal(await writeVoiceoverScript(input, { llmAvailable: () => false, chat: counting }), null);
  assert.equal(await writeVoiceoverScript(input, { llmAvailable: () => true, chat: (async () => { throw new Error("429"); }) as never }), null);
  assert.equal(await writeVoiceoverScript(input, { llmAvailable: () => true, chat: (() => new Promise(() => undefined)) as never, timeoutMs: 10 }), null);
  assert.equal(await writeVoiceoverScript(input, { llmAvailable: () => true, chat: reply("") as never }), null);
  assert.equal(await writeVoiceoverScript(input, { llmAvailable: () => true, chat: reply("很长".repeat(60)) as never }), null);
});
