import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveFallbackChain,
  resolveModelForTier,
} from "../src/lib/providers/openai";

/**
 * 2026-08-01 事故：生产 key 的项目只有 gpt-5.6 系权限，而回退链整条都是 4 系。
 * 每次调用吃三个 403 后静默降级到启发式 —— 线上完全看不出来，
 * 因为「降级成功」走的是成功路径。这组测试守住链首必须是有权限的模型。
 */

const TIERS = [
  "director",
  "script",
  "videoPrompt",
  "creative",
  "qa",
  "fast",
  "research",
  "vision",
] as const;

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("每个 tier 的链首都不是已知无权限的 4 系模型", () => {
  withEnv({ OPENAI_MODEL: undefined }, () => {
    for (const tier of TIERS) {
      const chain = resolveFallbackChain(tier);
      assert.ok(chain.length > 0, `${tier} 链不能为空`);
      assert.doesNotMatch(
        chain[0],
        /^gpt-4/,
        `${tier} 链首是 ${chain[0]}，当前生产 key 对 4 系一律 403`,
      );
    }
  });
});

test("旧部署的 OPENAI_MODEL=gpt-4o-mini 不会再占据链首", () => {
  withEnv({ OPENAI_MODEL: "gpt-4o-mini" }, () => {
    for (const tier of TIERS) {
      const chain = resolveFallbackChain(tier);
      assert.doesNotMatch(
        chain[0],
        /^gpt-4/,
        `${tier} 仍被旧 env 拖回 4 系，会白吃一个 403 往返`,
      );
      /// 下沉而不是删除：万一某个部署确实有 4 系权限，它还能兜底。
      /// director/script/videoPrompt 本来就拒绝 mini，它们的链里没有 mini 是对的。
      const legacyStillReachable =
        chain.includes("gpt-4o-mini") ||
        ["director", "script", "videoPrompt"].includes(tier);
      assert.ok(
        legacyStillReachable,
        `${tier} 不应把 4 系从链里删掉，只是不该放在首位`,
      );
    }
  });
});

test("客户最终看到的 tier 不退化到轻量档", () => {
  withEnv({ OPENAI_MODEL: undefined }, () => {
    for (const tier of ["director", "script", "videoPrompt"] as const) {
      assert.equal(
        resolveModelForTier(tier),
        "gpt-5.6-sol",
        `${tier} 是客户最终看到的脚本与 prompt，必须用最强档`,
      );
    }
  });
});

test("tier 专属 env 仍然优先，运维要能临时切模型", () => {
  withEnv({ OPENAI_CREATIVE_MODEL: "gpt-5.6-terra" }, () => {
    assert.equal(resolveModelForTier("creative"), "gpt-5.6-terra");
    assert.equal(resolveFallbackChain("creative")[0], "gpt-5.6-terra");
  });
});

test("链内无重复：重复候选只会白白多打一次请求", () => {
  withEnv({ OPENAI_MODEL: undefined }, () => {
    for (const tier of TIERS) {
      const chain = resolveFallbackChain(tier);
      assert.equal(new Set(chain).size, chain.length, `${tier} 链有重复`);
    }
  });
});
