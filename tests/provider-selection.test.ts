import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetAppEnvForTests,
  getAppEnv,
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
  createVideoProviderByRouteSnapshot,
  normalizeStatusBuiltin,
  RetiredVideoRouteError,
} from "../src/lib/video-generation/providers";
import { MockVideoProvider } from "../src/lib/video-generation/providers/mock-video-provider";
import { ShuyuVideoProvider } from "../src/lib/video-generation/providers/shuyu-video-provider";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-registry";

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
    assert.equal(getAppEnv().videoProvider, "shuyu");
  });
});

test("Video provider：默认运行时是 Shuyu；写 shuyu、残留旧值 byteplus 都一样，mock 只在显式写时", () => {
  for (const value of [undefined, "shuyu", "byteplus"]) {
    withEnv({ REGION: undefined, VIDEO_PROVIDER: value }, () => {
      assert.equal(getAppEnv().videoProvider, "shuyu", String(value));
    });
  }
  withEnv({ VIDEO_PROVIDER: "mock" }, () => {
    assert.equal(getAppEnv().videoProvider, "mock");
  });
});

test("Video provider 工厂：适配器只由持久化的线路快照决定——buddy → Shuyu、mock → mock；与 VIDEO_PROVIDER 无关", () => {
  for (const value of [undefined, "shuyu", "byteplus", "mock"]) {
    withEnv({ VIDEO_PROVIDER: value }, () => {
      const shuyu = createVideoProviderByRouteSnapshot(createVideoRouteSnapshot("buddy"));
      assert.ok(shuyu instanceof ShuyuVideoProvider, String(value));
      assert.equal(shuyu.id, "shuyu");
      const mock = createVideoProviderByRouteSnapshot(createVideoRouteSnapshot("mock"));
      assert.ok(mock instanceof MockVideoProvider, String(value));
      assert.equal(mock.id, "mock");
    });
  }
});

test("Video provider 工厂：线路与适配器名对不上的快照拒绝；已下线线路的快照（runway、两条直连）抛 RetiredVideoRouteError", () => {
  assert.throws(
    () =>
      createVideoProviderByRouteSnapshot({
        videoRouteSnapshot: "buddy",
        videoModelSnapshot: "studio-video",
        videoProviderAdapterSnapshot: "mock",
      } as VideoRouteSnapshot),
    /Shuyu route snapshot has an incompatible adapter/,
  );
  assert.throws(
    () =>
      createVideoProviderByRouteSnapshot({
        videoRouteSnapshot: "mock",
        videoModelSnapshot: "aivora-deterministic-mock-v1",
        videoProviderAdapterSnapshot: "shuyu",
      } as VideoRouteSnapshot),
    /Mock route snapshot has an incompatible adapter/,
  );
  for (const retired of [
    { videoRouteSnapshot: "byteplus_international", videoModelSnapshot: "dreamina-seedance-2-0-260128", videoProviderAdapterSnapshot: "byteplus" },
    { videoRouteSnapshot: "volcengine_cn_legacy", videoModelSnapshot: "doubao-seedance-2-0-260128", videoProviderAdapterSnapshot: "byteplus" },
    { videoRouteSnapshot: "runway", videoModelSnapshot: "klingO3_pro", videoProviderAdapterSnapshot: "runway" },
  ]) {
    assert.throws(
      () => createVideoProviderByRouteSnapshot(retired as VideoRouteSnapshot),
      (error: unknown) => error instanceof RetiredVideoRouteError && error.routeId === retired.videoRouteSnapshot,
      retired.videoRouteSnapshot,
    );
  }
});

test("Video provider 状态归一（内置表，mock 适配器用）：覆盖所有原始状态", () => {
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

test("ShuyuVideoProvider.normalizeProviderStatus 大小写与首尾空白不敏感；认不得的状态是 unknown", () => {
  const p = new ShuyuVideoProvider("studio-video", { env: {} });
  assert.equal(p.normalizeProviderStatus("COMPLETED"), "succeeded");
  assert.equal(p.normalizeProviderStatus(" Processing "), "processing");
  assert.equal(p.normalizeProviderStatus("Queued"), "queued");
  assert.equal(p.normalizeProviderStatus("WhoKnows"), "unknown");
});

test("ShuyuVideoProvider.cancelVideoJob 当前 unsupported（不发请求）", async () => {
  const p = new ShuyuVideoProvider("studio-video", {
    env: {},
    fetchImpl: (async () => {
      throw new Error("取消不该发任何请求");
    }) as unknown as typeof fetch,
  });
  const r = await p.cancelVideoJob("any-job-id");
  assert.equal(r.supported, false);
});
