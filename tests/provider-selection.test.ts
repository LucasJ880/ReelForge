import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetAppEnvForTests,
} from "../src/lib/config/env";
import {
  __resetAiProviderForTests,
  createAiProvider,
} from "../src/lib/ai";
import {
  __resetStorageProviderForTests,
  createStorageProvider,
} from "../src/lib/storage";
import {
  __resetVideoProviderForTests,
  createVideoProvider,
  normalizeStatusBuiltin,
} from "../src/lib/video-generation/providers";
import {
  __resetContentReviewProviderForTests,
  createContentReviewProvider,
} from "../src/lib/content-review";
import { BytePlusVideoProvider } from "../src/lib/video-generation/providers/byteplus-video-provider";

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
  __resetAppEnvForTests();
  __resetAiProviderForTests();
  __resetStorageProviderForTests();
  __resetVideoProviderForTests();
  __resetContentReviewProviderForTests();
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    __resetAppEnvForTests();
    __resetAiProviderForTests();
    __resetStorageProviderForTests();
    __resetVideoProviderForTests();
    __resetContentReviewProviderForTests();
  }
}

test("AI provider 选择：默认 → openai；显式写 openai 也一样", () => {
  withEnv({ AI_PROVIDER: undefined }, () => {
    assert.equal(createAiProvider().id, "openai");
  });
  withEnv({ AI_PROVIDER: "openai" }, () => {
    assert.equal(createAiProvider().id, "openai");
  });
});

test("AI provider 选择：火山大模型已删，AI_PROVIDER=volcengine 报清晰错误", () => {
  assert.throws(
    () => withEnv({ AI_PROVIDER: "volcengine" }, createAiProvider),
    /AI_PROVIDER="volcengine" 不在允许列表/,
  );
});

test("Storage provider 选择：默认 → vercel_blob；显式写 vercel_blob 也一样", () => {
  withEnv({ STORAGE_PROVIDER: undefined }, () => {
    assert.equal(createStorageProvider().id, "vercel_blob");
  });
  withEnv({ STORAGE_PROVIDER: "vercel_blob" }, () => {
    assert.equal(createStorageProvider().id, "vercel_blob");
  });
});

test("Storage provider 选择：火山 TOS 已删，STORAGE_PROVIDER=volcengine_tos 报清晰错误", () => {
  assert.throws(
    () => withEnv({ STORAGE_PROVIDER: "volcengine_tos" }, createStorageProvider),
    /STORAGE_PROVIDER="volcengine_tos" 不在允许列表/,
  );
});

test("Provider 选择：已退役的 REGION 不再影响任何 provider", () => {
  withEnv({ REGION: "future", AI_PROVIDER: undefined, STORAGE_PROVIDER: undefined }, () => {
    assert.equal(createAiProvider().id, "openai");
    assert.equal(createStorageProvider().id, "vercel_blob");
    assert.equal(createVideoProvider().id, "byteplus");
  });
});

test("Video provider：默认 BytePlus 国际 Seedance", () => {
  withEnv({ REGION: undefined }, () => {
    const v = createVideoProvider();
    assert.equal(v.id, "byteplus");
  });
});

test("Video provider 状态归一：覆盖所有 Seedance 原始状态", () => {
  assert.equal(normalizeStatusBuiltin("succeeded"), "succeeded");
  assert.equal(normalizeStatusBuiltin("success"), "succeeded");
  assert.equal(normalizeStatusBuiltin("completed"), "succeeded");
  assert.equal(normalizeStatusBuiltin("done"), "succeeded");
  assert.equal(normalizeStatusBuiltin("failed"), "failed");
  assert.equal(normalizeStatusBuiltin("error"), "failed");
  assert.equal(normalizeStatusBuiltin("expired"), "failed");
  assert.equal(normalizeStatusBuiltin("cancelled"), "cancelled");
  assert.equal(normalizeStatusBuiltin("canceled"), "cancelled");
  assert.equal(normalizeStatusBuiltin("queued"), "queued");
  assert.equal(normalizeStatusBuiltin("pending"), "queued");
  assert.equal(normalizeStatusBuiltin("running"), "processing");
  assert.equal(normalizeStatusBuiltin("processing"), "processing");
  assert.equal(normalizeStatusBuiltin("WhoKnows"), "unknown");
});

test("BytePlusVideoProvider.normalizeProviderStatus 大小写不敏感", () => {
  const p = new BytePlusVideoProvider();
  assert.equal(p.normalizeProviderStatus("SUCCEEDED"), "succeeded");
  assert.equal(p.normalizeProviderStatus(" Running "), "processing");
});

test("BytePlusVideoProvider.cancelVideoJob 当前 unsupported", async () => {
  const p = new BytePlusVideoProvider();
  const r = await p.cancelVideoJob("any-job-id");
  assert.equal(r.supported, false);
});

test("Content review provider：CONTENT_REVIEW_ENABLED=false 始终 noop", () => {
  withEnv(
    {
      CONTENT_REVIEW_ENABLED: "false",
      CONTENT_REVIEW_PROVIDER: "noop",
    },
    () => {
      const p = createContentReviewProvider();
      assert.equal(p.id, "noop");
    },
  );
});

test("Content review provider：已归档的 volcengine 配置被拒绝", () => {
  assert.throws(
    () => withEnv({ CONTENT_REVIEW_PROVIDER: "volcengine" }, createContentReviewProvider),
    /CONTENT_REVIEW_PROVIDER="volcengine"/,
  );
});

test("Noop review provider 始终返回 approved", async () => {
  withEnv(
    { CONTENT_REVIEW_ENABLED: "false" },
    async () => {
      const p = createContentReviewProvider();
      const r = await p.reviewText({
        kind: "generation_prompt",
        text: "this is sensitive",
      });
      assert.equal(r.verdict, "approved");
      assert.ok(r.reviewId?.startsWith("noop_"));
    },
  );
});

test("Content review provider：ENABLED=true + noop 明确保持 noop", () => {
  withEnv({ CONTENT_REVIEW_ENABLED: "true", CONTENT_REVIEW_PROVIDER: "noop" }, () => {
    assert.equal(createContentReviewProvider().id, "noop");
  });
});
