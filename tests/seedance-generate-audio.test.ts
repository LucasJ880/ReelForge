import assert from "node:assert/strict";
import test from "node:test";

/// V2.1 Investor demo enabler — confirm Seedance wrapper's new
/// generateAudio opt-in produces the right `generate_audio` field on the
/// request body without breaking the existing default-true behavior.

/// Real-mode env (must be set BEFORE importing the module, since module
/// top-level reads env at import time via isMockMode()):
process.env.VIDEO_ENGINE_MOCK = "false";
/// 本文件 stub 了 globalThis.fetch（零计费），需要真实请求组装路径 →
/// 显式退出 AIVORA_DRY_RUN 的强制 mock。假 key + 假 base URL 双保险。
process.env.AIVORA_DRY_RUN = "0";
process.env.BYTEPLUS_ARK_API_KEY = "test-key-not-real";
process.env.ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
process.env.ARK_VIDEO_MODEL = "dreamina-seedance-2-0-260128";
delete process.env.SEEDANCE_CALLBACK_URL;

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function stubFetch(): {
  captured: CapturedRequest[];
  restore: () => void;
} {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = typeof input === "string" ? input : String(input);
    const bodyStr = init?.body ?? "{}";
    captured.push({
      url,
      body: JSON.parse(bodyStr),
    });
    return new Response(
      JSON.stringify({ id: `fake-task-${captured.length}` }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return {
    captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("seedance: generateAudio undefined 时默认携带 generate_audio:true（向后兼容）", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "test prompt",
      duration: 5,
      ratio: "9:16",
    });
  } finally {
    restore();
  }
  assert.equal(captured.length, 1, "应只发出一次提交请求");
  const req = captured[0];
  assert.match(req.url, /\/contents\/generations\/tasks$/);
  assert.equal(
    req.body.generate_audio,
    true,
    "未传 generateAudio 时（向后兼容）应仍为 true",
  );
});

test("seedance: generateAudio:true 显式传入也是 true", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "test prompt",
      duration: 5,
      ratio: "9:16",
      generateAudio: true,
    });
  } finally {
    restore();
  }
  assert.equal(captured[0].body.generate_audio, true);
});

test("seedance: generateAudio:false → body.generate_audio:false（投资人 demo 静音路径）", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "test prompt",
      duration: 5,
      ratio: "9:16",
      generateAudio: false,
    });
  } finally {
    restore();
  }
  assert.equal(
    captured[0].body.generate_audio,
    false,
    "显式 false 必须把 generate_audio:false 真实带到请求体上",
  );
});

test("seedance: I2V referenceImageUrls[0] 注入为 first_frame role（确认 I2V 路径未被改坏）", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "test image-to-video prompt",
      duration: 5,
      ratio: "9:16",
      referenceImageUrls: ["https://example.com/storyboard-1.png"],
      generateAudio: false,
    });
  } finally {
    restore();
  }
  const content = captured[0].body.content as Array<{
    type: string;
    image_url?: { url: string; role?: string };
    text?: string;
  }>;
  assert.ok(Array.isArray(content), "请求 content 必须是数组");
  const firstImage = content.find((c) => c.type === "image_url");
  assert.ok(firstImage, "应包含 image_url 部分");
  assert.equal(firstImage!.image_url?.role, "first_frame");
  assert.equal(
    firstImage!.image_url?.url,
    "https://example.com/storyboard-1.png",
  );
  assert.equal(captured[0].body.generate_audio, false);
});

test("seedance: I2V 同时给两张图 → 第二张作为 last_frame role", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "test prompt",
      duration: 5,
      ratio: "9:16",
      referenceImageUrls: [
        "https://example.com/first.png",
        "https://example.com/last.png",
      ],
    });
  } finally {
    restore();
  }
  const content = captured[0].body.content as Array<{
    type: string;
    image_url?: { url: string; role?: string };
  }>;
  const images = content.filter((c) => c.type === "image_url");
  assert.equal(images.length, 2, "应有 2 个 image_url 部分");
  assert.equal(images[0].image_url?.role, "first_frame");
  assert.equal(images[1].image_url?.role, "last_frame");
});
