import assert from "node:assert/strict";
import test from "node:test";

import {
  STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX,
  composeStoryboardFrameInputImages,
} from "../src/lib/video-generation/storyboard-frame-inputs";
import {
  SHUYU_IMAGE_MAX_REFERENCE_IMAGES,
  createShuyuImageTask,
} from "../src/lib/providers/shuyu";
import { submitShuyuImageTask } from "../src/lib/providers/shuyu-image-provider";

/**
 * P02-B2 · E1 实测 Shuyu 图像档 input_images_max 全部 = 6：
 * 故事板入参上限 5 → 6；超出上限由硬拒改为按优先级从队尾截断（套餐级先截，硬顶兜底）。
 * 全部走注入的 fetch，不出网。
 */

const ENV = { SHUYU_API_KEY: "configured" };
const IMAGES = Array.from({ length: 8 }, (_, i) => `https://cdn.example.test/ref-${i}.jpg`);

function recordingFetch(bodies: Array<Record<string, unknown>>): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ task_id: "task_p02b2" }), { status: 201 });
  }) as unknown as typeof fetch;
}

function withRealRuntime(t: test.TestContext) {
  const saved = { dry: process.env.AIVORA_DRY_RUN, mock: process.env.IMAGE_ENGINE_MOCK };
  process.env.AIVORA_DRY_RUN = "false";
  process.env.IMAGE_ENGINE_MOCK = "false";
  t.after(() => {
    process.env.AIVORA_DRY_RUN = saved.dry;
    process.env.IMAGE_ENGINE_MOCK = saved.mock;
  });
}

test("故事板入参缺省上限 = 6 = 图像档硬顶：4 张实拍 + 1 前帧 + 主播都放得下", () => {
  assert.equal(STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX, 6);
  assert.equal(SHUYU_IMAGE_MAX_REFERENCE_IMAGES, 6);
  const composed = composeStoryboardFrameInputImages({
    productImages: IMAGES.slice(0, 4),
    personImages: ["https://cdn.example.test/person.jpg"],
    priorFrames: ["https://cdn.example.test/frame-0.jpg"],
    isFirstFrame: false,
  });
  assert.equal(composed.length, 5);
  assert.deepEqual(
    composed.map((image) => image.role),
    ["product", "product", "product", "product", "prior_frame"],
  );
});

test("createShuyuImageTask：超出硬顶 6 张不再硬拒，按队尾截断并只警告一次", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const bodies: Array<Record<string, unknown>> = [];
  const created = await createShuyuImageTask({
    providerRequestKey: "p02b2-hard-cap-key",
    prompt: "frame",
    planId: "image-plan-02",
    resolution: "2K",
    aspectRatio: "9:16",
    inputImages: IMAGES,
    env: ENV,
    fetchImpl: recordingFetch(bodies),
  });
  assert.equal(created.taskId, "task_p02b2");
  assert.deepEqual(bodies[0]?.input_images, IMAGES.slice(0, 6));
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /truncated to provider hard cap/);
});

test("submitShuyuImageTask：选定套餐后按它的 input_images_max 截断（4 张），硬顶只是兜底", async (t) => {
  withRealRuntime(t);
  t.mock.method(console, "warn", () => {});
  const bodies: Array<Record<string, unknown>> = [];
  const result = await submitShuyuImageTask({
    requestKey: "p02b2-plan-cap-key",
    prompt: "frame",
    aspectRatio: "9:16",
    resolution: "2K",
    inputImages: IMAGES.slice(0, 6),
    planSnapshot: {
      planId: "image-plan-02",
      model: "gpt-image-2",
      resolution: "2K",
      points: 48,
      family: "gpt-image-2",
      inputImagesMax: 4,
    },
    env: ENV,
    fetchImpl: recordingFetch(bodies),
  });
  assert.equal(result.externalTaskId, "task_p02b2");
  assert.deepEqual(bodies[0]?.input_images, IMAGES.slice(0, 4));
});

test("submitShuyuImageTask：套餐没解析到 inputImagesMax 时按硬顶 6 截断", async (t) => {
  withRealRuntime(t);
  t.mock.method(console, "warn", () => {});
  const bodies: Array<Record<string, unknown>> = [];
  await submitShuyuImageTask({
    requestKey: "p02b2-fallback-cap-key",
    prompt: "frame",
    aspectRatio: "9:16",
    resolution: "2K",
    inputImages: IMAGES,
    planSnapshot: { planId: "image-plan-02", model: "gpt-image-2", resolution: "2K", points: 48, family: "gpt-image-2" },
    env: ENV,
    fetchImpl: recordingFetch(bodies),
  });
  assert.deepEqual(bodies[0]?.input_images, IMAGES.slice(0, 6));
});
