import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  REASONING_HEADROOM_TOKENS,
  analyzeImages,
  chatJsonByTier,
  completionTokenBudget,
  openai,
} from "../src/lib/providers/openai";

/**
 * 10-29「OpenAI 返回了空响应」真机查证：推理模型的 max_completion_tokens 含思考 token。
 * consistency_bible（sol，上限 1200）一次 finish_reason=length、reasoning_tokens=1200/1200、正文 0 字；
 * 放开上限重跑思考 133–1375 token。修法 = 正文上限外另留思考余量 + 截断时翻倍重试一次 + 把原因写进错误。
 */

const ENV: Record<string, string | undefined> = {
  OPENAI_API_KEY: "sk-test-budget",
  OPENAI_MODEL: undefined,
  OPENAI_VIDEOPROMPT_MODEL: undefined,
  OPENAI_FAST_MODEL: undefined,
  OPENAI_VISION_MODEL: undefined,
  LLM_FORCE_MOCK: undefined,
  AIVORA_DRY_RUN: undefined,
};

async function withEnv(run: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    mock.restoreAll();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

type CreateParams = { model: string; max_completion_tokens?: number; max_tokens?: number };

function stubCreate(impl: (params: CreateParams, callIndex: number) => unknown): CreateParams[] {
  const calls: CreateParams[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    calls.push(params);
    return impl(params, calls.length - 1);
  }) as never);
  return calls;
}

/** 思考把额度吃光：与 10-29 真机回包同形（finish_reason=length、content 空串、reasoning = 上限）。 */
function thinkingExhausted(budget: number) {
  return {
    choices: [{ finish_reason: "length", message: { content: "", refusal: null } }],
    usage: {
      prompt_tokens: 1473,
      completion_tokens: budget,
      total_tokens: 1473 + budget,
      completion_tokens_details: { reasoning_tokens: budget },
    },
  };
}

function ok(payload: unknown, completion = 568) {
  return {
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 1473, completion_tokens: completion, total_tokens: 1473 + completion },
  };
}

const BIBLE = { tier: "videoPrompt" as const, stage: "consistency_bible", system: "sys", user: "user", maxTokens: 1200 };

test("completionTokenBudget：推理模型在正文上限外另留思考余量；4 系照旧只给正文上限", () => {
  assert.equal(completionTokenBudget("gpt-5.6-sol", 1200), 1200 + REASONING_HEADROOM_TOKENS);
  assert.equal(completionTokenBudget("o4-mini", 900), 900 + REASONING_HEADROOM_TOKENS);
  assert.equal(completionTokenBudget("gpt-4.1", 1200), 1200);
  /// 10-29 实测思考最多 1375 token；余量要盖得住，且远大于正文本身
  assert.ok(REASONING_HEADROOM_TOKENS >= 2 * 1375);
});

test("chatJsonByTier：首发就带思考余量（1200 → 5200），一次成功不重试", async () => {
  await withEnv(async () => {
    const calls = stubCreate(() => ok({ productDescription: "teal rope toy" }));
    const result = await chatJsonByTier(BIBLE);
    assert.deepEqual(result.data, { productDescription: "teal rope toy" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.model, "gpt-5.6-sol");
    assert.equal(calls[0]!.max_completion_tokens, 1200 + REASONING_HEADROOM_TOKENS);
    assert.equal(calls[0]!.max_tokens, undefined);
  });
});

test("chatJsonByTier：思考吃光额度（length + 空正文）→ 上限翻倍重试一次，拿到正文；token 用量算两次之和", async () => {
  await withEnv(async () => {
    const first = 2500 + REASONING_HEADROOM_TOKENS;
    const calls = stubCreate((params, index) =>
      index === 0 ? thinkingExhausted(params.max_completion_tokens!) : ok({ shots: [] }, 900),
    );
    const result = await chatJsonByTier({ tier: "fast", stage: "storyboard_shot_cards", system: "s", user: "u", maxTokens: 2500 });
    assert.deepEqual(result.data, { shots: [] });
    assert.deepEqual(calls.map((c) => c.model), ["gpt-5.6-terra", "gpt-5.6-terra"], "同一模型重试，不走回退链");
    assert.deepEqual(calls.map((c) => c.max_completion_tokens), [first, first * 2]);
    assert.deepEqual(result.tokenUsage, {
      promptTokens: 1473 * 2,
      completionTokens: first + 900,
      totalTokens: 1473 + first + 1473 + 900,
    });
  });
});

test("chatJsonByTier：JSON 被截断（length + 半截 JSON）同样翻倍重试一次", async () => {
  await withEnv(async () => {
    const calls = stubCreate((_params, index) =>
      index === 0
        ? { choices: [{ finish_reason: "length", message: { content: '{"characterProfile": "a wom' } }], usage: null }
        : ok({ characterProfile: "a woman" }),
    );
    const result = await chatJsonByTier(BIBLE);
    assert.deepEqual(result.data, { characterProfile: "a woman" });
    assert.equal(calls.length, 2);
  });
});

test("chatJsonByTier：两次都被思考吃光 → 抛错写明 finish_reason=length 与思考用量，只打两次、不换模型", async () => {
  await withEnv(async () => {
    const calls = stubCreate((params) => thinkingExhausted(params.max_completion_tokens!));
    const retried = (1200 + REASONING_HEADROOM_TOKENS) * 2;
    await assert.rejects(chatJsonByTier(BIBLE), (err: unknown) => {
      assert.equal(
        (err as Error).message,
        `OpenAI 返回了空响应（model=gpt-5.6-sol，finish_reason=length：上限 ${retried} token 用了 ${retried}，其中思考 ${retried}，正文没写完）`,
      );
      return true;
    });
    assert.equal(calls.length, 2);
  });
});

test("chatJsonByTier：空正文但不是截断（stop / 拒答 / 内容过滤）→ 不重试，原因写进错误", async () => {
  await withEnv(async () => {
    const replies = [
      { choices: [{ finish_reason: "stop", message: { content: "" } }], usage: { prompt_tokens: 9, completion_tokens: 0, total_tokens: 9 } },
      { choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't help with that." } }], usage: null },
      { choices: [{ finish_reason: "content_filter", message: { content: null } }], usage: null },
    ];
    for (const [index, reply] of replies.entries()) {
      const calls = stubCreate(() => reply);
      await assert.rejects(
        chatJsonByTier(BIBLE),
        [/finish_reason=stop，completion 0 token/, /模型拒答：I can't help with that\./, /finish_reason=content_filter：被内容过滤拦下/][index]!,
      );
      assert.equal(calls.length, 1, `第 ${index + 1} 种不该重试`);
      mock.restoreAll();
    }
  });
});

test("chatJsonByTier：不完整的 JSON 但不是截断 → 不重试，照旧报「不是合法 JSON」并附原文", async () => {
  await withEnv(async () => {
    const calls = stubCreate(() => ({ choices: [{ finish_reason: "stop", message: { content: "not json" } }], usage: null }));
    await assert.rejects(chatJsonByTier(BIBLE), /OpenAI 返回的不是合法 JSON：.*\n原文：not json/);
    assert.equal(calls.length, 1);
  });
});

test("analyzeImages：同一套规则——默认正文 1200 + 思考余量；思考吃光时翻倍重试一次", async () => {
  await withEnv(async () => {
    const calls = stubCreate((params, index) =>
      index === 0 ? thinkingExhausted(params.max_completion_tokens!) : ok({ frames: [] }),
    );
    const result = await analyzeImages(["data:image/jpeg;base64,AAAA"], "sys", "user");
    assert.deepEqual(result.data, { frames: [] });
    assert.equal(result.tier, "vision");
    assert.deepEqual(
      calls.map((c) => c.max_completion_tokens),
      [1200 + REASONING_HEADROOM_TOKENS, (1200 + REASONING_HEADROOM_TOKENS) * 2],
    );
  });
});

test("analyzeImages：两次都空 → 「视觉分析返回了空响应」并写明原因", async () => {
  await withEnv(async () => {
    stubCreate((params) => thinkingExhausted(params.max_completion_tokens!));
    await assert.rejects(
      analyzeImages(["data:image/jpeg;base64,AAAA"], "sys", "user", { maxTokens: 900 }),
      /^Error: 视觉分析返回了空响应（model=gpt-5\.6-sol，finish_reason=length：上限 9800 token/,
    );
  });
});
