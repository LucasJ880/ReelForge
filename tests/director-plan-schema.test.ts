import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTOR_PROMPT_VERSION,
  parseDirectorPlan,
  safeParseDirectorPlan,
} from "../src/lib/schemas/director-plan";
import {
  __test__ as directorTest,
  DirectorSchemaError,
  isDirectorSchemaError,
  directorSchemaErrorToAPIResponse,
} from "../src/lib/services/director-service";
import { planSegments } from "../src/lib/duration/segment-planner";

const {
  mockDirectorPlan,
  buildDirectorPlanResult,
  validateDirectorLLMOutput,
  summarizeZodIssues,
} = directorTest;

/**
 * 跨测试共享的 env patch helper —— 与 openai-tier-director.test.ts 用法对齐。
 */
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

function ctx(targetDurationSec: 15 | 30 | 60) {
  return {
    targetDurationSec,
    segmentSlots: planSegments(targetDurationSec),
    clientBrief: {
      businessName: "Acme",
      productName: "Acme Smart Blinds",
      brandAssets: { logoUrl: "https://example.com/logo.png" },
    },
    productInput: {},
    targetCountry: "US",
    targetLanguage: "en-US",
    targetPlatform: "tiktok",
    angle: {
      title: "Hands-free morning routine",
      hook: "What if your blinds opened with the sunrise?",
      narrative: null,
      type: "OPTIMIZATION",
      explorationTheme: null,
      localeNotes: null,
    },
  };
}

test("DirectorPlan: 15s mock 通过 zod 校验，1 段", () => {
  const plan = parseDirectorPlan(mockDirectorPlan(ctx(15)));
  assert.equal(plan.version, DIRECTOR_PROMPT_VERSION);
  assert.equal(plan.targetDurationSec, 15);
  assert.equal(plan.segmentPlan.length, 1);
  assert.equal(plan.segmentPlan[0].segmentIndex, 0);
});

test("DirectorPlan: 30s mock 通过 zod 校验，2 段连续", () => {
  const plan = parseDirectorPlan(mockDirectorPlan(ctx(30)));
  assert.equal(plan.targetDurationSec, 30);
  assert.equal(plan.segmentPlan.length, 2);
  assert.equal(plan.segmentPlan[0].fromSec, 0);
  assert.equal(plan.segmentPlan[0].toSec, 15);
  assert.equal(plan.segmentPlan[1].fromSec, 15);
  assert.equal(plan.segmentPlan[1].toSec, 30);
  /// 每段必须有非空 seedancePrompt
  for (const s of plan.segmentPlan) {
    assert.ok(s.seedancePrompt.length > 10);
  }
});

test("DirectorPlan: 60s mock 通过 zod 校验，4 段连续", () => {
  const plan = parseDirectorPlan(mockDirectorPlan(ctx(60)));
  assert.equal(plan.targetDurationSec, 60);
  assert.equal(plan.segmentPlan.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(plan.segmentPlan[i].segmentIndex, i);
    assert.equal(plan.segmentPlan[i].fromSec, i * 15);
    assert.equal(plan.segmentPlan[i].toSec, i * 15 + 15);
  }
});

test("DirectorPlan: editingPlan.stitchOrder 与 segmentPlan 对齐", () => {
  for (const d of [15, 30, 60] as const) {
    const plan = parseDirectorPlan(mockDirectorPlan(ctx(d)));
    assert.deepEqual(
      plan.editingPlan.stitchOrder,
      plan.segmentPlan.map((s) => s.segmentIndex),
    );
  }
});

test("DirectorPlan: timeline 块数量随时长增加", () => {
  const p15 = parseDirectorPlan(mockDirectorPlan(ctx(15)));
  const p30 = parseDirectorPlan(mockDirectorPlan(ctx(30)));
  const p60 = parseDirectorPlan(mockDirectorPlan(ctx(60)));
  assert.ok(p30.timelineScript.length > p15.timelineScript.length);
  assert.ok(p60.timelineScript.length > p30.timelineScript.length);
});

test("DirectorPlan: schema 拒绝缺少 segmentPlan 的对象", () => {
  const result = safeParseDirectorPlan({
    version: DIRECTOR_PROMPT_VERSION,
    language: "en-US",
    targetDurationSec: 15,
    platform: "tiktok",
    strategySummary: {
      targetAudience: "x",
      corePainPoint: "y",
      emotionalAngle: "z",
      keySellingPoints: ["w"],
    },
    timelineScript: [
      {
        fromSec: 0,
        toSec: 5,
        visual: "x",
      },
    ],
    /// 故意省略 segmentPlan
  });
  assert.equal(result.ok, false);
});

test("DirectorPlan: schema 接受最小合法对象（zod 默认值兜底）", () => {
  const result = safeParseDirectorPlan({
    version: DIRECTOR_PROMPT_VERSION,
    language: "en-US",
    targetDurationSec: 15,
    platform: "tiktok",
    strategySummary: {
      targetAudience: "x",
      corePainPoint: "y",
      emotionalAngle: "z",
      keySellingPoints: ["w"],
    },
    timelineScript: [{ fromSec: 0, toSec: 5, visual: "x" }],
    segmentPlan: [
      {
        segmentIndex: 0,
        durationSec: 15,
        fromSec: 0,
        toSec: 15,
        role: "hook",
        seedancePrompt: "a clear visual prompt",
      },
    ],
    editingPlan: {},
  });
  assert.equal(result.ok, true);
});

/// ---------- P0：schema 失败 → throw（不再静默回退 mock）----------

/**
 * 构造一份合法的 LLM 输出（30s 视频，2 段 × 15s）。
 * 用于「LLM 路径成功」的快乐路径测试。
 */
function buildValidLLMOutput30s(): Record<string, unknown> {
  return {
    version: DIRECTOR_PROMPT_VERSION,
    language: "en-US",
    targetDurationSec: 30,
    platform: "tiktok",
    strategySummary: {
      targetAudience: "Homeowners 30-55",
      corePainPoint: "Manual blinds slow morning routine",
      emotionalAngle: "Calm modern home",
      keySellingPoints: ["Sets up in minutes", "Hands-free"],
      platformFit: "Vertical 9:16 demo",
      recommendedDurationReason: "Enough time for hook + demo + CTA",
    },
    timelineScript: [
      {
        fromSec: 0,
        toSec: 2,
        visual: "Close-up of sunlight hitting motorized blinds",
        cameraMovement: "slow dolly-in",
        seedanceShotPrompt: "Sunlit motorized blinds, 9:16 cinematic",
      },
      {
        fromSec: 2,
        toSec: 15,
        visual: "Person tapping smart home app, blinds rise",
        cameraMovement: "handheld",
        seedanceShotPrompt: "Hand on phone app, blinds open behind",
      },
      {
        fromSec: 15,
        toSec: 30,
        visual: "Family at breakfast in naturally lit room",
        cameraMovement: "static",
        seedanceShotPrompt: "Bright kitchen with family, soft warm grade",
      },
    ],
    segmentPlan: [
      {
        segmentIndex: 0,
        durationSec: 15,
        fromSec: 0,
        toSec: 15,
        role: "hook",
        seedancePrompt:
          "Sunlit motorized blinds opening as a hand taps a smart home app, 9:16 cinematic",
        continuityNotes: "Establish lighting + setting",
      },
      {
        segmentIndex: 1,
        durationSec: 15,
        fromSec: 15,
        toSec: 30,
        role: "cta",
        seedancePrompt:
          "Family enjoying breakfast in naturally lit room, end card with brand name",
        continuityNotes: "Continue lighting + style from segment 0",
      },
    ],
    editingPlan: {
      stitchOrder: [0, 1],
      transitions: ["match-cut"],
      captions: "Lower-third bold sans",
      logoPlacement: "bottom-right + end card",
      ctaEndCard: "Order now — link in bio",
    },
    qualityChecklist: ["Hook is visual within 2s", "CTA is concrete"],
  };
}

test("[P0] LLM 返回缺 segmentPlan → buildDirectorPlanResult 抛 DirectorSchemaError（不静默回退 mock）", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test", DIRECTOR_FORCE_MOCK: undefined }, async () => {
    const c = ctx(30);
    const invokeLLM = async () => ({
      data: {
        version: DIRECTOR_PROMPT_VERSION,
        language: "en-US",
        targetDurationSec: 30,
        platform: "tiktok",
        strategySummary: {
          targetAudience: "x",
          corePainPoint: "y",
          emotionalAngle: "z",
          keySellingPoints: ["w"],
        },
        timelineScript: [{ fromSec: 0, toSec: 5, visual: "x" }],
        /// 故意省略 segmentPlan —— 这是 LLM 漂移最常见的形态
      },
      modelUsed: "gpt-5.5",
    });

    await assert.rejects(
      buildDirectorPlanResult(c, "brief-test-1", { invokeLLM, forceMock: false }),
      (err: unknown) => {
        if (!isDirectorSchemaError(err)) {
          assert.fail(`期待 DirectorSchemaError，实际拿到 ${(err as Error).name}: ${(err as Error).message}`);
        }
        assert.equal(err.briefId, "brief-test-1");
        assert.equal(err.modelUsed, "gpt-5.5");
        /// 用户友好提示必须明确不暴露 zod 内部
        assert.match(err.userSafeMessage, /AI 视频导演|重试/);
        assert.doesNotMatch(err.userSafeMessage, /zod|ZodError|segmentPlan/i);
        /// issuesSummary 必须存在且非空
        assert.ok(err.issuesSummary.length > 0);
        /// issuesSummary 必须包含 segmentPlan 字段缺失的线索（开发者侧）
        assert.match(err.issuesSummary, /segmentPlan/);
        return true;
      },
    );
  });
});

test("[P0] LLM 返回 segmentPlan=[] → 抛 DirectorSchemaError（min(1) 校验）", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test", DIRECTOR_FORCE_MOCK: undefined }, async () => {
    const c = ctx(30);
    const invokeLLM = async () => ({
      data: {
        ...buildValidLLMOutput30s(),
        segmentPlan: [],
      },
      modelUsed: "gpt-4.1",
    });
    await assert.rejects(
      buildDirectorPlanResult(c, "brief-test-2", { invokeLLM, forceMock: false }),
      DirectorSchemaError,
    );
  });
});

test("[P0] 无 OPENAI_API_KEY → 走 mock，不 throw（默认行为）", async () => {
  await withEnv({ OPENAI_API_KEY: undefined, DIRECTOR_FORCE_MOCK: undefined }, async () => {
    /// invokeLLM 不应被调用 —— 给一个会爆炸的 stub 来验证
    const invokeLLM = async () => {
      throw new Error("invokeLLM 不应在无 API key 时被调用");
    };
    const result = await buildDirectorPlanResult(ctx(30), "brief-test-3", {
      invokeLLM,
    });
    assert.equal(result.fromMock, true);
    assert.equal(result.modelUsed, "mock");
    /// mock 路径仍输出合法 plan（保证 multi-segment 流水线测试可用）
    assert.equal(result.plan.segmentPlan.length, 2);
    parseDirectorPlan(result.plan);
  });
});

test("[P0] DIRECTOR_FORCE_MOCK=true → 即使有 API key 也走 mock（staging / 演示）", async () => {
  await withEnv(
    { OPENAI_API_KEY: "sk-test", DIRECTOR_FORCE_MOCK: "true" },
    async () => {
      const invokeLLM = async () => {
        throw new Error("invokeLLM 不应在 forceMock 时被调用");
      };
      const result = await buildDirectorPlanResult(ctx(60), "brief-test-4", {
        invokeLLM,
      });
      assert.equal(result.fromMock, true);
      assert.equal(result.modelUsed, "mock");
      assert.equal(result.plan.segmentPlan.length, 4);
    },
  );
});

test("[P0] LLM 合法返回（30s, 2 段 × 15s）→ schema 通过，fromMock=false", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test", DIRECTOR_FORCE_MOCK: undefined }, async () => {
    const invokeLLM = async () => ({
      data: buildValidLLMOutput30s(),
      modelUsed: "gpt-5.5",
    });
    const result = await buildDirectorPlanResult(ctx(30), "brief-test-5", {
      invokeLLM,
      forceMock: false,
    });
    assert.equal(result.fromMock, false);
    assert.equal(result.modelUsed, "gpt-5.5");
    assert.equal(result.plan.segmentPlan.length, 2);
    assert.equal(result.plan.segmentPlan[0].durationSec, 15);
    assert.equal(result.plan.segmentPlan[1].durationSec, 15);
    /// 关键：seedancePrompt 必须存在且非空 —— 这是付费给 Seedance 的字段
    for (const seg of result.plan.segmentPlan) {
      assert.ok(
        seg.seedancePrompt.length > 10,
        `segmentIndex=${seg.segmentIndex} seedancePrompt 太短：${seg.seedancePrompt}`,
      );
    }
  });
});

test("[P0] validateDirectorLLMOutput 把 ZodError wrap 成 DirectorSchemaError（含 cause）", () => {
  const c = ctx(15);
  try {
    validateDirectorLLMOutput(
      { version: DIRECTOR_PROMPT_VERSION /* 缺一切其它必要字段 */ },
      c,
      { modelUsed: "gpt-5.5", briefId: "brief-x" },
    );
    assert.fail("应抛错");
  } catch (err) {
    assert.ok(isDirectorSchemaError(err), `应是 DirectorSchemaError，实际是 ${(err as Error).name}`);
    assert.equal(err.modelUsed, "gpt-5.5");
    assert.equal(err.briefId, "brief-x");
    assert.ok(err.cause, "cause 必须是 ZodError");
    assert.ok(err.cause.issues.length > 0, "ZodError.issues 必须非空");
  }
});

test("[P0] validateDirectorLLMOutput 合法输入返回 DirectorPlan", () => {
  const c = ctx(30);
  const plan = validateDirectorLLMOutput(buildValidLLMOutput30s(), c, {
    modelUsed: "gpt-5.5",
    briefId: "brief-ok",
  });
  assert.equal(plan.segmentPlan.length, 2);
  assert.equal(plan.targetDurationSec, 30);
});

test("[P0] DirectorSchemaError.issuesSummary 截断到 500 字符内（防日志爆炸）", () => {
  /// 构造一个会产生大量 zod issues 的 LLM 输出
  const c = ctx(30);
  const bigGarbage: Record<string, unknown> = {
    version: "wrong-version",
    language: "x",
    targetDurationSec: "not-a-number",
    platform: "",
    strategySummary: {
      /// 所有必填都缺
    },
    timelineScript: [
      { fromSec: -1, toSec: "bad", visual: "" },
    ],
    segmentPlan: [
      {
        segmentIndex: -1,
        durationSec: 100,
        fromSec: -5,
        toSec: -1,
        role: "not-a-role",
        seedancePrompt: "",
      },
    ],
  };
  try {
    validateDirectorLLMOutput(bigGarbage, c, {
      modelUsed: "gpt-5.5",
      briefId: "brief-big",
    });
    assert.fail("应抛错");
  } catch (err) {
    if (!isDirectorSchemaError(err)) throw err;
    assert.ok(err.issuesSummary.length <= 500, `issuesSummary 应 ≤ 500 字符，实际 ${err.issuesSummary.length}`);
    /// 不应泄露 raw LLM 输出（不会出现 "not-a-role" 这类原始字符串值，因为我们只取 zod issue path/code/message）
    /// 注：zod issue.message 可能会包含期望/实际类型的描述，但不会回吐用户原始 value
  }
});

test("[P0] summarizeZodIssues 处理空 issues（应是空串而非崩）", () => {
  const fakeZodErr = { issues: [] } as unknown as Parameters<typeof summarizeZodIssues>[0];
  const summary = summarizeZodIssues(fakeZodErr);
  assert.equal(summary, "");
});

test("[P0] directorSchemaErrorToAPIResponse → 422 + retryable=true 契约", () => {
  /// 构造一个真实的 DirectorSchemaError
  const c = ctx(15);
  let captured: DirectorSchemaError | null = null;
  try {
    validateDirectorLLMOutput({}, c, { modelUsed: "gpt-5.5", briefId: "b-api" });
  } catch (err) {
    if (isDirectorSchemaError(err)) captured = err;
  }
  assert.ok(captured, "应捕获到 DirectorSchemaError");
  const { body, status } = directorSchemaErrorToAPIResponse(captured!);
  assert.equal(status, 422);
  assert.equal(body.ok, false);
  assert.equal(body.code, "director_schema_failed");
  assert.equal(body.retryable, true);
  assert.match(body.error, /AI 视频导演|重试/);
  /// 响应不应泄露 zod issues / model / briefId（用户面向 = 安全）
  assert.doesNotMatch(body.error, /gpt-5\.5|b-api|zod/i);
});
