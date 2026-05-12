import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

/**
 * P0-1 follow-up 测试：wizard-script-service mock 路径 + schema 失败 throw + OpenAI 调用参数。
 *
 * 设计原则：
 * - **零真实 OpenAI 调用**：通过 monkey-patch `openai.chat.completions.create`（仅供测试导出），
 *   或通过 DI 注入 `deps.invokeLLM`。
 * - **无 DB 写入**：测试只覆盖纯逻辑层 —— `validateScriptLLMOutput`、`buildTokenLimitParam`、
 *   `wizardScriptSchemaErrorToAPIResponse`、`isLLMForcedMock`。
 *   `generateAndPersistWizardScript` 涉及 Prisma 写入，由集成测试覆盖；这里只单测决策点。
 */

import {
  WizardScriptSchemaError,
  isWizardScriptSchemaError,
  wizardScriptSchemaErrorToAPIResponse,
  __test__ as wizardScriptTest,
} from "../src/lib/services/wizard-script-service";
import {
  isLLMForcedMock,
  buildTokenLimitParam,
  buildTemperatureParam,
  chatJson,
  openai as openaiClient,
} from "../src/lib/providers/openai";
import {
  isLLMSchemaError,
  llmSchemaErrorToAPIResponse,
} from "../src/lib/services/llm-schema-error";
import { scriptOutputSchema } from "../src/lib/schemas/script-output";

const { validateScriptLLMOutput } = wizardScriptTest;

function withEnv<T>(
  patches: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patches)) {
    prev[k] = process.env[k];
    if (patches[k] === undefined) delete process.env[k];
    else process.env[k] = patches[k];
  }
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      for (const k of Object.keys(prev)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    });
}

const FORCE_MOCK_KEYS = [
  "LLM_FORCE_MOCK",
  "DIRECTOR_FORCE_MOCK",
  "SCRIPT_FORCE_MOCK",
];

function clearedForceMocks() {
  return Object.fromEntries(FORCE_MOCK_KEYS.map((k) => [k, undefined]));
}

/// ---------- (1)-(3) isLLMForcedMock 多别名守门 ----------

test("[P0] isLLMForcedMock: LLM_FORCE_MOCK=true → 返回 true", async () => {
  await withEnv(
    { ...clearedForceMocks(), LLM_FORCE_MOCK: "true" },
    () => {
      assert.equal(isLLMForcedMock(), true);
    },
  );
});

test("[P0] isLLMForcedMock: DIRECTOR_FORCE_MOCK=true → 返回 true（向后兼容）", async () => {
  await withEnv(
    { ...clearedForceMocks(), DIRECTOR_FORCE_MOCK: "true" },
    () => {
      assert.equal(isLLMForcedMock(), true);
    },
  );
});

test("[P0] isLLMForcedMock: SCRIPT_FORCE_MOCK=true → 返回 true（向后兼容）", async () => {
  await withEnv(
    { ...clearedForceMocks(), SCRIPT_FORCE_MOCK: "true" },
    () => {
      assert.equal(isLLMForcedMock(), true);
    },
  );
});

test("[P0] isLLMForcedMock: 三个开关都未设 → 返回 false", async () => {
  await withEnv(clearedForceMocks(), () => {
    assert.equal(isLLMForcedMock(), false);
  });
});

test("[P0] isLLMForcedMock: 值非 'true' 字面 → 返回 false（防大小写/拼写陷阱）", async () => {
  await withEnv(
    { ...clearedForceMocks(), LLM_FORCE_MOCK: "1" },
    () => {
      assert.equal(isLLMForcedMock(), false);
    },
  );
  await withEnv(
    { ...clearedForceMocks(), LLM_FORCE_MOCK: "TRUE" },
    () => {
      assert.equal(isLLMForcedMock(), false);
    },
  );
});

/// ---------- (4) chatJson / chatJsonByTier force-mock 自我守门 ----------

test("[P0] chatJson 在 LLM_FORCE_MOCK=true 时拒绝发出真实请求（抛错）", async () => {
  /// 关键意图：任何漏掉 mock 短路的 service 调到 chatJson 立刻爆栈
  /// → 不会悄悄消耗 OpenAI 额度。
  await withEnv(
    { OPENAI_API_KEY: "sk-test", LLM_FORCE_MOCK: "true" },
    async () => {
      await assert.rejects(
        chatJson({ system: "s", user: "u", model: "gpt-4o-mini" }),
        /LLM_FORCE_MOCK is true/,
      );
    },
  );
});

/// ---------- (5) buildTokenLimitParam: 按 model family 选 max_tokens vs max_completion_tokens ----------

test("[P0] buildTokenLimitParam: gpt-5.5 → max_completion_tokens（修复 OpenAI 4xx）", () => {
  assert.deepEqual(buildTokenLimitParam("gpt-5.5", 1234), {
    max_completion_tokens: 1234,
  });
});

test("[P0] buildTokenLimitParam: gpt-5-preview / gpt-6 / o1 / o3 / o4 → max_completion_tokens", () => {
  for (const model of [
    "gpt-5-preview",
    "gpt-5.5",
    "gpt-6",
    "o1",
    "o1-mini",
    "o3-mini",
    "o4-mini",
  ]) {
    const out = buildTokenLimitParam(model, 999);
    assert.ok(
      "max_completion_tokens" in out && !("max_tokens" in out),
      `model=${model} 应使用 max_completion_tokens，实际：${JSON.stringify(out)}`,
    );
  }
});

test("[P0] buildTokenLimitParam: gpt-4o / gpt-4.1 / gpt-4o-mini / gpt-3.5 → max_tokens", () => {
  for (const model of [
    "gpt-4o",
    "gpt-4.1",
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "gpt-3.5-turbo",
  ]) {
    const out = buildTokenLimitParam(model, 1500);
    assert.ok(
      "max_tokens" in out && !("max_completion_tokens" in out),
      `model=${model} 应使用 max_tokens，实际：${JSON.stringify(out)}`,
    );
  }
});

/// ---------- (5b) buildTemperatureParam: GPT-5.x/o-series 必须丢 temperature ----------

test("[P0] buildTemperatureParam: gpt-5.5 → 不下发 temperature（修复 OpenAI 4xx）", () => {
  /// GPT-5.x 只接受默认 temperature=1；任何显式值都会被服务端拒绝
  assert.deepEqual(buildTemperatureParam("gpt-5.5", 0.7), {});
});

test("[P0] buildTemperatureParam: gpt-5-preview / gpt-6 / o1 / o3 / o4 → 不下发 temperature", () => {
  for (const model of [
    "gpt-5-preview",
    "gpt-5.5",
    "gpt-6",
    "o1",
    "o1-mini",
    "o3-mini",
    "o4-mini",
  ]) {
    const out = buildTemperatureParam(model, 0.85);
    assert.ok(
      !("temperature" in out),
      `model=${model} 应丢弃 temperature，实际：${JSON.stringify(out)}`,
    );
  }
});

test("[P0] buildTemperatureParam: gpt-4o / gpt-4.1 / gpt-3.5 → 透传 temperature", () => {
  for (const model of [
    "gpt-4o",
    "gpt-4.1",
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "gpt-3.5-turbo",
  ]) {
    assert.deepEqual(
      buildTemperatureParam(model, 0.5),
      { temperature: 0.5 },
      `model=${model} 应透传 temperature`,
    );
  }
});

test("[P0] buildTemperatureParam: undefined requested → 始终 omit", () => {
  /// 调用方不传 temperature 时不应自动塞默认；让 SDK / API 用模型默认
  assert.deepEqual(buildTemperatureParam("gpt-4o", undefined), {});
  assert.deepEqual(buildTemperatureParam("gpt-5.5", undefined), {});
});

/// ---------- (6) chatJson 真实调用：模型 → SDK 参数 端到端 ----------
/// 通过 mock `openai.chat.completions.create` 截获实际下发到 SDK 的 params。

async function withMockedOpenAICreate<T>(
  impl: (params: Record<string, unknown>) => Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<{ result: T; captured: Array<Record<string, unknown>> }> {
  const captured: Array<Record<string, unknown>> = [];
  const completions = openaiClient.chat.completions as unknown as {
    create: (p: Record<string, unknown>) => Promise<unknown>;
  };
  const orig = completions.create;
  completions.create = async (params: Record<string, unknown>) => {
    captured.push(params);
    return impl(params);
  };
  try {
    const result = await fn();
    return { result, captured };
  } finally {
    completions.create = orig;
  }
}

const MIN_SDK_OK_RESPONSE = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: null,
};

test("[P0] chatJson SDK 调用：model=gpt-5.5 → 实际 params 含 max_completion_tokens，无 max_tokens", async () => {
  await withEnv(
    {
      OPENAI_API_KEY: "sk-test",
      ...clearedForceMocks(),
    },
    async () => {
      const { captured } = await withMockedOpenAICreate(
        () => MIN_SDK_OK_RESPONSE,
        () =>
          chatJson({
            system: "s",
            user: "u",
            model: "gpt-5.5",
            maxTokens: 4321,
          }),
      );
      assert.equal(captured.length, 1);
      assert.equal(captured[0].model, "gpt-5.5");
      assert.equal(captured[0].max_completion_tokens, 4321);
      assert.ok(
        !("max_tokens" in captured[0]),
        `params 不应含 max_tokens：${JSON.stringify(captured[0])}`,
      );
    },
  );
});

test("[P0] chatJson SDK 调用：model=gpt-4o → 实际 params 含 max_tokens，无 max_completion_tokens", async () => {
  await withEnv(
    {
      OPENAI_API_KEY: "sk-test",
      ...clearedForceMocks(),
    },
    async () => {
      const { captured } = await withMockedOpenAICreate(
        () => MIN_SDK_OK_RESPONSE,
        () =>
          chatJson({
            system: "s",
            user: "u",
            model: "gpt-4o",
            maxTokens: 1500,
          }),
      );
      assert.equal(captured.length, 1);
      assert.equal(captured[0].model, "gpt-4o");
      assert.equal(captured[0].max_tokens, 1500);
      assert.ok(
        !("max_completion_tokens" in captured[0]),
        `params 不应含 max_completion_tokens：${JSON.stringify(captured[0])}`,
      );
    },
  );
});

test("[P0] chatJson SDK 调用：model=gpt-5.5 + service 传 temperature=0.7 → 实际 params 不含 temperature（修复 OpenAI 4xx）", async () => {
  /// 防御性测试：即使 service 层传 temperature=0.7，到了 SDK 调用层也必须丢弃，
  /// 否则 GPT-5.x 会立刻 400。
  await withEnv(
    {
      OPENAI_API_KEY: "sk-test",
      ...clearedForceMocks(),
    },
    async () => {
      const { captured } = await withMockedOpenAICreate(
        () => MIN_SDK_OK_RESPONSE,
        () =>
          chatJson({
            system: "s",
            user: "u",
            model: "gpt-5.5",
            temperature: 0.7,
          }),
      );
      assert.equal(captured.length, 1);
      assert.equal(captured[0].model, "gpt-5.5");
      assert.ok(
        !("temperature" in captured[0]),
        `gpt-5.5 params 不应含 temperature，实际：${JSON.stringify(captured[0])}`,
      );
    },
  );
});

test("[P0] chatJson SDK 调用：model=gpt-4o + temperature=0.7 → 实际 params 含 temperature=0.7", async () => {
  /// 防御性测试：旧 model 仍然必须透传 temperature，确保此次修复不回归 4o 系。
  await withEnv(
    {
      OPENAI_API_KEY: "sk-test",
      ...clearedForceMocks(),
    },
    async () => {
      const { captured } = await withMockedOpenAICreate(
        () => MIN_SDK_OK_RESPONSE,
        () =>
          chatJson({
            system: "s",
            user: "u",
            model: "gpt-4o",
            temperature: 0.7,
          }),
      );
      assert.equal(captured.length, 1);
      assert.equal(captured[0].temperature, 0.7);
    },
  );
});

/// ---------- (7) WizardScriptSchemaError + validateScriptLLMOutput ----------

const VALID_SCRIPT_OUTPUT = {
  language: "en-US",
  title: "Acme Smart Blinds Morning Routine",
  hook: "Wake up to natural light without lifting a finger.",
  voiceover:
    "Picture this — your blinds open with the sunrise, no tugging, no cords, just calm light filling the room while you sip your coffee.",
  captions: [
    { sceneIndex: 1, text: "Tap once. Curtains roll up." },
    { sceneIndex: 2, text: "Sun pours in. Morning starts." },
  ],
  cta: "Order today — link in bio.",
  complianceNotes: [],
  copiedFromReference: false,
};

test("[P0] validateScriptLLMOutput: 合法输入 → 返回 ScriptOutput", () => {
  const out = validateScriptLLMOutput(VALID_SCRIPT_OUTPUT, {
    modelUsed: "gpt-5.5",
    briefId: "order-1",
  });
  assert.equal(out.title, VALID_SCRIPT_OUTPUT.title);
  assert.equal(out.copiedFromReference, false);
});

test("[P0] validateScriptLLMOutput: LLM 返回非法 JSON（缺 voiceover）→ throw WizardScriptSchemaError", () => {
  const bad: Record<string, unknown> = {
    ...VALID_SCRIPT_OUTPUT,
  };
  delete bad.voiceover;

  try {
    validateScriptLLMOutput(bad, {
      modelUsed: "gpt-5.5",
      briefId: "order-2",
    });
    assert.fail("应抛错");
  } catch (err) {
    assert.ok(
      isWizardScriptSchemaError(err),
      `应是 WizardScriptSchemaError，实际：${(err as Error).name}`,
    );
    /// 自动也是 LLMSchemaError 的实例
    assert.ok(isLLMSchemaError(err));
    assert.equal(err.modelUsed, "gpt-5.5");
    assert.equal(err.briefId, "order-2");
    assert.equal(err.code, "script_schema_failed");
    assert.match(err.userSafeMessage, /AI 视频脚本|重试/);
    /// userSafeMessage 不应泄露 zod / model / briefId
    assert.doesNotMatch(err.userSafeMessage, /zod|gpt-5\.5|order-2/i);
    /// issuesSummary 必须含 voiceover 缺失信息
    assert.match(err.issuesSummary, /voiceover/);
    assert.ok(err.issuesSummary.length <= 500);
    /// cause 必须是 ZodError
    assert.ok(err.cause instanceof z.ZodError);
  }
});

test("[P0] validateScriptLLMOutput: LLM 返回完全无关结构 → throw（不静默回退 mock）", () => {
  assert.throws(
    () =>
      validateScriptLLMOutput(
        { random: "garbage", number: 42 },
        { modelUsed: "gpt-4.1", briefId: "order-3" },
      ),
    WizardScriptSchemaError,
  );
});

test("[P0] WizardScriptSchemaError 继承 LLMSchemaError（共享 422 helper）", () => {
  const zerr = scriptOutputSchema.safeParse({});
  assert.equal(zerr.success, false);
  if (zerr.success) return;
  const err = new WizardScriptSchemaError({
    cause: zerr.error,
    modelUsed: "gpt-5.5",
    briefId: "order-4",
  });
  assert.ok(err instanceof Error);
  assert.ok(isWizardScriptSchemaError(err));
  assert.ok(isLLMSchemaError(err));
  assert.equal(err.code, "script_schema_failed");
});

/// ---------- (8) wizardScriptSchemaErrorToAPIResponse + 共用 helper ----------

test("[P0] wizardScriptSchemaErrorToAPIResponse → 422 + retryable=true + code=script_schema_failed", () => {
  const zerr = scriptOutputSchema.safeParse({});
  assert.equal(zerr.success, false);
  if (zerr.success) return;
  const err = new WizardScriptSchemaError({
    cause: zerr.error,
    modelUsed: "gpt-5.5",
    briefId: "order-5",
  });
  const { body, status } = wizardScriptSchemaErrorToAPIResponse(err);
  assert.equal(status, 422);
  assert.equal(body.ok, false);
  assert.equal(body.code, "script_schema_failed");
  assert.equal(body.retryable, true);
  assert.match(body.error, /AI 视频脚本|重试/);
  /// 响应不应泄露 model / briefId / zod / 任何内部细节
  assert.doesNotMatch(body.error, /gpt-5\.5|order-5|zod/i);
});

test("[P0] 共用 llmSchemaErrorToAPIResponse 处理 WizardScriptSchemaError → 同样 422 + retryable=true", () => {
  const zerr = scriptOutputSchema.safeParse({});
  if (zerr.success) return;
  const err = new WizardScriptSchemaError({
    cause: zerr.error,
    modelUsed: "gpt-5.5",
    briefId: "order-6",
  });
  const { body, status } = llmSchemaErrorToAPIResponse(err);
  assert.equal(status, 422);
  assert.equal(body.retryable, true);
  assert.equal(body.code, "script_schema_failed");
});

/// ---------- (9) DirectorSchemaError 仍通过 isLLMForcedMock 守门（向后兼容） ----------

test("[P0] director-service 现在用 isLLMForcedMock() —— LLM_FORCE_MOCK=true 也走 mock", async () => {
  const { __test__: directorTest } = await import("../src/lib/services/director-service");
  const { buildDirectorPlanResult } = directorTest;
  const { planSegments } = await import("../src/lib/duration/segment-planner");

  const ctx = {
    targetDurationSec: 30 as const,
    segmentSlots: planSegments(30),
    clientBrief: { businessName: "Acme", productName: "Acme Pro" },
    productInput: {},
    targetCountry: "US",
    targetLanguage: "en-US",
    targetPlatform: "tiktok",
    angle: {
      title: "t",
      hook: "h",
      narrative: null,
      type: "OPTIMIZATION",
      explorationTheme: null,
      localeNotes: null,
    },
  };

  await withEnv(
    { OPENAI_API_KEY: "sk-test", LLM_FORCE_MOCK: "true", DIRECTOR_FORCE_MOCK: undefined },
    async () => {
      const invokeLLM = async () => {
        throw new Error("invokeLLM 不应被调用");
      };
      const result = await buildDirectorPlanResult(ctx, "brief-x", { invokeLLM });
      assert.equal(result.fromMock, true);
    },
  );
});

test("[P0] director-service: SCRIPT_FORCE_MOCK=true 也触发 director mock（统一 isLLMForcedMock 语义）", async () => {
  const { __test__: directorTest } = await import("../src/lib/services/director-service");
  const { buildDirectorPlanResult } = directorTest;
  const { planSegments } = await import("../src/lib/duration/segment-planner");

  const ctx = {
    targetDurationSec: 15 as const,
    segmentSlots: planSegments(15),
    clientBrief: { businessName: "Acme", productName: "Acme Pro" },
    productInput: {},
    targetCountry: "US",
    targetLanguage: "en-US",
    targetPlatform: "tiktok",
    angle: {
      title: "t",
      hook: "h",
      narrative: null,
      type: "OPTIMIZATION",
      explorationTheme: null,
      localeNotes: null,
    },
  };

  await withEnv(
    { OPENAI_API_KEY: "sk-test", SCRIPT_FORCE_MOCK: "true", LLM_FORCE_MOCK: undefined, DIRECTOR_FORCE_MOCK: undefined },
    async () => {
      const invokeLLM = async () => {
        throw new Error("invokeLLM 不应被调用");
      };
      const result = await buildDirectorPlanResult(ctx, "brief-x2", { invokeLLM });
      assert.equal(result.fromMock, true);
    },
  );
});
