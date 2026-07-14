import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { MockVideoProvider } from "../src/lib/video-generation/providers/mock-video-provider";

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

test("production runtime: BytePlus mock 分支拒绝 legacy Seedance 提交", async (t) => {
  withEnv(t, {
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "true",
    BYTEPLUS_ARK_API_KEY: "",
  });

  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  await assert.rejects(
    () => submitSeedanceJob({ prompt: "must never become a mock job" }),
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
