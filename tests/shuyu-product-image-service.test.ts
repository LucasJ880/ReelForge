import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchShuyuOutputImage,
  pollShuyuImageTask,
  submitShuyuImageTask,
} from "../src/lib/providers/shuyu-image-provider";
import { db } from "../src/lib/db";
import {
  __test__ as productImageServiceTest,
  createProductImageJob,
  reconcileProductImageJob,
} from "../src/lib/services/product-image-service";

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

test("service persists audited snapshots and preserves the source asset when submission fails", async (t) => {
  const model = db.productImageJob as unknown as Record<string, unknown>;
  const originals = {
    findUnique: model.findUnique,
    create: model.create,
    updateMany: model.updateMany,
    update: model.update,
    findFirst: model.findFirst,
  };
  let row: Record<string, unknown> | null = null;
  model.findUnique = async () => row ? { ...row, sourceAsset, outputs: [] } : null;
  model.create = async (args: { data: Record<string, unknown> }) => {
    row = {
      id: "job-1",
      status: "QUEUED",
      retryCount: 0,
      pollErrors: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...args.data,
    };
    return { ...row, sourceAsset, outputs: [] };
  };
  model.updateMany = async (args: { data: Record<string, unknown> }) => {
    if (!row) return { count: 0 };
    Object.assign(row, args.data);
    return { count: 1 };
  };
  model.update = async (args: { data: Record<string, unknown> }) => {
    if (!row) throw new Error("missing row");
    Object.assign(row, args.data);
    return { ...row };
  };
  model.findFirst = async () => row ? { ...row, sourceAsset, outputs: [] } : null;
  const sourceAsset = {
    id: "source-asset", userId: "user-1", workspaceId: null,
    storageKey: "uploads/source.png", url: "https://assets.example.test/source.png",
    mimeType: "image/png", byteSize: 68, sha256: "sha", width: 1, height: 1,
    createdAt: new Date(), updatedAt: new Date(),
  };
  productImageServiceTest.__setRuntimeDependenciesForTests({
    submitTask: async (input) => {
      await input.onPlanSelected?.({
        planId: "image-plan-01",
        model: "gpt-image-2",
        resolution: "1K",
        points: 24,
        family: "gpt-image-2",
      });
      throw new Error("provider unavailable");
    },
  });
  t.after(() => {
    Object.assign(model, originals);
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  const failed = await createProductImageJob({
    userId: "user-1",
    idempotencyKey: "idem-1",
    prompt: "Improve this real product photo",
    preset: "white_studio",
    aspectRatio: "1:1",
    resolution: "1K",
    resultCount: 1,
    sourceAsset,
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.provider, "shuyu");
  assert.equal(failed.planId, "image-plan-01");
  assert.equal(failed.modelSnapshot, "gpt-image-2");
  assert.equal(failed.pointsSnapshot, 24);
  assert.equal(failed.sourceAssetId, sourceAsset.id);
  assert.equal(failed.sourceAsset?.id, sourceAsset.id);
});

test("successful reconciliation copies Shuyu outputs into durable owned asset relations", async (t) => {
  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const resultModel = db.productImageResult as unknown as Record<string, unknown>;
  const originals = {
    jobFindFirst: jobModel.findFirst,
    jobFindUnique: jobModel.findUnique,
    jobUpdateMany: jobModel.updateMany,
    jobUpdate: jobModel.update,
    resultFindMany: resultModel.findMany,
    resultCreate: resultModel.create,
  };
  const now = new Date();
  const row: Record<string, unknown> = {
    id: "job-success", userId: "user-1", status: "PROCESSING",
    externalTaskId: "task-success", resultCount: 1, pollErrors: 0,
    lastCheckedAt: now, outputs: [], sourceAsset: null,
    mode: "GENERATE", preset: "white_studio", aspectRatio: "1:1",
    model: "gpt-image-2", modelSnapshot: "gpt-image-2",
  };
  const results: Array<Record<string, unknown>> = [];
  const fullRow = () => ({
    ...row,
    sourceAsset: null,
    outputs: results.map((result) => ({ ...result, asset: outputAsset })),
  });
  const outputAsset = {
    id: "output-asset", userId: "user-1", workspaceId: null,
    storageKey: "renders/output.png", url: "https://assets.example.test/output.png",
    mimeType: "image/png", byteSize: 8, sha256: "sha", width: 1, height: 1,
    createdAt: now, updatedAt: now,
  };
  jobModel.findFirst = async () => fullRow();
  jobModel.findUnique = async () => fullRow();
  jobModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    Object.assign(row, args.data);
    return { count: 1 };
  };
  jobModel.update = async (args: { data: Record<string, unknown> }) => {
    Object.assign(row, args.data);
    return fullRow();
  };
  resultModel.create = async (args: { data: Record<string, unknown> }) => {
    const result = { id: "result-1", createdAt: now, ...args.data };
    results.push(result);
    return result;
  };
  resultModel.findMany = async () => results.map((result) => ({ ...result, asset: outputAsset }));
  const deleted: string[] = [];
  productImageServiceTest.__setRuntimeDependenciesForTests({
    pollTask: async () => ({
      status: "succeeded", rawStatus: "completed",
      outputUrls: ["https://cdn.shuyu.example/output.png"],
    }),
    fetchOutputImage: async () => ({
      bytes: Buffer.from("89504e470d0a1a0a", "hex"),
      mimeType: "image/png",
    }),
    getStorageProvider: () => ({
      id: "vercel_blob", displayName: "test", isConfigured: () => true,
      uploadFile: async () => { throw new Error("unused"); },
      uploadBuffer: async () => ({ key: "renders/output.png", url: outputAsset.url, absolute: true }),
      getSignedUploadUrl: async () => null, getSignedDownloadUrl: async () => "", getPublicUrl: () => "",
      deleteObject: async (_bucket, key) => { deleted.push(key); },
    }),
    createOwnedAsset: async () => outputAsset,
  });
  t.after(() => {
    jobModel.findFirst = originals.jobFindFirst;
    jobModel.findUnique = originals.jobFindUnique;
    jobModel.updateMany = originals.jobUpdateMany;
    jobModel.update = originals.jobUpdate;
    resultModel.findMany = originals.resultFindMany;
    resultModel.create = originals.resultCreate;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  const reconciled = await reconcileProductImageJob("job-success", "user-1");
  assert.equal(reconciled?.status, "SUCCEEDED");
  assert.equal(reconciled?.outputAssetId, outputAsset.id);
  assert.equal(reconciled?.outputs[0]?.asset.id, outputAsset.id);
  assert.equal(results[0]?.productImageJobId, "job-success");
  assert.deepEqual(deleted, []);
});

test("generated-output copy is deleted when owned-asset persistence fails", async (t) => {
  const deleted: string[] = [];
  productImageServiceTest.__setRuntimeDependenciesForTests({
    fetchOutputImage: async () => ({
      bytes: Buffer.from("89504e470d0a1a0a", "hex"),
      mimeType: "image/png",
    }),
    getStorageProvider: () => ({
      id: "vercel_blob", displayName: "test", isConfigured: () => true,
      uploadFile: async () => { throw new Error("unused"); },
      uploadBuffer: async () => ({
        key: "renders/uncommitted.png",
        url: "https://assets.example.test/uncommitted.png",
        absolute: true,
      }),
      getSignedUploadUrl: async () => null, getSignedDownloadUrl: async () => "", getPublicUrl: () => "",
      deleteObject: async (_bucket, key) => { deleted.push(key); },
    }),
    createOwnedAsset: async () => { throw new Error("database unavailable"); },
  });
  t.after(() => productImageServiceTest.__setRuntimeDependenciesForTests(null));

  await assert.rejects(
    productImageServiceTest.persistOutput({
      id: "job-cleanup", userId: "user-1", outputs: [], sourceAsset: null,
    } as never, 0, "https://cdn.shuyu.example/output.png"),
    /database unavailable/,
  );
  assert.deepEqual(deleted, ["renders/uncommitted.png"]);
});
