import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/providers/openai";

const { resolveModelForTier, resolveFallbackChain } = __test__;

function withEnv<T>(
  patches: Record<string, string | undefined>,
  fn: () => T,
): T {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patches)) {
    prev[k] = process.env[k];
    if (patches[k] === undefined) delete process.env[k];
    else process.env[k] = patches[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("director tier: 默认走最强档（不可退到 mini）", () => {
  withEnv(
    {
      OPENAI_DIRECTOR_MODEL: undefined,
      OPENAI_MODEL: "gpt-4o-mini",
    },
    () => {
      const model = resolveModelForTier("director");
      assert.doesNotMatch(model, /mini/);
      assert.equal(model, "gpt-5.6-sol");
    },
  );
});

test("script tier: 默认走最强档（修复 wizard-script-service.ts 历史硬编码 mini）", () => {
  withEnv({ OPENAI_SCRIPT_MODEL: undefined }, () => {
    const model = resolveModelForTier("script");
    assert.doesNotMatch(model, /mini/);
    assert.equal(model, "gpt-5.6-sol");
  });
});

test("videoPrompt tier: 默认走最强档", () => {
  withEnv({ OPENAI_VIDEO_PROMPT_MODEL: undefined }, () => {
    const model = resolveModelForTier("videoPrompt");
    assert.doesNotMatch(model, /mini/);
    assert.equal(model, "gpt-5.6-sol");
  });
});

test("director tier: env 覆盖优先（OPENAI_DIRECTOR_MODEL）", () => {
  withEnv({ OPENAI_DIRECTOR_MODEL: "gpt-5.5-preview" }, () => {
    assert.equal(resolveModelForTier("director"), "gpt-5.5-preview");
  });
});

test("director tier fallback chain: 永远不退到 mini", () => {
  withEnv({ OPENAI_DIRECTOR_MODEL: undefined }, () => {
    const chain = resolveFallbackChain("director");
    for (const m of chain) {
      assert.doesNotMatch(m, /mini/, `director fallback chain 不应含 mini: ${m}`);
    }
    /// 至少保留一个稳定可用的备份
    assert.ok(
      chain.includes("gpt-5.5") || chain.includes("gpt-4.1"),
      `chain 应有更低档兜底：${JSON.stringify(chain)}`,
    );
  });
});

test("script tier fallback chain: 永远不退到 mini", () => {
  const chain = resolveFallbackChain("script");
  for (const m of chain) {
    assert.doesNotMatch(m, /mini/);
  }
});

test("videoPrompt tier fallback chain: 永远不退到 mini", () => {
  const chain = resolveFallbackChain("videoPrompt");
  for (const m of chain) {
    assert.doesNotMatch(m, /mini/);
  }
});

test("fast tier 仍可使用 mini（用于分类/抽取）", () => {
  withEnv({ OPENAI_FAST_MODEL: "gpt-4o-mini", OPENAI_MODEL: undefined }, () => {
    const model = resolveModelForTier("fast");
    assert.equal(model, "gpt-4o-mini");
  });
});
