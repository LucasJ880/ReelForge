import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  BatchJobStatus,
  ProviderSubmissionState,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { customerApiError } from "../src/lib/contracts/customer-api";
import { customerApiErrorSchema } from "../src/lib/contracts/customer-api";
import {
  batchCancelResponseSchema,
  batchRetryAllResponseSchema,
  batchRetryOneResponseSchema,
  batchStatusResponseSchema,
  customerBatchStatusSchema,
} from "../src/lib/contracts/batch-api";
import { db } from "../src/lib/db";
import {
  BatchNotFoundError,
  getBatchStatus,
  retryFailedBatchJob,
  toCustomerBatchStatus,
} from "../src/lib/services/batch-service";

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

function customerBatchFixture() {
  const now = new Date("2026-07-14T12:00:00.000Z");
  return toCustomerBatchStatus({
    id: "batch-contract-1",
    templateId: "template-contract-1",
    templateVersion: 3,
    productName: "Contract Product",
    requestedCount: 1,
    status: BatchJobStatus.COMPLETED,
    queuedCount: 0,
    pausedCount: 0,
    runningCount: 0,
    completedCount: 1,
    failedCount: 0,
    cancelledCount: 0,
    statusReason: null,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
    template: {
      id: "template-contract-1",
      version: 3,
      name: "Contract template",
      nameZh: "契约模板",
      category: "UGC",
      coverImage: "/template-previews/ugc-handheld-review.jpg",
    },
    videoJobs: [
      {
        id: "job-contract-1",
        batchIndex: 0,
        status: VideoJobStatus.SUCCEEDED,
        assignedAssets: {
          assets: [{ id: "asset-1", url: "https://example.test/asset.jpg" }],
          seed: 42,
          variantIndex: 3,
          dedupeKey: "must-not-leak-assignment-key",
        },
        outputVideoUrl: "https://example.test/output.mp4",
        outputThumbUrl: null,
        lastProgress: 100,
        errorMessage: null,
        userSafeError: null,
        provider: VideoProvider.MOCK,
        externalJobId: "must-not-leak",
        lastProviderStatus: "must-not-leak",
        submissionState: ProviderSubmissionState.ACCEPTED,
        submissionErrorClass: null,
        retryCount: 0,
        createdAt: now,
        submittedAt: now,
        finishedAt: now,
      },
    ],
  } as unknown as Parameters<typeof toCustomerBatchStatus>[0]);
}

test("H1 batch contract: service DTO and every success envelope share one strict schema", () => {
  const batch = customerBatchFixture();
  const wireBatch = JSON.parse(JSON.stringify(batch)) as unknown;

  assert.deepEqual(customerBatchStatusSchema.parse(wireBatch), wireBatch);
  assert.deepEqual(
    Object.keys(customerBatchStatusSchema.parse(batch)),
    [
      "id",
      "templateId",
      "templateVersion",
      "productName",
      "requestedCount",
      "status",
      "queuedCount",
      "pausedCount",
      "runningCount",
      "completedCount",
      "failedCount",
      "cancelledCount",
      "statusReason",
      "finishedAt",
      "createdAt",
      "updatedAt",
      "template",
      "videoJobs",
    ],
  );
  assert.deepEqual(batchStatusResponseSchema.parse({ batch }), { batch });
  assert.deepEqual(batchCancelResponseSchema.parse({ cancelled: 1, batch }), {
    cancelled: 1,
    batch,
  });
  assert.deepEqual(batchRetryAllResponseSchema.parse({ retried: 1, batch }), {
    retried: 1,
    batch,
  });
  assert.deepEqual(batchRetryOneResponseSchema.parse({ retried: 1, batch }), {
    retried: 1,
    batch,
  });
  assert.doesNotMatch(JSON.stringify(batch), /must-not-leak/);
  assert.deepEqual(batch.videoJobs[0]?.assignedAssets, {
    assets: [{ id: "asset-1", url: "https://example.test/asset.jpg" }],
  });

  assert.equal(
    batchStatusResponseSchema.safeParse({ batch, unexpected: true }).success,
    false,
    "success envelopes are strict snapshots; a drifted top-level field must fail",
  );
});

test("H1 batch contract: customer media URLs reject local and executable protocols", () => {
  const fixture = customerBatchFixture();
  const job = fixture.videoJobs[0]!;
  const poisoned = {
    ...fixture,
    videoJobs: [
      {
        ...job,
        outputVideoUrl: "javascript:alert(1)",
      },
    ],
  };
  assert.equal(customerBatchStatusSchema.safeParse(poisoned).success, false);
});

test("H1 batch contract: 400/401/403/404/409/422/429/5xx errors retain the common recovery envelope", () => {
  const snapshots = [
    [400, "VALIDATION_FAILED", false, "fix_request"],
    [401, "AUTH_REQUIRED", false, "sign_in"],
    [403, "FORBIDDEN", false, "contact_support"],
    [404, "RESOURCE_NOT_FOUND", false, "contact_support"],
    [409, "INVALID_STATE", false, "refresh_status"],
    [422, "QUALITY_BLOCKED", false, "fix_request"],
    [429, "QUOTA_EXCEEDED", false, "view_usage"],
    [500, "INTERNAL_ERROR", true, "retry"],
    [503, "SERVICE_UNAVAILABLE", true, "wait"],
  ] as const;

  assert.deepEqual(
    snapshots.map(([status, code, retryable, action]) => ({
      status,
      body: customerApiErrorSchema.parse(
        customerApiError({
          code,
          message: `contract-${status}`,
          retryable,
          action,
        }),
      ),
    })),
    snapshots.map(([status, code, retryable, action]) => ({
      status,
      body: {
        ok: false,
        code,
        error: `contract-${status}`,
        retryable,
        action,
      },
    })),
  );
});

test("H1 batch contract: all customer batch routes validate success DTOs and avoid naked error objects", () => {
  const routes = [
    ["src/app/api/batches/route.ts", "batchStatusResponseSchema"],
    ["src/app/api/batches/[id]/status/route.ts", "batchStatusResponseSchema"],
    ["src/app/api/batches/[id]/cancel/route.ts", "batchCancelResponseSchema"],
    ["src/app/api/batches/[id]/retry/route.ts", "batchRetryAllResponseSchema"],
    [
      "src/app/api/batches/[id]/jobs/[jobId]/retry/route.ts",
      "batchRetryOneResponseSchema",
    ],
  ] as const;
  for (const [relativePath, schemaName] of routes) {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, new RegExp(`${schemaName}\\.parse\\(`), relativePath);
    assert.doesNotMatch(
      source,
      /NextResponse\.json\(\s*\{\s*error\s*:/,
      `${relativePath} must use the common customer error envelope`,
    );
  }

  const create = readFileSync(
    path.join(process.cwd(), "src/app/api/batches/route.ts"),
    "utf8",
  );
  assert.match(
    create,
    /BatchImageIdConflictError[\s\S]*?code:\s*"VALIDATION_FAILED"[\s\S]*?action:\s*"fix_request"/,
    "duplicate image ids must use the complete customer error contract",
  );
  assert.match(
    create,
    /BatchInsufficientAssetsError[\s\S]*?code:\s*"VALIDATION_FAILED"[\s\S]*?action:\s*"fix_request"/,
    "template asset minimum must be a 422 fix-request response, never a 500",
  );
  assert.match(
    create,
    /VideoGenerationRuntimeUnavailableError[\s\S]*?code:\s*"SERVICE_UNAVAILABLE"[\s\S]*?action:\s*"wait"/,
    "runtime misconfiguration must fail before quota or provider work",
  );

  const status = readFileSync(
    path.join(process.cwd(), "src/app/api/batches/[id]/status/route.ts"),
    "utf8",
  );
  assert.match(status, /code:\s*"RESOURCE_NOT_FOUND"/);
  assert.doesNotMatch(
    status,
    /code:\s*"INTERNAL_ERROR"[\s\S]{0,120}message:\s*"批次不存在。"/,
    "404 must never masquerade as INTERNAL_ERROR",
  );

  const retryOne = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/batches/[id]/jobs/[jobId]/retry/route.ts",
    ),
    "utf8",
  );
  for (const outcome of ["not_found", "invalid_state", "billing_unsafe"]) {
    assert.match(retryOne, new RegExp(`result\\.outcome === "${outcome}"`));
  }
});

test("H1 batch ownership contract: missing and foreign-owned batches share a non-leaking 404 signal", async (t) => {
  patch(t, db.batchJob as unknown as Record<string, unknown>, {
    findFirst: async () => null,
  });
  await assert.rejects(
    () => getBatchStatus("guessed-foreign-id", "customer-1"),
    (error: unknown) => {
      assert.ok(error instanceof BatchNotFoundError);
      assert.equal(error.message, "BatchJob 不存在或无权访问");
      return true;
    },
  );
});

test("H1 retry-one contract: nonexistent, illegal-state and billing-unsafe jobs are distinct", async (t) => {
  const videoJob = db.videoJob as unknown as Record<string, unknown>;
  let updateCalls = 0;
  patch(t, videoJob, {
    findFirst: async ({ where }: { where: { id: string } }) => {
      if (where.id === "missing") return null;
      if (where.id === "running") {
        return {
          status: VideoJobStatus.RUNNING,
          provider: VideoProvider.MOCK,
          submissionState: ProviderSubmissionState.ACCEPTED,
          externalJobId: "mock-running",
          lastProviderStatus: "running",
          errorMessage: null,
        };
      }
      return {
        status: VideoJobStatus.FAILED,
        provider: VideoProvider.SEEDANCE_I2V,
        submissionState: ProviderSubmissionState.ACK_UNKNOWN,
        externalJobId: null,
        lastProviderStatus: null,
        errorMessage: "ack unknown",
      };
    },
    updateMany: async () => {
      updateCalls += 1;
      return { count: 1 };
    },
  });

  assert.deepEqual(await retryFailedBatchJob("batch-1", "missing"), {
    outcome: "not_found",
  });
  assert.deepEqual(await retryFailedBatchJob("batch-1", "running"), {
    outcome: "invalid_state",
  });
  assert.deepEqual(await retryFailedBatchJob("batch-1", "unsafe"), {
    outcome: "billing_unsafe",
  });
  assert.equal(updateCalls, 0, "no rejected retry outcome may mutate or resubmit");
});

test("H1 retry-one contract: a billing-safe failed job is reset exactly once", async (t) => {
  let resetCalls = 0;
  const videoJob = db.videoJob as unknown as Record<string, unknown>;
  const batchJob = db.batchJob as unknown as Record<string, unknown>;
  patch(t, videoJob, {
    findFirst: async () => ({
      status: VideoJobStatus.FAILED,
      provider: VideoProvider.MOCK,
      submissionState: ProviderSubmissionState.NOT_STARTED,
      externalJobId: null,
      lastProviderStatus: null,
      errorMessage: "mock provider rejected before billing",
    }),
    updateMany: async () => {
      resetCalls += 1;
      return { count: 1 };
    },
    groupBy: async () => [
      { status: VideoJobStatus.QUEUED, _count: { _all: 1 } },
    ],
  });
  patch(t, batchJob, {
    findUnique: async () => ({ id: "batch-1", requestedCount: 1 }),
    update: async () => ({ id: "batch-1" }),
  });

  assert.deepEqual(await retryFailedBatchJob("batch-1", "safe"), {
    outcome: "retried",
  });
  assert.equal(resetCalls, 1);
});
