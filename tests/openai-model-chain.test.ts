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

/* ── P01-A · vision 参数化与回退（2026-10-26）────────────────────────── */

import { mock } from "node:test";
import { REASONING_HEADROOM_TOKENS, __test__, analyzeImages, openai } from "../src/lib/providers/openai";
import { OpenAiProvider, openAiProbePlan } from "../src/lib/ai/providers/openai-provider";

async function withEnvAsync(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const VISION_ENV = {
  OPENAI_API_KEY: "sk-test-vision",
  OPENAI_MODEL: undefined,
  OPENAI_VISION_MODEL: undefined,
  LLM_FORCE_MOCK: undefined,
  DRY_RUN: undefined,
};

type CreateParams = {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  max_tokens?: number;
  max_completion_tokens?: number;
};

function okResponse(payload: Record<string, unknown>) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function modelMissing(model: string) {
  const err = new Error(`The model \`${model}\` does not exist or you do not have access to it.`) as Error & {
    status?: number;
    code?: string;
  };
  err.status = 404;
  err.code = "model_not_found";
  return err;
}

/** 把 chat.completions.create 换成记录参数的假实现；返回捕获到的每次调用参数。 */
function stubCreate(impl: (params: CreateParams, callIndex: number) => unknown): CreateParams[] {
  const calls: CreateParams[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    calls.push(params);
    return impl(params, calls.length - 1);
  }) as never);
  return calls;
}

test("vision 链：首选 sol，备用 terra；不再把 403 的 gpt-4o 当备用线", () => {
  withEnv({ OPENAI_MODEL: undefined, OPENAI_VISION_MODEL: undefined }, () => {
    assert.deepEqual(resolveFallbackChain("vision"), ["gpt-5.6-sol", "gpt-5.6-terra"]);
  });
});

test("analyzeImages：首选模型 404 / model_not_found 时回退到 terra，结果标 fallbackUsed", async () => {
  await withEnvAsync(VISION_ENV, async () => {
    const calls = stubCreate((params) => {
      if (params.model === "gpt-5.6-sol") throw modelMissing(params.model);
      return okResponse({ frames: [] });
    });
    try {
      const result = await analyzeImages(["data:image/jpeg;base64,AAAA"], "sys", "user");
      assert.deepEqual(calls.map((c) => c.model), ["gpt-5.6-sol", "gpt-5.6-terra"]);
      assert.equal(result.modelUsed, "gpt-5.6-terra");
      assert.equal(result.fallbackUsed, true);
      assert.equal(result.tier, "vision");
      assert.deepEqual(result.data, { frames: [] });
    } finally {
      mock.restoreAll();
    }
  });
});

test("analyzeImages：限流 / 5xx 不回退——那不是模型选错，换模型只会多花一次钱", async () => {
  await withEnvAsync(VISION_ENV, async () => {
    const calls = stubCreate(() => {
      const err = new Error("Rate limit reached") as Error & { status?: number };
      err.status = 429;
      throw err;
    });
    try {
      await assert.rejects(analyzeImages(["https://x/1.jpg"], "sys", "user"), /Rate limit/);
      assert.deepEqual(calls.map((c) => c.model), ["gpt-5.6-sol"], "只打一次，不去试 terra");
    } finally {
      mock.restoreAll();
    }
  });
});

test("analyzeImages：默认 detail=low、max 1200（历史行为不变）；传了 detail / maxTokens 就透传", async () => {
  await withEnvAsync(VISION_ENV, async () => {
    const calls = stubCreate(() => okResponse({ ok: true }));
    try {
      await analyzeImages(["https://x/1.jpg", "https://x/2.jpg"], "sys", "user");
      const first = calls[0]!;
      const firstImages = (first.messages[1]!.content as Array<{ type: string; image_url?: { detail?: string } }>)
        .filter((part) => part.type === "image_url");
      assert.equal(firstImages.length, 2);
      assert.ok(firstImages.every((part) => part.image_url?.detail === "low"));
      /// 5.x 系只收 max_completion_tokens（与 chatJson 同一条规则）；正文上限 1200 之外另留思考余量
      assert.equal(first.max_completion_tokens, 1200 + REASONING_HEADROOM_TOKENS);
      assert.equal(first.max_tokens, undefined);

      await analyzeImages(["https://x/1.jpg"], "sys", "user", { detail: "high", maxTokens: 400 });
      const second = calls[1]!;
      const secondImages = (second.messages[1]!.content as Array<{ type: string; image_url?: { detail?: string } }>)
        .filter((part) => part.type === "image_url");
      assert.equal(secondImages[0]?.image_url?.detail, "high");
      assert.equal(second.max_completion_tokens, 400 + REASONING_HEADROOM_TOKENS);
    } finally {
      mock.restoreAll();
    }
  });
});

test("AiProvider 抽象层：OpenAiProvider.analyzeImages 把 detail / maxTokens 带到底层", async () => {
  await withEnvAsync(VISION_ENV, async () => {
    const calls = stubCreate(() => okResponse({ ok: true }));
    try {
      const provider = new OpenAiProvider();
      await provider.analyzeImages({
        imageUrls: ["https://x/1.jpg"],
        system: "sys",
        user: "user",
        detail: "auto",
        maxTokens: 900,
      });
      const images = (calls[0]!.messages[1]!.content as Array<{ type: string; image_url?: { detail?: string } }>)
        .filter((part) => part.type === "image_url");
      assert.equal(images[0]?.image_url?.detail, "auto");
      assert.equal(calls[0]!.max_completion_tokens, 900 + REASONING_HEADROOM_TOKENS);
    } finally {
      mock.restoreAll();
    }
  });
});

test("旧 env 写了 4 系（OPENAI_MODEL=gpt-4o-mini / OPENAI_VISION_MODEL=gpt-4o）：vision 链首仍是 sol，4 系沉到链尾", () => {
  withEnv({ OPENAI_MODEL: "gpt-4o-mini", OPENAI_VISION_MODEL: undefined }, () => {
    assert.deepEqual(resolveFallbackChain("vision"), ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-4o-mini"]);
  });
  withEnv({ OPENAI_MODEL: undefined, OPENAI_VISION_MODEL: "gpt-4o" }, () => {
    assert.deepEqual(resolveFallbackChain("vision"), ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-4o"]);
    /// 探测与生产同源：探测计划的链首就是 analyzeImages 会先打的模型，不再是 env 里那个 403 的 4o
    const plan = openAiProbePlan();
    assert.deepEqual(plan.visionModels, resolveFallbackChain("vision"));
    assert.equal(plan.visionModels[0], "gpt-5.6-sol");
  });
});

test("isModelMissingError：404 / model_not_found / 「does not exist」算模型缺失；429 与 5xx 哪怕报文写 unavailable 也不算", () => {
  const missing = __test__.isModelMissingError;
  assert.equal(missing(Object.assign(new Error("x"), { status: 404 })), true);
  assert.equal(missing(Object.assign(new Error("x"), { code: "model_not_found" })), true);
  assert.equal(missing(new Error("The model `gpt-5.6-sol` does not exist or you do not have access to it.")), true);
  assert.equal(missing(Object.assign(new Error("The model gpt-5.6-sol is currently unavailable"), { status: 503 })), false);
  assert.equal(missing(Object.assign(new Error("Rate limit reached for model gpt-5.6-sol"), { status: 429 })), false);
  assert.equal(missing(Object.assign(new Error("Bad gateway"), { status: 502 })), false);
  assert.equal(missing(null), false);
});

test("analyzeImages：整条 vision 链都 404 → 两个模型都试过，抛出最后一个错（能力回写走错误分支）", async () => {
  await withEnvAsync(VISION_ENV, async () => {
    const calls = stubCreate((params) => {
      throw modelMissing(params.model);
    });
    try {
      await assert.rejects(
        analyzeImages(["https://x/1.jpg"], "sys", "user"),
        /gpt-5\.6-terra.*does not exist/,
      );
      assert.deepEqual(calls.map((c) => c.model), ["gpt-5.6-sol", "gpt-5.6-terra"]);
    } finally {
      mock.restoreAll();
    }
  });
});

test("analyzeImages：503 且报文含 model … unavailable → 不回退、直接抛（上游抖动不是模型选错）", async () => {
  await withEnvAsync(VISION_ENV, async () => {
    const calls = stubCreate((params) => {
      const err = new Error(`The model ${params.model} is currently unavailable`) as Error & { status?: number };
      err.status = 503;
      throw err;
    });
    try {
      await assert.rejects(analyzeImages(["https://x/1.jpg"], "sys", "user"), /currently unavailable/);
      assert.deepEqual(calls.map((c) => c.model), ["gpt-5.6-sol"]);
    } finally {
      mock.restoreAll();
    }
  });
});
