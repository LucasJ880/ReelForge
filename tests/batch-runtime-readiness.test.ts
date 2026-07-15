import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { BatchJob } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  __resetAppEnvForTests,
  VideoGenerationRuntimeUnavailableError,
} from "../src/lib/config/env";
import {
  createBatchJob,
  processBatchTick,
  retryFailedBatchJob,
  retryFailedBatchJobs,
} from "../src/lib/services/batch-service";
import { hashVideoDispatchRequest } from "../src/lib/services/video-dispatch-idempotency";

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

function withVideoRuntime(
  t: TestContext,
  values: Record<string, string | undefined>,
) {
  const originals = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetAppEnvForTests();
  t.after(() => {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetAppEnvForTests();
  });
}

function productionMock(t: TestContext) {
  withVideoRuntime(t, {
    VERCEL_ENV: "production",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
    AIVORA_DRY_RUN: "false",
  });
}

function assertRuntimeUnavailable(error: unknown): boolean {
  assert.ok(error instanceof VideoGenerationRuntimeUnavailableError);
  assert.equal(error.reason, "production_mock_forbidden");
  return true;
}

const input = {
  userId: "runtime-user",
  templateId: "runtime-template",
  templateVersion: 1,
  images: [{ id: "image-1", url: "https://example.test/product.jpg" }],
  requestedCount: 1,
  idempotencyKey: "runtime-idempotency-key",
};

test("batch create seals production mock before the existing idempotency shortcut", async (t) => {
  productionMock(t);
  let databaseTouched = false;
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => {
      databaseTouched = true;
      throw new Error("readiness must precede the replay lookup");
    },
  });

  await assert.rejects(() => createBatchJob(input), assertRuntimeUnavailable);
  assert.equal(databaseTouched, false);
});

test("batch tick seals production mock before lease recovery or any database side effect", async (t) => {
  productionMock(t);
  let databaseTouched = false;
  const touched = async () => {
    databaseTouched = true;
    throw new Error("readiness must precede tick database work");
  };
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: touched,
    update: touched,
    updateMany: touched,
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findFirst: touched,
    findMany: touched,
    updateMany: touched,
  });

  await assert.rejects(
    () => processBatchTick("runtime-batch"),
    assertRuntimeUnavailable,
  );
  assert.equal(databaseTouched, false);
});

test("batch retry-all and retry-one seal production mock before reset mutations", async (t) => {
  productionMock(t);
  let databaseTouched = false;
  const touched = async () => {
    databaseTouched = true;
    throw new Error("readiness must precede retry database work");
  };
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: touched,
    update: touched,
  });
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findFirst: touched,
    findMany: touched,
    updateMany: touched,
    groupBy: touched,
  });

  await assert.rejects(
    () => retryFailedBatchJobs("runtime-batch"),
    assertRuntimeUnavailable,
  );
  await assert.rejects(
    () => retryFailedBatchJob("runtime-batch", "runtime-job"),
    assertRuntimeUnavailable,
  );
  assert.equal(databaseTouched, false);
});

test("preview mock still permits an existing idempotent batch replay", async (t) => {
  withVideoRuntime(t, {
    VERCEL_ENV: "preview",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
    AIVORA_DRY_RUN: "false",
  });
  const requestHash = hashVideoDispatchRequest({
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    images: input.images,
    requestedCount: input.requestedCount,
    productName: null,
  });
  const existing = {
    id: "preview-existing-batch",
    userId: input.userId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    requestedCount: input.requestedCount,
    productName: null,
    imageIds: input.images.map((image) => image.id),
    imageUrls: input.images.map((image) => image.url),
    idempotencyKey: input.idempotencyKey,
    requestHash,
  } as unknown as BatchJob;
  let templateTouched = false;
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findUnique: async () => existing,
  });
  patch(t, db.styleTemplate as unknown as Record<string, unknown>, {
    findFirst: async () => {
      templateTouched = true;
      throw new Error("idempotent replay must not reload the template");
    },
  });

  assert.equal(await createBatchJob(input), existing);
  assert.equal(templateTouched, false);
});
