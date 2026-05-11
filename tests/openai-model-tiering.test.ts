import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/providers/openai";

const { resolveModelForTier, resolveFallbackChain, isModelMissingError } = __test__;

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

test("resolveModelForTier: 默认 creative tier 不再是 mini", () => {
  withEnv(
    {
      OPENAI_CREATIVE_MODEL: undefined,
      OPENAI_MODEL: undefined,
    },
    () => {
      const model = resolveModelForTier("creative");
      assert.notEqual(model, "gpt-4o-mini");
      assert.match(model, /^gpt-/);
    },
  );
});

test("resolveModelForTier: tier 专属 env 覆盖 OPENAI_MODEL（向后兼容）", () => {
  withEnv(
    {
      OPENAI_CREATIVE_MODEL: "gpt-5.5",
      OPENAI_MODEL: "gpt-4o-mini",
    },
    () => {
      assert.equal(resolveModelForTier("creative"), "gpt-5.5");
      /// fast tier 没有覆盖，用 OPENAI_MODEL（兼容旧部署）
      assert.equal(resolveModelForTier("fast"), "gpt-4o-mini");
    },
  );
});

test("resolveFallbackChain: 首选模型在最前，后续按内置 chain 去重补齐", () => {
  withEnv({ OPENAI_CREATIVE_MODEL: "gpt-5.5" }, () => {
    const chain = resolveFallbackChain("creative");
    assert.equal(chain[0], "gpt-5.5");
    /// chain 必须包含一个我们账号里 100% 可用的备份模型
    assert.ok(
      chain.includes("gpt-4o") || chain.includes("gpt-4o-mini"),
      `fallback chain 缺少安全模型：${JSON.stringify(chain)}`,
    );
    /// 没有重复
    assert.equal(new Set(chain).size, chain.length);
  });
});

test("resolveFallbackChain: 若首选模型已在内置 chain 中，不重复", () => {
  withEnv({ OPENAI_CREATIVE_MODEL: "gpt-4.1" }, () => {
    const chain = resolveFallbackChain("creative");
    assert.equal(chain[0], "gpt-4.1");
    assert.equal(new Set(chain).size, chain.length);
  });
});

test("isModelMissingError: 识别 404 / model_not_found / 文本提示", () => {
  assert.equal(isModelMissingError({ status: 404 }), true);
  assert.equal(isModelMissingError({ code: "model_not_found" }), true);
  assert.equal(
    isModelMissingError(new Error("The model `gpt-5.5` does not exist")),
    true,
  );
  assert.equal(
    isModelMissingError(new Error("rate_limit_exceeded")),
    false,
  );
  assert.equal(isModelMissingError(null), false);
});
