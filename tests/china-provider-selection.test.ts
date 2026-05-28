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
import { VolcengineVideoProvider } from "../src/lib/video-generation/providers/volcengine-video-provider";

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

test("AI provider 选择：默认（海外）→ openai", () => {
  withEnv(
    { AI_PROVIDER: undefined, REGION: undefined },
    () => {
      const ai = createAiProvider();
      assert.equal(ai.id, "openai");
    },
  );
});

test("AI provider 选择：REGION=cn 默认 → volcengine", () => {
  withEnv({ REGION: "cn", AI_PROVIDER: undefined }, () => {
    const ai = createAiProvider();
    assert.equal(ai.id, "volcengine");
  });
});

test("AI provider 选择：显式 AI_PROVIDER=volcengine 覆盖海外默认", () => {
  withEnv({ AI_PROVIDER: "volcengine", REGION: undefined }, () => {
    const ai = createAiProvider();
    assert.equal(ai.id, "volcengine");
  });
});

test("Storage provider 选择：默认 → vercel_blob", () => {
  withEnv({ STORAGE_PROVIDER: undefined, REGION: undefined }, () => {
    const s = createStorageProvider();
    assert.equal(s.id, "vercel_blob");
  });
});

test("Storage provider 选择：REGION=cn → volcengine_tos", () => {
  withEnv({ REGION: "cn", STORAGE_PROVIDER: undefined }, () => {
    const s = createStorageProvider();
    assert.equal(s.id, "volcengine_tos");
  });
});

test("Video provider：始终 volcengine（即梦/Seedance）", () => {
  withEnv({ REGION: undefined }, () => {
    const v = createVideoProvider();
    assert.equal(v.id, "volcengine");
  });
  withEnv({ REGION: "cn" }, () => {
    const v = createVideoProvider();
    assert.equal(v.id, "volcengine");
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

test("VolcengineVideoProvider.normalizeProviderStatus 大小写不敏感", () => {
  const p = new VolcengineVideoProvider();
  assert.equal(p.normalizeProviderStatus("SUCCEEDED"), "succeeded");
  assert.equal(p.normalizeProviderStatus(" Running "), "processing");
});

test("VolcengineVideoProvider.cancelVideoJob 当前 unsupported", async () => {
  const p = new VolcengineVideoProvider();
  const r = await p.cancelVideoJob("any-job-id");
  assert.equal(r.supported, false);
});

test("Content review provider：CONTENT_REVIEW_ENABLED=false 始终 noop（即便 PROVIDER=volcengine）", () => {
  withEnv(
    {
      CONTENT_REVIEW_ENABLED: "false",
      CONTENT_REVIEW_PROVIDER: "volcengine",
    },
    () => {
      const p = createContentReviewProvider();
      assert.equal(p.id, "noop");
    },
  );
});

test("Content review provider：ENABLED=true + provider=volcengine → volcengine", () => {
  withEnv(
    {
      CONTENT_REVIEW_ENABLED: "true",
      CONTENT_REVIEW_PROVIDER: "volcengine",
    },
    () => {
      const p = createContentReviewProvider();
      assert.equal(p.id, "volcengine");
    },
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

test("Volcengine review provider 未实现时抛清晰错误（不允许静默放行）", async () => {
  withEnv(
    {
      CONTENT_REVIEW_ENABLED: "true",
      CONTENT_REVIEW_PROVIDER: "volcengine",
    },
    async () => {
      const p = createContentReviewProvider();
      await assert.rejects(
        () => p.reviewText({ kind: "user_upload", text: "x" }),
        /尚未实现/,
      );
    },
  );
});
