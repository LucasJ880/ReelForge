/**
 * 看图写镜头卡（轻量版，src/lib/video-generation/shot-cards.ts）。
 * 守三件事：缺省关；开着时用 fast 档看图、最多三张；看图没用上就退回纯文字，最坏情况与今天一样。
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { openai } from "../src/lib/providers/openai";
import { analyzeImages } from "../src/lib/ai";
import {
  SHOT_CARD_SYSTEM_PROMPT,
  SHOT_CARD_VISION_NOTE,
  designStoryboardShotCards,
  shotCardsVisionEnabled,
  type DesignShotCardsInput,
} from "../src/lib/video-generation/shot-cards";
import type { PlanningDegradation } from "../src/types/video-generation";

const BEATS = ["倒热茶", "拧紧盖子", "塞进通勤包", "中午打开还冒热气"];

function card(index: number) {
  return {
    startState: `Bottle stands on the counter, lid off, shot ${index + 1}`,
    action: "Her right hand tilts the teapot and fills the bottle slowly",
    endState: "Steam rises from the full bottle on the counter",
    location: "home kitchen",
    voice: "voice_over",
    lens: "50mm medium shot",
    camera: "counter height, locked off",
    composition: "bottle centered, teapot left, window behind",
    light: "soft window light from camera left, warm morning tones",
    sound: "tea pouring, quiet room tone",
  };
}
const GOOD = { shots: BEATS.map((_, index) => card(index)) };

function input(overrides: Partial<DesignShotCardsInput> = {}): DesignShotCardsInput {
  return {
    story: "陶土橙不锈钢保温杯。早上出门前把刚泡好的热茶倒进杯子，中午在办公室打开还冒着热气。",
    beats: BEATS,
    durationSec: 15,
    aspectRatio: "9:16",
    productImageCount: 5,
    personImageCount: 0,
    voiceoverScript: "早上灌的热茶，中午打开还烫嘴。",
    productImageUrls: [1, 2, 3, 4, 5].map((n) => `https://cdn.example.com/bottle-${n}.png`),
    ...overrides,
  };
}

function harness(options: { vision?: () => unknown; text?: () => unknown } = {}) {
  const calls = { vision: [] as Array<{ urls: string[]; system: string; user: string; options: unknown }>, text: 0 };
  const degraded: PlanningDegradation[] = [];
  const deps = {
    enabled: true,
    llmAvailable: () => true,
    analyze: (async (urls: string[], system: string, user: string, opts: unknown) => {
      calls.vision.push({ urls, system, user, options: opts });
      return { data: await (options.vision ?? (() => GOOD))() };
    }) as never,
    chat: (async () => {
      calls.text += 1;
      return { data: await (options.text ?? (() => GOOD))() };
    }) as never,
    onDegraded: (entry: PlanningDegradation) => void degraded.push(entry),
  };
  return { deps, calls, degraded };
}

test("开关：缺省关（没经真机对照）；STORYBOARD_SHOT_CARDS_VISION=on 才开", () => {
  assert.equal(shotCardsVisionEnabled({}), false);
  assert.equal(shotCardsVisionEnabled({ STORYBOARD_SHOT_CARDS_VISION: "off" }), false);
  assert.equal(shotCardsVisionEnabled({ STORYBOARD_SHOT_CARDS_VISION: " ON " }), true);
});

test("关着：有商品图也不看图，走原来的纯文字调用", async () => {
  const { deps, calls } = harness();
  const cards = await designStoryboardShotCards(input(), { ...deps, vision: false });
  assert.equal(cards?.length, BEATS.length);
  assert.equal(calls.vision.length, 0);
  assert.equal(calls.text, 1);
});

test("开着：只调一次看图（fast 档、最多三张图、沿用镜头卡规则并加一句看图要求），不再调纯文字", async () => {
  const { deps, calls, degraded } = harness();
  const cards = await designStoryboardShotCards(input(), { ...deps, vision: true });
  assert.equal(cards?.length, BEATS.length);
  assert.equal(calls.text, 0);
  assert.equal(calls.vision.length, 1);
  const call = calls.vision[0];
  assert.equal(call?.urls.length, 3, "三张足够认清外观，再多只是拖慢");
  assert.deepEqual(call?.options, { tier: "fast", maxTokens: 2500 });
  assert.ok(call?.system.startsWith(SHOT_CARD_SYSTEM_PROMPT));
  assert.ok(call?.system.endsWith(SHOT_CARD_VISION_NOTE));
  assert.match(call?.user ?? "", /uploaded 3 real photo\(s\)/);
  assert.match(call?.user ?? "", /You are shown the 3 product photo\(s\)/);
  assert.deepEqual(degraded, []);
});

test("开着但没有商品图：直接走纯文字", async () => {
  const { deps, calls } = harness();
  await designStoryboardShotCards(input({ productImageUrls: [], productImageCount: 0 }), { ...deps, vision: true });
  assert.equal(calls.vision.length, 0);
  assert.equal(calls.text, 1);
});

test("看图没用上（报错 / 超时 / 卡数不对）→ 退回纯文字再写一次；纯文字成了就不记降级", async () => {
  mock.method(console, "warn", () => undefined);
  const failing = harness({
    vision: () => {
      throw new Error("400 Unable to download content from the provided URL");
    },
  });
  assert.equal((await designStoryboardShotCards(input(), { ...failing.deps, vision: true }))?.length, BEATS.length);
  assert.deepEqual([failing.calls.vision.length, failing.calls.text], [1, 1]);
  assert.deepEqual(failing.degraded, [], "最后有卡，就不是降级");

  const hanging = harness({ vision: () => new Promise(() => undefined) });
  assert.equal(
    (await designStoryboardShotCards(input(), { ...hanging.deps, vision: true, visionTimeoutMs: 10 }))?.length,
    BEATS.length,
  );
  assert.equal(hanging.calls.text, 1);

  const short = harness({ vision: () => ({ shots: GOOD.shots.slice(0, 2) }) });
  assert.equal((await designStoryboardShotCards(input(), { ...short.deps, vision: true }))?.length, BEATS.length);
  assert.equal(short.calls.text, 1);
  mock.restoreAll();
});

test("看图和纯文字都没用上 → 与今天一样：记一条 shot_cards 降级，返回 null（退回模板节奏）", async () => {
  mock.method(console, "warn", () => undefined);
  const { deps, degraded } = harness({
    vision: () => {
      throw new Error("500 upstream error");
    },
    text: () => {
      throw new Error("OpenAI 返回了空响应");
    },
  });
  assert.equal(await designStoryboardShotCards(input(), { ...deps, vision: true }), null);
  assert.deepEqual(degraded.map((entry) => [entry.stage, entry.reason]), [["shot_cards", "OpenAI 返回了空响应"]]);
  mock.restoreAll();
});

test("看图接口的 tier 选项：fast 走 fast 档的模型，缺省仍是 vision 档", async (t) => {
  const saved = { key: process.env.OPENAI_API_KEY, mock: process.env.LLM_FORCE_MOCK, model: process.env.OPENAI_MODEL };
  process.env.OPENAI_API_KEY = "sk-test-shot-cards-vision";
  delete process.env.LLM_FORCE_MOCK;
  delete process.env.OPENAI_MODEL;
  t.after(() => {
    for (const [name, value] of [["OPENAI_API_KEY", saved.key], ["LLM_FORCE_MOCK", saved.mock], ["OPENAI_MODEL", saved.model]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    mock.restoreAll();
  });
  const models: string[] = [];
  mock.method(openai.chat.completions, "create", (async (params: { model: string }) => {
    models.push(params.model);
    return {
      choices: [{ message: { content: JSON.stringify(GOOD) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }) as never);
  await analyzeImages(["https://cdn.example.com/a.png"], "system", "user", { tier: "fast" });
  await analyzeImages(["https://cdn.example.com/a.png"], "system", "user");
  assert.deepEqual(models, ["gpt-5.6-terra", "gpt-5.6-sol"]);
});
