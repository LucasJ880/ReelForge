import assert from "node:assert/strict";
import test from "node:test";
import { ProviderSubmissionError } from "../src/lib/video-generation/providers/submission-error";

import {
  BYTEPLUS_ARK_BASE_URL,
  VOLCENGINE_CN_ARK_BASE_URL,
  getSeedanceStatus,
  resolveBytePlusArkBaseUrl,
  resolveVolcengineLegacyArkBaseUrl,
  submitSeedanceJob,
} from "../src/lib/providers/seedance";

test("BytePlus endpoint guard: 默认值与尾斜杠归一到国际端点", () => {
  assert.equal(resolveBytePlusArkBaseUrl(undefined), BYTEPLUS_ARK_BASE_URL);
  assert.equal(
    resolveBytePlusArkBaseUrl(`${BYTEPLUS_ARK_BASE_URL}/`),
    BYTEPLUS_ARK_BASE_URL,
  );
});

test("BytePlus endpoint guard: 中国区与任意代理地址均 fail closed", () => {
  for (const value of [
    "https://ark.cn-beijing.volces.com/api/v3",
    "https://example.com/api/v3",
    "http://ark.ap-southeast.bytepluses.com/api/v3",
    "https://ark.ap-southeast.bytepluses.com/api/v3?proxy=1",
  ]) {
    assert.throws(
      () => resolveBytePlusArkBaseUrl(value),
      /拒绝不匹配 byteplus_international 的 Ark 端点/,
    );
  }
});

test("legacy CN endpoint guard: 只允许固定火山 Ark CN 地址", () => {
  assert.equal(
    resolveVolcengineLegacyArkBaseUrl(undefined),
    VOLCENGINE_CN_ARK_BASE_URL,
  );
  assert.equal(
    resolveVolcengineLegacyArkBaseUrl(`${VOLCENGINE_CN_ARK_BASE_URL}/`),
    VOLCENGINE_CN_ARK_BASE_URL,
  );
  for (const value of [
    BYTEPLUS_ARK_BASE_URL,
    "https://example.com/api/v3",
    "http://ark.cn-beijing.volces.com/api/v3",
    "https://ark.cn-beijing.volces.com/api/v3?proxy=1",
  ]) {
    assert.throws(
      () => resolveVolcengineLegacyArkBaseUrl(value),
      /拒绝不匹配 volcengine_cn_legacy 的 Ark 端点/,
    );
  }
});

test("BytePlus real mode: 无国际密钥时在网络调用前 fail closed", async () => {
  const previous = {
    mock: process.env.VIDEO_ENGINE_MOCK,
    key: process.env.BYTEPLUS_ARK_API_KEY,
    legacyKey: process.env.ARK_API_KEY,
    base: process.env.ARK_BASE_URL,
    profile: process.env.SEEDANCE_RUNTIME_PROFILE,
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected network call");
  };
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.SEEDANCE_RUNTIME_PROFILE = "byteplus_international";
  delete process.env.BYTEPLUS_ARK_API_KEY;
  process.env.ARK_API_KEY = "legacy-key-must-not-fallback";
  process.env.ARK_BASE_URL = BYTEPLUS_ARK_BASE_URL;
  try {
    await assert.rejects(
      submitSeedanceJob({ prompt: "guard test" }),
      /BYTEPLUS_ARK_API_KEY 未配置.*拒绝真实调用/,
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore("VIDEO_ENGINE_MOCK", previous.mock);
    restore("BYTEPLUS_ARK_API_KEY", previous.key);
    restore("ARK_API_KEY", previous.legacyKey);
    restore("ARK_BASE_URL", previous.base);
    restore("SEEDANCE_RUNTIME_PROFILE", previous.profile);
  }
});

test("BytePlus real mode: 错误 base URL 在网络调用前 fail closed", async () => {
  const previous = {
    mock: process.env.VIDEO_ENGINE_MOCK,
    key: process.env.BYTEPLUS_ARK_API_KEY,
    base: process.env.ARK_BASE_URL,
    profile: process.env.SEEDANCE_RUNTIME_PROFILE,
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected network call");
  };
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.SEEDANCE_RUNTIME_PROFILE = "byteplus_international";
  process.env.BYTEPLUS_ARK_API_KEY = "test-only-not-real";
  process.env.ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
  try {
    await assert.rejects(
      submitSeedanceJob({ prompt: "guard test" }),
      /拒绝不匹配 byteplus_international 的 Ark 端点/,
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore("VIDEO_ENGINE_MOCK", previous.mock);
    restore("BYTEPLUS_ARK_API_KEY", previous.key);
    restore("ARK_BASE_URL", previous.base);
    restore("SEEDANCE_RUNTIME_PROFILE", previous.profile);
  }
});

test("legacy CN real mode: canonical international key never falls back", async () => {
  const previous = snapshotSeedanceEnv();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected network call");
  };
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
  process.env.BYTEPLUS_ARK_API_KEY = "international-key-must-not-fallback";
  delete process.env.ARK_API_KEY;
  process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
  try {
    await assert.rejects(
      submitSeedanceJob({ prompt: "legacy credential isolation" }),
      /ARK_API_KEY 未配置.*volcengine_cn_legacy.*拒绝真实调用/,
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSeedanceEnv(previous);
  }
});

test("legacy CN real mode: explicit profile uses old key/model only on fixed CN URL", async () => {
  const previous = snapshotSeedanceEnv();
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let authorization = "";
  let requestedModel = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    const body = JSON.parse(String(init?.body)) as { model?: unknown };
    requestedModel = typeof body.model === "string" ? body.model : "";
    return new Response(
      JSON.stringify({ error: { code: "AuthenticationError" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  };
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
  process.env.ARK_API_KEY = "test-legacy-key-never-real";
  process.env.BYTEPLUS_ARK_API_KEY = "international-key-must-not-be-used";
  process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
  process.env.ARK_VIDEO_MODEL = "legacy-model-fixture";
  try {
    await assert.rejects(
      submitSeedanceJob({ prompt: "legacy routing fixture" }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderSubmissionError);
        assert.equal(error.providerId, "volcengine_cn_legacy");
        assert.equal(error.httpStatus, 401);
        return true;
      },
    );
    assert.equal(
      requestedUrl,
      `${VOLCENGINE_CN_ARK_BASE_URL}/contents/generations/tasks`,
    );
    assert.equal(authorization, "Bearer test-legacy-key-never-real");
    assert.equal(requestedModel, "legacy-model-fixture");
  } finally {
    globalThis.fetch = originalFetch;
    restoreSeedanceEnv(previous);
  }
});

test("legacy CN status polling stays on the same explicit credential realm", async () => {
  const previous = snapshotSeedanceEnv();
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        status: "succeeded",
        content: { video_url: "https://assets.example.test/result.mp4" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
  process.env.ARK_API_KEY = "test-legacy-key-never-real";
  process.env.BYTEPLUS_ARK_API_KEY = "international-key-must-not-be-used";
  process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
  try {
    const result = await getSeedanceStatus("legacy-task-fixture");
    assert.equal(
      requestedUrl,
      `${VOLCENGINE_CN_ARK_BASE_URL}/contents/generations/tasks/legacy-task-fixture`,
    );
    assert.equal(authorization, "Bearer test-legacy-key-never-real");
    assert.equal(result.status, "completed");
    assert.equal(result.videoUrl, "https://assets.example.test/result.mp4");
  } finally {
    globalThis.fetch = originalFetch;
    restoreSeedanceEnv(previous);
  }
});

function snapshotSeedanceEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    [
      "VIDEO_ENGINE_MOCK",
      "SEEDANCE_RUNTIME_PROFILE",
      "BYTEPLUS_ARK_API_KEY",
      "ARK_API_KEY",
      "ARK_BASE_URL",
      "ARK_VIDEO_MODEL",
    ].map((name) => [name, process.env[name]]),
  );
}

function restoreSeedanceEnv(snapshot: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(snapshot)) restore(name, value);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
