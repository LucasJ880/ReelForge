/**
 * Shuyu 当场拒单里明说「没建任务、没扣点、用同一个 Idempotency-Key 重试」的（10-29 真机）：
 *   HTTP 503 {"type":"reference_validation_unavailable",
 *             "message":"Reference-image validation is temporarily unavailable. Retry with the same
 *                        Idempotency-Key; no generation points were charged."}
 * 旧分类只认 4xx 与退款声明，把它当成「不知道建没建单」：视频直接失败，既不重试也不改交 Runway。
 *
 * 现在视频提交按错误类型判「确定未创建 + 可重试」，适配器用同一个键、同一份请求体退避重投，
 * 次数与时间窗封顶；用完原样抛出，单条视频由派发入口改交 Runway（全流程见 runway-fallback.test.ts）。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  __testVideoPlans__,
  createShuyuImageTask,
  createShuyuVideoTask,
  isShuyuSameKeyRetryable,
} from "../src/lib/providers/shuyu";
import {
  ShuyuVideoProvider,
  type ShuyuSubmitRetryClock,
} from "../src/lib/video-generation/providers/shuyu-video-provider";
import {
  isProviderSubmissionError,
  shouldAutomaticallyRetrySubmission,
} from "../src/lib/video-generation/providers/submission-error";

const REFERENCE_VALIDATION_UNAVAILABLE = {
  type: "reference_validation_unavailable",
  message:
    "Reference-image validation is temporarily unavailable. Retry with the same Idempotency-Key; no generation points were charged.",
};

/// 10-29 第 2 类：没有「没扣点」的声明，反而要求先核对退款状态——本轮不改
const GENERATION_COULD_NOT_START = {
  type: "generation_failed",
  message:
    "The generation service could not start this task. Confirm its refund status before submitting a new request or choosing another available plan.",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function rejectionFromVideoSubmit(status: number, body: unknown): Promise<unknown> {
  return createShuyuVideoTask({
    env: { SHUYU_API_KEY: "secret" },
    fetchImpl: async () => jsonResponse(status, body),
    providerRequestKey: "brief-job-1:attempt:1",
    prompt: "Show the product.",
    duration: 5,
    aspectRatio: "9:16",
    inputImages: ["https://example.com/product.jpg"],
  }).then(
    () => null,
    (reason: unknown) => reason,
  );
}

test("视频提交 503 reference_validation_unavailable：确定未创建、可重试、要求同键重投（嵌套与顶层两种错误体）", async () => {
  for (const body of [{ error: REFERENCE_VALIDATION_UNAVAILABLE }, REFERENCE_VALIDATION_UNAVAILABLE]) {
    const error = await rejectionFromVideoSubmit(503, body);
    assert.ok(isProviderSubmissionError(error), "应抛出 ProviderSubmissionError");
    assert.equal(error.disposition, "definitely_not_created");
    assert.equal(error.stage, "provider_response");
    assert.equal(error.httpStatus, 503);
    assert.equal(error.code, "reference_validation_unavailable");
    assert.equal(error.retryable, true);
    assert.equal(shouldAutomaticallyRetrySubmission(error), true, "批量队列据此退避重投");
    assert.equal(isShuyuSameKeyRetryable(error), true, "适配器据此同键重投");
  }
});

test("按错误类型认、不按文案认：同样的文案换个类型，仍按可能已计费处理", async () => {
  const error = await rejectionFromVideoSubmit(503, {
    error: { ...REFERENCE_VALIDATION_UNAVAILABLE, type: "temporarily_unavailable" },
  });
  assert.ok(isProviderSubmissionError(error));
  assert.equal(error.disposition, "acknowledgement_unknown");
  assert.equal(shouldAutomaticallyRetrySubmission(error), false);
  assert.equal(isShuyuSameKeyRetryable(error), false);
});

test("第 2 类不改：502 generation_failed「could not start…先核对退款状态」仍按可能已计费处理", async () => {
  const error = await rejectionFromVideoSubmit(502, { error: GENERATION_COULD_NOT_START });
  assert.ok(isProviderSubmissionError(error));
  assert.equal(error.disposition, "acknowledgement_unknown");
  assert.equal(error.retryable, false);
  assert.equal(isShuyuSameKeyRetryable(error), false);
});

test("图片提交暂不认这个类型：仍是确认未知（单条故事板只对这类帧自动重投一次）", async () => {
  const error = await createShuyuImageTask({
    env: { SHUYU_API_KEY: "secret" },
    fetchImpl: async () => jsonResponse(503, { error: REFERENCE_VALIDATION_UNAVAILABLE }),
    providerRequestKey: "frame-key-1234567890",
    prompt: "A faithful product demonstration in a bright room.",
    inputImages: ["https://example.com/a.jpg"],
    aspectRatio: "9:16",
    planId: "image-plan-08",
    resolution: "2K",
  }).then(
    () => null,
    (reason: unknown) => reason,
  );
  assert.ok(isProviderSubmissionError(error));
  assert.equal(error.disposition, "acknowledgement_unknown");
  assert.equal(isShuyuSameKeyRetryable(error), false);
});

// ---------------------------------------------------------------------------
// 适配器：同一个键、同一份请求体就地重投
// ---------------------------------------------------------------------------

const pricePayload = {
  object: "list",
  data: [
    {
      plan_id: "video-plan-02",
      kind: "video",
      model: "studio-video",
      unit: "generation",
      resolution: "720P",
      sale_points: 900,
      display_name: "Seedance 2.0 · 720P",
      capabilities: {
        aspect_ratios: ["9:16", "16:9", "1:1"],
        input_images_max: 9,
        modes: ["frames2video", "image2video", "text2video"],
        durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        quality: "720P",
      },
      status: "available",
    },
  ],
};

type Submission = { idempotencyKey: string | null; body: string };

/** 价目 / 余额 / 健康照常；视频提交按 answers 依次作答（答完就一直用最后一个） */
function shuyuFetch(
  answers: Array<() => Response>,
  submissions: Submission[],
  onSubmit: () => void = () => undefined,
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/prices")) return jsonResponse(200, pricePayload);
    if (url.endsWith("/account/balance")) {
      return jsonResponse(200, { object: "balance", available_points: 10_000, unit: "points" });
    }
    if (url.endsWith("/health")) {
      return jsonResponse(200, {
        object: "service_health",
        status: "operational",
        capabilities: { image: "available", video: "available" },
        checked_at: "2026-10-29T02:00:00.000Z",
      });
    }
    onSubmit();
    submissions.push({
      idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      body: String(init?.body),
    });
    return answers[Math.min(submissions.length, answers.length) - 1]();
  };
}

/** 假时钟：sleep 只推进时间并记账，不真等 */
function fakeClock(): ShuyuSubmitRetryClock & { at: number; sleeps: number[] } {
  const clock = {
    at: 0,
    sleeps: [] as number[],
    now: () => clock.at,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.at += ms;
    },
  };
  return clock;
}

const rejectedForValidation = () => jsonResponse(503, { error: REFERENCE_VALIDATION_UNAVAILABLE });
const accepted = () => jsonResponse(201, { task_id: "task_after_retry" });

const submitOptions = {
  providerRequestKey: "brief-job-1:attempt:1",
  prompt: "Show the product clearly",
  durationSec: 10,
  aspectRatio: "9:16",
  referenceImages: [{ url: "https://example.com/product.jpg", role: "content" as const }],
};

async function withQuietWarn<T>(run: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return await run();
  } finally {
    console.warn = warn;
  }
}

test("适配器：被拒一次后同键重投成功——两次提交的键与请求体逐字节相同，中间等 2s", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const submissions: Submission[] = [];
    const clock = fakeClock();
    const provider = new ShuyuVideoProvider(
      "studio-video",
      { env: { SHUYU_API_KEY: "configured" }, fetchImpl: shuyuFetch([rejectedForValidation, accepted], submissions) },
      clock,
    );

    const result = await withQuietWarn(() => provider.createVideoJob(submitOptions));

    assert.equal(result.providerJobId, "task_after_retry");
    assert.equal(result.providerPlanId, "video-plan-02");
    assert.equal(submissions.length, 2);
    assert.deepEqual(
      submissions.map((submission) => submission.idempotencyKey),
      ["brief-job-1:attempt:1", "brief-job-1:attempt:1"],
    );
    assert.equal(submissions[1].body, submissions[0].body, "同一个套餐、同一份请求体");
    assert.deepEqual(clock.sleeps, [2_000]);
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("适配器：一直被拒——同键重投两次（等 2s、5s）后原样抛出「确定未创建、可重试」，交给上层改交 Runway", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const submissions: Submission[] = [];
    const clock = fakeClock();
    const provider = new ShuyuVideoProvider(
      "studio-video",
      { env: { SHUYU_API_KEY: "configured" }, fetchImpl: shuyuFetch([rejectedForValidation], submissions) },
      clock,
    );

    const error = await withQuietWarn(() =>
      provider.createVideoJob(submitOptions).then(
        () => null,
        (reason: unknown) => reason,
      ),
    );

    assert.ok(isProviderSubmissionError(error));
    assert.equal(error.disposition, "definitely_not_created");
    assert.equal(error.code, "reference_validation_unavailable");
    assert.equal(shouldAutomaticallyRetrySubmission(error), true);
    assert.equal(submissions.length, 3, "首次提交 + 两次重投");
    assert.ok(submissions.every((submission) => submission.idempotencyKey === "brief-job-1:attempt:1"));
    assert.ok(submissions.every((submission) => submission.body === submissions[0].body));
    assert.deepEqual(clock.sleeps, [2_000, 5_000]);
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("适配器：时间窗封顶——拒单本身回得很慢时，15s 窗口外的重投不再发", async () => {
  __testVideoPlans__.resetVideoPlanCache();
  try {
    const submissions: Submission[] = [];
    const clock = fakeClock();
    /// 每次提交 9s 才回拒单：首次 0→9s，等 2s 后 11s 重投（窗口内）→ 20s；再等 5s 要到 25s，超出 15s 窗口
    const provider = new ShuyuVideoProvider(
      "studio-video",
      {
        env: { SHUYU_API_KEY: "configured" },
        fetchImpl: shuyuFetch([rejectedForValidation], submissions, () => {
          clock.at += 9_000;
        }),
      },
      clock,
    );

    const error = await withQuietWarn(() =>
      provider.createVideoJob(submitOptions).then(
        () => null,
        (reason: unknown) => reason,
      ),
    );

    assert.ok(isShuyuSameKeyRetryable(error));
    assert.equal(submissions.length, 2);
    assert.deepEqual(clock.sleeps, [2_000]);
  } finally {
    __testVideoPlans__.resetVideoPlanCache();
  }
});

test("适配器：Shuyu 没要求同键重试的拒单不就地重投——「积分已退回」与「先核对退款」都只提交一次", async () => {
  const cases = [
    {
      name: "busy-route refund",
      response: () =>
        jsonResponse(502, {
          error: { type: "generation_failed", message: "线路繁忙，请刷新或切换线路后重试。积分已退回。" },
        }),
      disposition: "definitely_not_created",
    },
    {
      name: "could not start",
      response: () => jsonResponse(502, { error: GENERATION_COULD_NOT_START }),
      disposition: "acknowledgement_unknown",
    },
  ] as const;

  for (const item of cases) {
    __testVideoPlans__.resetVideoPlanCache();
    try {
      const submissions: Submission[] = [];
      const clock = fakeClock();
      const provider = new ShuyuVideoProvider(
        "studio-video",
        { env: { SHUYU_API_KEY: "configured" }, fetchImpl: shuyuFetch([item.response], submissions) },
        clock,
      );

      const error = await withQuietWarn(() =>
        provider.createVideoJob(submitOptions).then(
          () => null,
          (reason: unknown) => reason,
        ),
      );

      assert.ok(isProviderSubmissionError(error), item.name);
      assert.equal(error.disposition, item.disposition, item.name);
      assert.equal(submissions.length, 1, item.name);
      assert.deepEqual(clock.sleeps, [], item.name);
    } finally {
      __testVideoPlans__.resetVideoPlanCache();
    }
  }
});
