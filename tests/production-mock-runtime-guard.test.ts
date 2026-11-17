import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { MockVideoProvider } from "../src/lib/video-generation/providers/mock-video-provider";
import { readFileSync } from "node:fs";

function withEnv(
  t: TestContext,
  next: Partial<Record<string, string | undefined>>,
) {
  const originals: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(next)) {
    originals[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("production runtime: MockVideoProvider 拒绝创建任务", async (t) => {
  withEnv(t, {
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
  });

  const provider = new MockVideoProvider();
  await assert.rejects(
    () => provider.createVideoJob({ prompt: "must never become a mock job" }),
    /production.*mock/i,
  );
});

test("production runtime: 残留的旧值 VIDEO_PROVIDER=byteplus（按 shuyu 处理）也打不开 mock——就绪检查与 mock 闸门都拒绝", async (t) => {
  withEnv(t, {
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "true",
    SHUYU_API_KEY: "configured",
  });

  const { assertMockVideoRuntimeAllowed, isMockVideoRuntime, videoGenerationRuntimeReadiness } = await import(
    "../src/lib/config/env"
  );
  assert.equal(isMockVideoRuntime(), true);
  assert.deepEqual(videoGenerationRuntimeReadiness(), { ok: false, reason: "production_mock_forbidden" });
  assert.throws(() => assertMockVideoRuntimeAllowed(), /production.*mock/i);
  /// 线路落到 mock 快照，但 mock 适配器在生产一律拒绝建任务
  const { selectVideoRouteSnapshot } = await import("../src/lib/video-generation/video-route-selection");
  const { createVideoProviderByRouteSnapshot } = await import("../src/lib/video-generation/providers");
  const provider = createVideoProviderByRouteSnapshot(selectVideoRouteSnapshot({ isInternalStaff: false }));
  assert.equal(provider.id, "mock");
  await assert.rejects(
    () => provider.createVideoJob({ prompt: "must never become a mock job" }),
    /production.*mock/i,
  );
});

test("preview rehearsal: MockVideoProvider 仍可创建零成本任务", async (t) => {
  withEnv(t, {
    VERCEL_ENV: "preview",
    NODE_ENV: "production",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
  });

  const provider = new MockVideoProvider();
  const result = await provider.createVideoJob({ prompt: "preview fixture" });
  assert.match(result.providerJobId, /^batchmock_/);
});

test("local optimized rehearsal: explicit dry-run 可在 next start 下创建零成本任务", async (t) => {
  withEnv(t, {
    VERCEL_ENV: undefined,
    NODE_ENV: "production",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
  });

  const provider = new MockVideoProvider();
  const result = await provider.createVideoJob({ prompt: "local acceptance fixture" });
  assert.match(result.providerJobId, /^batchmock_/);
});

test("customer dispatch performs production readiness before plan, quota, or job creation", () => {
  const source = readFileSync(
    "src/app/api/video-generation/dispatch/route.ts",
    "utf8",
  );
  const readiness = source.indexOf("videoGenerationRuntimeReadiness()");
  const plan = source.indexOf("plan = await buildPlan");
  const quota = source.indexOf("await assertQuotaBatchForSession");
  const createJob = source.indexOf("await dispatchVideoForBrief");
  assert.ok(readiness > 0);
  assert.ok(readiness < plan, "readiness must precede paid LLM planning");
  assert.ok(readiness < quota, "readiness must precede quota consumption");
  assert.ok(readiness < createJob, "readiness must precede provider job creation");
});
