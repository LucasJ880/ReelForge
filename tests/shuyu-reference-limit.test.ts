import assert from "node:assert/strict";
import test from "node:test";
import {
  auditShuyuVideoPlan,
  SHUYU_MAX_REFERENCE_IMAGES,
  SHUYU_MIN_REFERENCE_IMAGES,
  shuyuReferenceImageLimit,
  __testVideoPlans__,
} from "../src/lib/providers/shuyu";
import { diagnoseDrift } from "../src/lib/services/capability-probe-service";
import { ShuyuVideoProvider } from "../src/lib/video-generation/providers/shuyu-video-provider";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "../src/lib/video-generation/batch-style-templates";

/**
 * round 1025 · A1b 2.3：参考图上限三处统一 + 按套餐截断。
 *
 * 此前审计放行 input_images_max ≥4（注释「我方最多送 4 张」）、适配器硬顶 9、
 * 能力探测却要求 ≥9；批量实际最多送 8 张（4 故事板帧 + 4 实拍）且故事板帧在前。
 * 遇到只收 4 张的套餐：实拍图被挤掉，或提交被拒。
 * 现在：审计与探测共用 SHUYU_MIN_REFERENCE_IMAGES；适配器按选中套餐的上限截断
 * （硬顶 SHUYU_MAX_REFERENCE_IMAGES）；调用方实拍在前，所以截掉的只会是故事板帧。
 */

function plan(overrides: Record<string, unknown> = {}, capabilities: Record<string, unknown> = {}) {
  return {
    plan_id: "video-plan-04",
    kind: "video" as const,
    status: "available" as const,
    model: "studio-video",
    unit: "generation" as const,
    resolution: "720P",
    sale_points: 700,
    display_name: "Seedance 2.0 · 720P",
    capabilities: {
      aspect_ratios: ["9:16", "16:9", "1:1"],
      input_images_max: SHUYU_MIN_REFERENCE_IMAGES,
      modes: ["image2video", "text2video"],
      durations: [5, 10, 15],
      quality: "720P",
      ...capabilities,
    },
    ...overrides,
  } as never;
}

test("2.3 审计与能力探测共用同一个参考图下限", () => {
  assert.equal(SHUYU_MIN_REFERENCE_IMAGES, 4);
  assert.ok(auditShuyuVideoPlan(plan()), "收得下全部实拍图的 4 图套餐是健康套餐");
  assert.equal(
    auditShuyuVideoPlan(plan({}, { input_images_max: SHUYU_MIN_REFERENCE_IMAGES - 1 })),
    null,
  );

  /// 4 图套餐因别的原因审计不过时，探测只能报真正漂了的字段，
  /// 不能再把 input_images_max 报成假漂移（旧探测要求 ≥9）。
  const drift = diagnoseDrift([plan({}, { durations: [5, 10] })]);
  assert.deepEqual(drift.drifts.map((d) => d.field), ["durations"]);

  const tooFew = diagnoseDrift([plan({}, { input_images_max: 3 })]);
  const field = tooFew.drifts.find((d) => d.field === "input_images_max");
  assert.ok(field, "低于下限必须报出");
  assert.equal(field.expected, `>= ${SHUYU_MIN_REFERENCE_IMAGES}`);
});

test("2.3 模板每条实拍图上限不超过审计下限：任何审计通过的套餐都收得下全部实拍图", () => {
  assert.ok(BATCH_STYLE_TEMPLATE_SEEDS.length > 0);
  for (const seed of BATCH_STYLE_TEMPLATE_SEEDS) {
    assert.ok(
      seed.imagesPerVideo.max <= SHUYU_MIN_REFERENCE_IMAGES,
      `${seed.slug} 每条最多 ${seed.imagesPerVideo.max} 张实拍图，超过套餐下限 ${SHUYU_MIN_REFERENCE_IMAGES}`,
    );
  }
});

test("2.3 套餐截断上限：取套餐上限与合作方硬顶的较小值", () => {
  assert.equal(shuyuReferenceImageLimit({ inputImagesMax: 4 }), 4);
  assert.equal(shuyuReferenceImageLimit({ inputImagesMax: 6 }), 6);
  assert.equal(shuyuReferenceImageLimit({ inputImagesMax: 12 }), SHUYU_MAX_REFERENCE_IMAGES);
});

function stubFetch(inputImagesMax: number, submissions: Array<Record<string, unknown>>): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(
        JSON.stringify({
          object: "service_health",
          status: "operational",
          capabilities: { image: "available", video: "available" },
          checked_at: "2026-10-25T00:00:00.000Z",
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/prices")) {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              plan_id: "video-plan-04",
              kind: "video",
              model: "studio-video",
              unit: "generation",
              resolution: "720P",
              sale_points: 700,
              display_name: "Seedance 2.0 · 720P",
              capabilities: {
                aspect_ratios: ["9:16", "16:9", "1:1"],
                input_images_max: inputImagesMax,
                modes: ["image2video", "text2video"],
                durations: [5, 10, 15],
                quality: "720P",
              },
              status: "available",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/account/balance")) {
      return new Response(
        JSON.stringify({ object: "balance", available_points: 10_000, unit: "points" }),
        { status: 200 },
      );
    }
    submissions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ task_id: "task_ref_limit" }), { status: 201 });
  };
}

const PRODUCTS = ["https://cdn.example.test/photo-a.jpg", "https://cdn.example.test/photo-b.jpg"];
const FRAMES = [0, 1, 2, 3].map((i) => `https://cdn.example.test/frame-${i}.jpg`);

test("2.3 适配器：4 图套餐收到 2 实拍 + 4 故事板帧 → 截成 2 实拍 + 前 2 帧，不再被拒", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  const submissions: Array<Record<string, unknown>> = [];
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const provider = new ShuyuVideoProvider("studio-video", {
      fetchImpl: stubFetch(4, submissions),
      env: { SHUYU_API_KEY: "configured" },
    });
    await provider.createVideoJob({
      providerRequestKey: "job-ref-limit:attempt:1",
      prompt: "Use input_images[1], input_images[2] as the product truth.",
      durationSec: 15,
      aspectRatio: "9:16",
      referenceImages: [...PRODUCTS, ...FRAMES].map((url) => ({ url, role: "content" as const })),
    });
  } finally {
    console.warn = warn;
    __testVideoPlans__.resetVideoPlanCache();
  }

  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].input_images, [...PRODUCTS, FRAMES[0], FRAMES[1]]);
});

test("2.3 适配器：套餐收得下就原样全送（9 图套餐不截断）", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  const submissions: Array<Record<string, unknown>> = [];
  try {
    const provider = new ShuyuVideoProvider("studio-video", {
      fetchImpl: stubFetch(9, submissions),
      env: { SHUYU_API_KEY: "configured" },
    });
    await provider.createVideoJob({
      providerRequestKey: "job-ref-full:attempt:1",
      prompt: "Use input_images[1], input_images[2] as the product truth.",
      durationSec: 15,
      aspectRatio: "9:16",
      referenceImages: [...PRODUCTS, ...FRAMES].map((url) => ({ url, role: "content" as const })),
    });
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }

  assert.deepEqual(submissions[0].input_images, [...PRODUCTS, ...FRAMES]);
});

test("2.3 适配器：超过合作方硬顶的请求仍在预检拒绝（不静默吞掉调用方的错误）", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  const submissions: Array<Record<string, unknown>> = [];
  const provider = new ShuyuVideoProvider("studio-video", {
    fetchImpl: stubFetch(9, submissions),
    env: { SHUYU_API_KEY: "configured" },
  });
  const tooMany = Array.from(
    { length: SHUYU_MAX_REFERENCE_IMAGES + 1 },
    (_, i) => ({ url: `https://cdn.example.test/img-${i}.jpg`, role: "content" as const }),
  );
  await assert.rejects(
    () =>
      provider.createVideoJob({
        providerRequestKey: "job-ref-over:attempt:1",
        prompt: "Show the product.",
        durationSec: 15,
        referenceImages: tooMany,
      }),
    /at most 9 HTTPS reference images/,
  );
  assert.equal(submissions.length, 0);
});
