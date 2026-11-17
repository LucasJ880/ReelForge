import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchShuyuOutputImage,
  pollShuyuImageTask,
  submitShuyuImageTask,
} from "../src/lib/providers/shuyu-image-provider";

const imagePlan = {
  plan_id: "image-plan-01",
  kind: "image",
  model: "gpt-image-2",
  unit: "generation",
  resolution: "1K",
  sale_points: 24,
  display_name: "GPT Image 2 · 1K",
  capabilities: {
    aspect_ratios: ["1:1", "4:5", "9:16", "16:9"],
    input_images_max: 5,
    quality: "1K",
  },
  status: "available",
};

test("submits only the audited Shuyu Image 2 plan and returns its durable snapshots", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let persistedBeforeSubmit = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/prices")) {
      return Response.json({ object: "list", data: [imagePlan] });
    }
    assert.equal(persistedBeforeSubmit, true);
    return Response.json({ task_id: "task-image-1" }, { status: 201 });
  };

  const submitted = await submitShuyuImageTask({
    requestKey: "product-image-job-1-attempt-1",
    prompt: "Photograph the real product on a warm studio background",
    aspectRatio: "4:5",
    resolution: "1K",
    inputImages: ["https://assets.example.test/source.png"],
    env: { SHUYU_API_KEY: "test-secret" },
    fetchImpl,
    onPlanSelected: async (plan) => {
      assert.equal(plan.planId, "image-plan-01");
      assert.equal(plan.model, "gpt-image-2");
      assert.equal(plan.points, 24);
      persistedBeforeSubmit = true;
    },
  });

  assert.equal(submitted.requestKey, "product-image-job-1-attempt-1");
  assert.equal(submitted.externalTaskId, "task-image-1");
  assert.deepEqual(submitted.planSnapshot, {
    planId: "image-plan-01",
    model: "gpt-image-2",
    resolution: "1K",
    points: 24,
    family: "gpt-image-2",
    /// C2：价目表声明的画幅一并保留（图文帖按画幅筛套餐）。
    aspectRatios: ["1:1", "4:5", "9:16", "16:9"],
    /// P02-B：价目表声明的参考图上限一并保留。
    inputImagesMax: 5,
  });
  const post = calls.find((call) => call.url.endsWith("/images/generations"));
  assert.ok(post);
  assert.equal(new Headers(post.init?.headers).get("idempotency-key"), submitted.requestKey);
  assert.deepEqual(JSON.parse(String(post.init?.body)), {
    plan_id: "image-plan-01",
    model: "gpt-image-2",
    prompt: "Photograph the real product on a warm studio background",
    resolution: "1K",
    aspect_ratio: "4:5",
    input_images: ["https://assets.example.test/source.png"],
  });
});

test("confirmed retry reuses the persisted audited plan without changing provider payload", async () => {
  const calls: string[] = [];
  const submitted = await submitShuyuImageTask({
    requestKey: "product-image-stable-result-2",
    prompt: "Photograph one faithful product variation",
    aspectRatio: "1:1",
    resolution: "1K",
    planSnapshot: {
      planId: "image-plan-01",
      model: "gpt-image-2",
      resolution: "1K",
      points: 24,
      family: "gpt-image-2",
    },
    env: { SHUYU_API_KEY: "test-secret" },
    fetchImpl: async (input, init) => {
      calls.push(String(input));
      assert.deepEqual(JSON.parse(String(init?.body)), {
        plan_id: "image-plan-01",
        model: "gpt-image-2",
        prompt: "Photograph one faithful product variation",
        resolution: "1K",
        aspect_ratio: "1:1",
      });
      return Response.json({ task_id: "external-retry" }, { status: 201 });
    },
  });
  assert.equal(submitted.externalTaskId, "external-retry");
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? "", /\/images\/generations$/);
});

test("poll maps Shuyu task states without starting another provider task", async () => {
  let calls = 0;
  const result = await pollShuyuImageTask("task-image-1", {
    env: { SHUYU_API_KEY: "test-secret" },
    fetchImpl: async (input) => {
      calls += 1;
      assert.match(String(input), /\/tasks\/task-image-1$/);
      return Response.json({
        task_id: "task-image-1",
        status: "completed",
        outputs: [
          { url: "https://cdn.shuyu.example/output-1.png" },
          { url: "https://cdn.shuyu.example/output-2.png" },
        ],
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputUrls, [
    "https://cdn.shuyu.example/output-1.png",
    "https://cdn.shuyu.example/output-2.png",
  ]);
});

test("poll maps every documented terminal failure and only nonterminal states keep processing", async () => {
  const expected = new Map([
    ["queued", "queued"],
    ["processing", "processing"],
    ["refund_pending", "processing"],
    ["failed", "failed"],
    ["refund_error", "failed"],
    ["refunded", "failed"],
  ]);
  for (const [providerStatus, applicationStatus] of expected) {
    const result = await pollShuyuImageTask(`task-${providerStatus}`, {
      env: { SHUYU_API_KEY: "test-secret" },
      fetchImpl: async () => Response.json({
        task_id: `task-${providerStatus}`,
        status: providerStatus,
      }),
    });
    assert.equal(result.status, applicationStatus, providerStatus);
    assert.equal(result.rawStatus, providerStatus);
  }
});

test("generated-output fetch enforces allowlist, redirects, length, stream cap, timeout, and cancellation", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    fetchShuyuOutputImage("https://127.0.0.1/internal", {
      allowedHosts: ["cdn.shuyu.example"],
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    }),
    /allowed/i,
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    fetchShuyuOutputImage("https://cdn.shuyu.example/output.png", {
      allowedHosts: ["cdn.shuyu.example"],
      fetchImpl: async (_input, init) => {
        assert.equal(init?.redirect, "error");
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      },
    }),
    /redirect|read/i,
  );

  let oversizedCancelled = false;
  const oversizedBody = new ReadableStream<Uint8Array>({
    cancel() { oversizedCancelled = true; },
  });
  await assert.rejects(
    fetchShuyuOutputImage("https://cdn.shuyu.example/output.png", {
      allowedHosts: ["cdn.shuyu.example"],
      maxBytes: 8,
      fetchImpl: async () => new Response(oversizedBody, {
        headers: { "content-type": "image/png", "content-length": "9" },
      }),
    }),
    /size|large/i,
  );
  assert.equal(oversizedCancelled, true);

  let streamedCancelled = false;
  const streamedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
    },
    cancel() { streamedCancelled = true; },
  });
  await assert.rejects(
    fetchShuyuOutputImage("https://cdn.shuyu.example/output.png", {
      allowedHosts: ["cdn.shuyu.example"],
      maxBytes: 8,
      fetchImpl: async () => new Response(streamedBody, {
        headers: { "content-type": "image/png" },
      }),
    }),
    /size|large/i,
  );
  assert.equal(streamedCancelled, true);

  let timeoutCancelled = false;
  const stalledBody = new ReadableStream<Uint8Array>({
    cancel() { timeoutCancelled = true; },
  });
  await assert.rejects(
    fetchShuyuOutputImage("https://cdn.shuyu.example/output.png", {
      allowedHosts: ["cdn.shuyu.example"],
      timeoutMs: 20,
      fetchImpl: async () => new Response(stalledBody, {
        headers: { "content-type": "image/png" },
      }),
    }),
    /timed out/i,
  );
  assert.equal(timeoutCancelled, true);
});

test("generated-output fetch returns bounded image bytes", async () => {
  const bytes = Buffer.from("89504e470d0a1a0a", "hex");
  const result = await fetchShuyuOutputImage(
    "https://cdn.shuyu.example/output.png",
    {
      allowedHosts: ["cdn.shuyu.example"],
      fetchImpl: async () => new Response(bytes, {
        headers: {
          "content-type": "image/png",
          "content-length": String(bytes.byteLength),
        },
      }),
    },
  );
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.mimeType, "image/png");
});
