import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

/**
 * AIVORA_DRY_RUN 计费保险丝回归测试。
 *
 * 约定：AIVORA_DRY_RUN=1 时进程内所有计费路径必须走 mock 或显式拒绝。
 * 这些测试逐一验证每个计费 provider 的守门行为 —— 任何一个失守都意味着
 * dry-run 下可能真实扣费。
 */

function withEnv(
  t: TestContext,
  next: Partial<Record<string, string | undefined>>,
) {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(next)) {
    originals[key] = process.env[key];
    const v = next[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      const v = originals[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  });
}

test("isDryRun：解析 1/true/yes/on，其余为 false", async (t) => {
  const { isDryRun } = await import("../src/lib/config/dry-run");
  for (const v of ["1", "true", "yes", "on", "TRUE", " 1 "]) {
    withEnv(t, { AIVORA_DRY_RUN: v });
    assert.equal(isDryRun(), true, `AIVORA_DRY_RUN=${JSON.stringify(v)} 应为 dry-run`);
  }
  for (const v of ["", "0", "false", "off", undefined]) {
    withEnv(t, { AIVORA_DRY_RUN: v });
    assert.equal(isDryRun(), false, `AIVORA_DRY_RUN=${JSON.stringify(v)} 不应为 dry-run`);
  }
});

test("dry-run：出片线路强制落到 mock（即便 SHUYU_API_KEY 存在且 VIDEO_ENGINE_MOCK=false），点名真实线路被拒，全程零外呼", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    VERCEL_ENV: "preview",
    SHUYU_API_KEY: "fake-key-should-never-be-used",
    VIDEO_ENGINE_MOCK: "false",
    VIDEO_PROVIDER: undefined,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`dry-run 下不该有任何外呼：${String(input)}`);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { isMockVideoRuntime } = await import("../src/lib/config/env");
  const { selectVideoRouteSnapshot, VideoRouteSelectionError } = await import(
    "../src/lib/video-generation/video-route-selection"
  );
  const { createVideoProviderByRouteSnapshot } = await import("../src/lib/video-generation/providers");

  assert.equal(isMockVideoRuntime(), true, "dry-run 盖过 VIDEO_ENGINE_MOCK=false");
  /// 生产残留的旧值 VIDEO_PROVIDER=byteplus（按 shuyu 处理）也一样
  for (const provider of [undefined, "shuyu", "byteplus"]) {
    withEnv(t, { VIDEO_PROVIDER: provider });
    for (const isInternalStaff of [false, true]) {
      const snapshot = selectVideoRouteSnapshot({ isInternalStaff });
      assert.equal(snapshot.videoRouteSnapshot, "mock", `${String(provider)} / staff=${isInternalStaff}`);
      assert.throws(
        () => selectVideoRouteSnapshot({ isInternalStaff, requestedRouteId: "buddy" }),
        (error: unknown) => error instanceof VideoRouteSelectionError && error.code === "MOCK_ROUTE_CONFLICT",
        "dry-run 下不许点名真实线路",
      );
    }
  }

  /// mock 线路的适配器本身不出网：提交与查询都在进程内
  const provider = createVideoProviderByRouteSnapshot(selectVideoRouteSnapshot({ isInternalStaff: false }));
  assert.equal(provider.id, "mock");
  const { providerJobId } = await provider.createVideoJob({ prompt: "test", durationSec: 5 });
  assert.match(providerJobId, /^batchmock_/, `dry-run 提交必须返回 mock 任务号，实际: ${providerJobId}`);
  const status = await provider.getVideoJobStatus(providerJobId);
  assert.equal(status.providerJobId, providerJobId, "mock 状态查询应可用");
});

test("dry-run：OpenAI LLM 强制 mock，chatJson 主动拒绝", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    LLM_FORCE_MOCK: undefined,
    OPENAI_API_KEY: "sk-fake-should-never-be-used",
  });
  const { isLLMForcedMock, chatJson } = await import(
    "../src/lib/providers/openai"
  );
  assert.equal(isLLMForcedMock(), true, "dry-run 下 LLM 必须强制 mock");
  await assert.rejects(
    () => chatJson({ system: "s", user: "u" }),
    /refusing to send real OpenAI request/,
  );
});

test("dry-run：OpenAI 图像生成视为不可用 → 走占位 mock", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    OPENAI_API_KEY: "sk-fake",
    IMAGE_ENGINE_MOCK: undefined,
  });
  const { isImageGenAvailable, generateImages } = await import(
    "../src/lib/providers/openai-image"
  );
  assert.equal(isImageGenAvailable(), false);
  const result = await generateImages({ prompt: "logo", n: 1 });
  assert.equal(result.fromMock, true, "dry-run 下图像生成必须来自 mock");
});

test("dry-run：Shuyu Image 2 提交、轮询与输出下载全程走本地 mock", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    VERCEL_ENV: "preview",
    IMAGE_ENGINE_MOCK: undefined,
    SHUYU_API_KEY: "fake-key-should-never-be-used",
  });
  const {
    fetchShuyuOutputImage,
    pollShuyuImageTask,
    submitShuyuImageTask,
  } = await import("../src/lib/providers/shuyu-image-provider");

  const submitted = await submitShuyuImageTask({
    requestKey: "dry-run-image",
    prompt: "A stable product image for dry-run acceptance",
    aspectRatio: "1:1",
    resolution: "1K",
  });
  assert.match(submitted.externalTaskId, /^mock_shuyu_image_/);
  assert.equal(submitted.planSnapshot.family, "gpt-image-2");

  const polled = await pollShuyuImageTask(submitted.externalTaskId);
  assert.equal(polled.status, "succeeded");
  const output = await fetchShuyuOutputImage(polled.outputUrls[0]);
  assert.equal(output.mimeType, "image/png");
  assert.ok(output.bytes.length > 0);
});
