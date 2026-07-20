import assert from "node:assert/strict";
import test from "node:test";
import {
  createShuyuVideoTask,
  getShuyuBalance,
  SHUYU_API_BASE_URL,
  ShuyuApiError,
} from "../src/lib/providers/shuyu";
import { ShuyuVideoProvider } from "../src/lib/video-generation/providers/shuyu-video-provider";
import {
  ProviderSubmissionError,
  shouldAutomaticallyRetrySubmission,
} from "../src/lib/video-generation/providers/submission-error";

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

const fundedPayload = {
  object: "balance",
  available_points: 10_000,
  unit: "points",
};

const healthPayload = {
  object: "service_health",
  status: "operational",
  capabilities: { image: "available", video: "available" },
  checked_at: "2026-07-19T02:00:00.000Z",
};

test("Shuyu provider sends the exact documented body and persisted Idempotency-Key", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify(healthPayload), { status: 200 });
    }
    if (url.endsWith("/prices")) {
      return new Response(JSON.stringify(pricePayload), { status: 200 });
    }
    if (url.endsWith("/account/balance")) {
      return new Response(JSON.stringify(fundedPayload), { status: 200 });
    }
    return new Response(JSON.stringify({ task_id: "task_opaque-123" }), {
      status: 201,
    });
  };
  const provider = new ShuyuVideoProvider("studio-video", {
    fetchImpl: fetchStub,
    env: { shuyu_api_key: "secret-lowercase-alias" },
  });

  const result = await provider.createVideoJob({
    providerRequestKey: "job-12345678-attempt-1",
    prompt: "Show the product clearly",
    negativePrompt: "watermark, morphing",
    durationSec: 10,
    aspectRatio: "9:16",
    resolution: "1080p",
    model: "studio-video",
    referenceImages: [
      { url: "https://example.com/product.jpg", role: "content" },
    ],
  });

  assert.deepEqual(result, {
    providerJobId: "task_opaque-123",
    providerId: "shuyu",
  });
  const submission = calls.find((call) =>
    call.url.endsWith("/videos/generations"),
  );
  assert.ok(submission);
  assert.equal(submission.init?.method, "POST");
  const headers = new Headers(submission.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer secret-lowercase-alias");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("idempotency-key"), "job-12345678-attempt-1");
  assert.deepEqual(JSON.parse(String(submission.init?.body)), {
    plan_id: "video-plan-02",
    model: "studio-video",
    mode: "image2video",
    prompt:
      "Show the product clearly\nNegative constraints: watermark, morphing",
    duration: 10,
    aspect_ratio: "9:16",
    input_images: ["https://example.com/product.jpg"],
  });
  assert.doesNotMatch(String(submission.init?.body), /resolution/);
});

test("Shuyu status mapping waits through refund states and only fails after refunded", async () => {
  const statuses = [
    ["queued", "queued"],
    ["processing", "processing"],
    ["refund_pending", "processing"],
    ["refund_error", "processing"],
    ["refunded", "failed"],
  ] as const;
  for (const [raw, normalized] of statuses) {
    const provider = new ShuyuVideoProvider("studio-video", {
      env: { SHUYU_API_KEY: "canonical-key" },
      fetchImpl: async (input) => {
        assert.equal(
          String(input),
          `${SHUYU_API_BASE_URL}/tasks/task_opaque-123`,
        );
        return new Response(
          JSON.stringify({ task_id: "task_opaque-123", status: raw }),
          { status: 200 },
        );
      },
    });
    const result = await provider.getVideoJobStatus("task_opaque-123");
    assert.equal(result.rawProviderStatus, raw);
    assert.equal(result.normalizedStatus, normalized);
  }

  const completed = new ShuyuVideoProvider("studio-video", {
    env: { SHUYU_API_KEY: "canonical-key" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          outputs: [{ url: "https://cdn.example.com/video.mp4" }],
          secret: "discarded",
        }),
        { status: 200 },
      ),
  });
  const completeResult = await completed.getVideoJobStatus("compat-id-456");
  assert.equal(completeResult.normalizedStatus, "succeeded");
  assert.equal(completeResult.providerJobId, "compat-id-456");
  assert.equal(completeResult.videoUrl, "https://cdn.example.com/video.mp4");
  assert.doesNotMatch(JSON.stringify(completeResult.rawProviderResponse), /secret/);

  const mismatched = new ShuyuVideoProvider("studio-video", {
    env: { SHUYU_API_KEY: "canonical-key" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ task_id: "another-task", status: "processing" }),
        { status: 200 },
      ),
  });
  await assert.rejects(
    () => mismatched.getVideoJobStatus("expected-task"),
    /different identifier/,
  );

  const conflictingCompatibilityId = new ShuyuVideoProvider("studio-video", {
    env: { SHUYU_API_KEY: "canonical-key" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          task_id: "expected-task",
          id: "another-task",
          status: "processing",
        }),
        { status: 200 },
      ),
  });
  await assert.rejects(
    () => conflictingCompatibilityId.getVideoJobStatus("expected-task"),
    /different identifier/,
  );
});

test("Shuyu submit timeout, 5xx, 409, and malformed success fail closed", async () => {
  const cases: Array<{
    name: string;
    response?: Response;
    reject?: Error;
    disposition: "definitely_not_created" | "acknowledgement_unknown";
  }> = [
    {
      name: "transport failure",
      reject: new Error("socket closed"),
      disposition: "acknowledgement_unknown",
    },
    {
      name: "upstream 503",
      response: new Response(
        JSON.stringify({
          error: { type: "temporarily_unavailable", message: "Try later" },
        }),
        { status: 503 },
      ),
      disposition: "acknowledgement_unknown",
    },
    {
      name: "idempotency conflict",
      response: new Response(
        JSON.stringify({
          error: { type: "idempotency_conflict", message: "Conflict" },
        }),
        { status: 409 },
      ),
      disposition: "acknowledgement_unknown",
    },
    {
      name: "malformed accepted response",
      response: new Response(JSON.stringify({ status: "queued" }), {
        status: 201,
      }),
      disposition: "acknowledgement_unknown",
    },
    {
      name: "conflicting accepted identifiers",
      response: new Response(
        JSON.stringify({ task_id: "task-one", id: "task-two" }),
        { status: 201 },
      ),
      disposition: "acknowledgement_unknown",
    },
    {
      name: "documented insufficient balance rejection",
      response: new Response(
        JSON.stringify({
          error: {
            type: "insufficient_balance",
            message: "Not enough points.",
            available_points: 0,
            required_points: 900,
          },
        }),
        { status: 402 },
      ),
      disposition: "definitely_not_created",
    },
  ];

  for (const item of cases) {
    let thrown: unknown;
    try {
      await createShuyuVideoTask({
        env: { SHUYU_API_KEY: "secret" },
        fetchImpl: async () => {
          if (item.reject) throw item.reject;
          return item.response as Response;
        },
        providerRequestKey: "request-key-123",
        prompt: "Test",
        duration: 5,
        aspectRatio: "9:16",
        inputImages: [],
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof ProviderSubmissionError, item.name);
    assert.equal(thrown.disposition, item.disposition, item.name);
    assert.equal(shouldAutomaticallyRetrySubmission(thrown), false, item.name);
  }
});

test("Shuyu preflight rejects bad request keys and overlong merged prompts before fetch", async () => {
  let calls = 0;
  const provider = new ShuyuVideoProvider("studio-video", {
    env: { SHUYU_API_KEY: "configured" },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(
    () =>
      provider.createVideoJob({
        providerRequestKey: "short",
        prompt: "valid",
        durationSec: 5,
      }),
    (error) =>
      error instanceof ProviderSubmissionError &&
      error.disposition === "definitely_not_created",
  );
  await assert.rejects(
    () =>
      provider.createVideoJob({
        providerRequestKey: "request-key-123",
        prompt: "x".repeat(4_990),
        negativePrompt: "y".repeat(50),
        durationSec: 5,
      }),
    /5000 characters/,
  );
  assert.equal(calls, 0);
});

test("Shuyu response bodies remain inside the timeout and 512KB stream cap", async () => {
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let slowBodyCancelled = false;
  const slowBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"object":"balance",'));
      slowTimer = setTimeout(() => {
        controller.enqueue(
          new TextEncoder().encode('"available_points":1,"unit":"points"}'),
        );
        controller.close();
      }, 1_000);
    },
    cancel() {
      slowBodyCancelled = true;
      if (slowTimer) clearTimeout(slowTimer);
    },
  });
  await assert.rejects(
    () =>
      getShuyuBalance({
        env: { SHUYU_API_KEY: "configured" },
        timeoutMs: 250,
        fetchImpl: async () => new Response(slowBody, { status: 200 }),
      }),
    (error) => error instanceof ShuyuApiError && error.code === "timeout",
  );
  assert.equal(slowBodyCancelled, true);

  await assert.rejects(
    () =>
      getShuyuBalance({
        env: { SHUYU_API_KEY: "configured" },
        fetchImpl: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(512_001));
                controller.close();
              },
            }),
            { status: 200 },
          ),
      }),
    (error) =>
      error instanceof ShuyuApiError && error.code === "invalid_response",
  );
});
