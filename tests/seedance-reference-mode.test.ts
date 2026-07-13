import assert from "node:assert/strict";
import test from "node:test";

/// 数字人管线 enabler —— 确认 Seedance wrapper 的 reference-to-video（多图 Omni-Reference）
/// 模式按官方原生格式组装：每张参考图作为 content item 的 `role: reference_image`
/// 同级字段，且不破坏既有 first_frame/last_frame 路径。

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

function stubFetch(): { captured: CapturedRequest[]; restore: () => void } {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = typeof input === "string" ? input : String(input);
    captured.push({ url, body: JSON.parse(init?.body ?? "{}") });
    return new Response(JSON.stringify({ id: `fake-task-${captured.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { captured, restore: () => { globalThis.fetch = original; } };
}

type ContentItem = {
  type: string;
  image_url?: { url: string; role?: string };
  role?: string;
  text?: string;
};

test("seedance reference 模式：每张图作 role:reference_image（content item 同级字段）", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "图片1 是模特，图片2 是门店场景，让她在店里自然讲解",
      mode: "reference",
      referenceImageUrls: [
        "https://example.com/model.png",
        "https://example.com/store.png",
      ],
      duration: 5,
      ratio: "9:16",
      generateAudio: false,
    });
  } finally {
    restore();
  }

  const content = captured[0].body.content as ContentItem[];
  const images = content.filter((c) => c.type === "image_url");
  assert.equal(images.length, 2, "应有 2 个 image_url");
  for (const img of images) {
    assert.equal(img.role, "reference_image", "role 必须是 content item 同级字段");
    assert.equal(
      (img.image_url as { role?: string }).role,
      undefined,
      "reference 模式不应把 role 塞进 image_url 里",
    );
  }
  assert.equal(captured[0].body.generate_audio, false);
});

test("seedance reference 模式：最多 9 张参考图", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/${i}.png`);
  try {
    await submitSeedanceJob({
      prompt: "many refs",
      mode: "reference",
      referenceImageUrls: urls,
      duration: 5,
      ratio: "9:16",
    });
  } finally {
    restore();
  }
  const content = captured[0].body.content as ContentItem[];
  const images = content.filter((c) => c.type === "image_url");
  assert.equal(images.length, 9, "reference_image 最多裁到 9 张");
});

test("seedance i2v（默认/无 mode）路径不受影响：仍是 first_frame role 在 image_url 内", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "i2v",
      referenceImageUrls: ["https://example.com/first.png"],
      duration: 5,
      ratio: "9:16",
    });
  } finally {
    restore();
  }
  const content = captured[0].body.content as ContentItem[];
  const img = content.find((c) => c.type === "image_url");
  assert.equal(img?.image_url?.role, "first_frame");
  assert.equal(img?.role, undefined, "i2v 模式不应在 item 同级放 role");
});

test("seedance reference 模式下显式 resolution 会下发到 body", async () => {
  const { submitSeedanceJob } = await import("../src/lib/providers/seedance");
  const { captured, restore } = stubFetch();
  try {
    await submitSeedanceJob({
      prompt: "res test",
      mode: "reference",
      referenceImageUrls: ["https://example.com/a.png"],
      duration: 5,
      ratio: "9:16",
      resolution: "1080p",
    });
  } finally {
    restore();
  }
  assert.equal(captured[0].body.resolution, "1080p");
});
