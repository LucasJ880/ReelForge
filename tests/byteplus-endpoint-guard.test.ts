import assert from "node:assert/strict";
import test from "node:test";

import {
  BYTEPLUS_ARK_BASE_URL,
  resolveBytePlusArkBaseUrl,
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
    assert.throws(() => resolveBytePlusArkBaseUrl(value), /拒绝非 BytePlus 国际端点/);
  }
});

test("BytePlus real mode: 无国际密钥时在网络调用前 fail closed", async () => {
  const previous = {
    mock: process.env.VIDEO_ENGINE_MOCK,
    key: process.env.BYTEPLUS_ARK_API_KEY,
    base: process.env.ARK_BASE_URL,
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected network call");
  };
  process.env.VIDEO_ENGINE_MOCK = "false";
  delete process.env.BYTEPLUS_ARK_API_KEY;
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
    restore("ARK_BASE_URL", previous.base);
  }
});

test("BytePlus real mode: 错误 base URL 在网络调用前 fail closed", async () => {
  const previous = {
    mock: process.env.VIDEO_ENGINE_MOCK,
    key: process.env.BYTEPLUS_ARK_API_KEY,
    base: process.env.ARK_BASE_URL,
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected network call");
  };
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.BYTEPLUS_ARK_API_KEY = "test-only-not-real";
  process.env.ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
  try {
    await assert.rejects(
      submitSeedanceJob({ prompt: "guard test" }),
      /拒绝非 BytePlus 国际端点/,
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore("VIDEO_ENGINE_MOCK", previous.mock);
    restore("BYTEPLUS_ARK_API_KEY", previous.key);
    restore("ARK_BASE_URL", previous.base);
  }
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
