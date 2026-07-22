import assert from "node:assert/strict";
import test from "node:test";

import { createUploadBlobPostHandler } from "../src/app/api/upload/blob/route";
import {
  createProductImagePostHandler,
  productImageJobView,
} from "../src/app/api/product-images/route";
import { db } from "../src/lib/db";
import { findProductImageResultForUser } from "../src/lib/services/product-image-service";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function uploadRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  form.set("prefix", "uploads/references");
  return new Request("http://localhost/api/upload/blob", { method: "POST", body: form });
}

test("upload route returns 201 without any AI review dependency", async () => {
  const calls: string[] = [];
  const handler = createUploadBlobPostHandler({
    requireAuth: async () => ({ ok: true, session: { user: { id: "user-1" } } as never }),
    getStorageProvider: () => ({
      id: "vercel_blob",
      displayName: "test",
      isConfigured: () => true,
      uploadFile: async () => {
        calls.push("store");
        return { key: "uploads/references/random.png", url: "https://assets.example.test/random.png", absolute: true };
      },
      uploadBuffer: async () => { throw new Error("unused"); },
      getSignedUploadUrl: async () => null,
      getSignedDownloadUrl: async () => "",
      getPublicUrl: () => "",
      deleteObject: async () => { calls.push("cleanup"); },
    }),
    validateFileMagicBytes: async () => {
      calls.push("magic");
      return { ok: true, detected: "image/png" };
    },
    assertQuotaForSession: async () => { calls.push("quota"); },
    createOwnedMediaAsset: async () => {
      calls.push("persist");
      return {
        id: "asset-1", userId: "user-1", workspaceId: null,
        storageKey: "uploads/references/random.png",
        url: "https://assets.example.test/random.png", mimeType: "image/png",
        byteSize: ONE_PIXEL_PNG.byteLength, sha256: "sha", width: 1, height: 1,
        createdAt: new Date(), updatedAt: new Date(),
      };
    },
    randomUUID: () => "fixed-random-id",
  });

  const response = await handler(uploadRequest(new File([ONE_PIXEL_PNG], "source.png", { type: "image/png" })) as never);
  assert.equal(response.status, 201);
  assert.deepEqual(calls, ["magic", "quota", "store", "persist"]);
  assert.equal((await response.json()).asset.id, "asset-1");
});

test("upload validations run before quota, storage, and persistence", async () => {
  const calls: string[] = [];
  const handler = createUploadBlobPostHandler({
    requireAuth: async () => ({ ok: true, session: { user: { id: "user-1" } } as never }),
    getStorageProvider: () => { calls.push("storage"); throw new Error("must not run"); },
    validateFileMagicBytes: async () => { calls.push("magic"); return { ok: false, detected: null, reason: "signature mismatch" }; },
    assertQuotaForSession: async () => { calls.push("quota"); },
    createOwnedMediaAsset: async () => { calls.push("persist"); throw new Error("must not run"); },
    randomUUID: () => "fixed-random-id",
  });

  const response = await handler(uploadRequest(new File([ONE_PIXEL_PNG], "source.png", { type: "image/png" })) as never);
  assert.equal(response.status, 415);
  assert.deepEqual(calls, ["magic"]);
});

test("upload route deletes stored bytes when asset persistence fails", async () => {
  const calls: string[] = [];
  const handler = createUploadBlobPostHandler({
    requireAuth: async () => ({ ok: true, session: { user: { id: "user-1" } } as never }),
    getStorageProvider: () => ({
      id: "vercel_blob", displayName: "test", isConfigured: () => true,
      uploadFile: async () => ({ key: "uploads/random.png", url: "https://assets.example.test/random.png", absolute: true }),
      uploadBuffer: async () => { throw new Error("unused"); },
      getSignedUploadUrl: async () => null, getSignedDownloadUrl: async () => "", getPublicUrl: () => "",
      deleteObject: async (_bucket, key) => { calls.push(`cleanup:${key}`); },
    }),
    validateFileMagicBytes: async () => ({ ok: true, detected: "image/png" }),
    assertQuotaForSession: async () => undefined,
    createOwnedMediaAsset: async () => { throw new Error("database unavailable"); },
    randomUUID: () => "fixed-random-id",
  });

  const response = await handler(uploadRequest(new File([ONE_PIXEL_PNG], "source.png", { type: "image/png" })) as never);
  assert.equal(response.status, 503);
  assert.deepEqual(calls, ["cleanup:uploads/random.png"]);
});

test("product-image idempotent replay reconstructs the active source and output asset DTO", async () => {
  const calls: string[] = [];
  const sourceAsset = {
    id: "source-asset", userId: "user-1", workspaceId: null,
    storageKey: "uploads/source.png", url: "https://assets.example.test/source.png",
    mimeType: "image/png", byteSize: 68, sha256: "source-sha", width: 1, height: 1,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const outputAsset = { ...sourceAsset, id: "output-asset", storageKey: "renders/output.png", url: "https://assets.example.test/output.png" };
  const existing = {
    id: "job-1", userId: "user-1", idempotencyKey: "idem-1", mode: "OPTIMIZE", status: "SUCCEEDED",
    prompt: "Improve this product photo", preset: "white_studio", aspectRatio: "1:1", quality: "1K",
    model: "gpt-image-2", sourceImageUrl: sourceAsset.url, sourceMimeType: sourceAsset.mimeType,
    sourceAssetId: sourceAsset.id, sourceAsset, outputImageUrl: outputAsset.url, outputAssetId: outputAsset.id,
    outputAsset, outputs: [{ id: "result-1", productImageJobId: "job-1", assetId: outputAsset.id, asset: outputAsset, position: 0, outputImageUrl: outputAsset.url, createdAt: new Date() }],
    provider: "shuyu", providerRequestKey: "request-key", externalTaskId: "task-1", planId: "image-plan-01",
    modelSnapshot: "gpt-image-2", resolutionSnapshot: "1K", pointsSnapshot: 24, finalPoints: null,
    resultCount: 1, lastProviderStatus: "completed", lastCheckedAt: new Date(), pollErrors: 0,
    fromMock: false, retryCount: 0, errorCode: null, errorMessage: null, startedAt: new Date(), completedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  };
  const handler = createProductImagePostHandler({
    requireAuth: async () => ({ ok: true, session: { user: { id: "user-1" } } as never }),
    findExisting: async () => existing as never,
    resolveOwnedImageAssets: async () => { calls.push("resolve"); return []; },
    assertAuthenticatedActionRateLimit: async () => { calls.push("quota"); },
    createProductImageJob: async () => { calls.push("create"); return existing as never; },
  });
  const response = await handler(new Request("http://localhost/api/product-images", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
    body: JSON.stringify({ invalid: true }),
  }) as never);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, []);
  const body = await response.json();
  assert.equal(body.duplicate, true);
  assert.equal(body.asset.id, "source-asset");
  assert.equal(body.job.outputs[0].asset.id, "output-asset");
});

test("historical succeeded URL-only jobs render read-only output with regeneration guidance", () => {
  const view = productImageJobView({
    id: "legacy-job",
    status: "SUCCEEDED",
    outputImageUrl: "https://legacy.example.test/output.png",
    outputs: [],
    sourceAsset: null,
    providerTasks: [],
    createdAt: new Date(),
  } as never);
  assert.equal(view.outputs.length, 1);
  assert.equal(view.outputs[0]?.url, "https://legacy.example.test/output.png");
  assert.equal(view.outputs[0]?.asset, null);
  assert.equal(view.outputs[0]?.handoffId, null);
  assert.match(view.historyNotice ?? "", /重新生成|服务器资产/);
});

test("failed jobs expose only confirmed-rejection tasks as retryable", () => {
  const view = productImageJobView({
    id: "failed-job",
    status: "FAILED",
    outputImageUrl: null,
    outputs: [],
    sourceAsset: null,
    providerTasks: [
      { id: "rejected", ordinal: 0, submissionState: "REJECTED", errorMessage: "retry" },
      { id: "unknown", ordinal: 1, submissionState: "ACK_UNKNOWN", errorMessage: "stop" },
    ],
    createdAt: new Date(),
  } as never);
  assert.deepEqual(view.retryableTasks, [
    { id: "rejected", ordinal: 0, errorMessage: "retry" },
  ]);
});

test("result-scoped handoff resolves outputs two through four by authenticated owner", async (t) => {
  const model = db.productImageResult as unknown as Record<string, unknown>;
  const original = model.findFirst;
  const captured: Array<Record<string, unknown>> = [];
  model.findFirst = async (args: Record<string, unknown>) => {
    captured.push(args);
    const where = args.where as { id: string };
    return {
      id: where.id,
      assetId: `asset-${where.id}`,
      asset: { id: `asset-${where.id}`, url: `https://assets.example.test/${where.id}.png` },
      productImageJob: { id: "job-4", userId: "owner-1", status: "SUCCEEDED" },
    };
  };
  t.after(() => { model.findFirst = original; });

  for (const position of [2, 3, 4]) {
    const result = await findProductImageResultForUser(`result-${position}`, "owner-1");
    assert.equal(result?.id, `result-${position}`);
  }
  for (const [index, call] of captured.entries()) {
    const where = call.where as {
      id: string;
      productImageJob: { userId: string; status: string };
    };
    assert.equal(where.id, `result-${index + 2}`);
    assert.deepEqual(where.productImageJob, { userId: "owner-1", status: "SUCCEEDED" });
  }
});
