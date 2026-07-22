import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ProductImageStatus, ProviderSubmissionState } from "@prisma/client";

import * as cronRoute from "../src/app/api/cron/poll-videos/route";
import { productImageJobView } from "../src/app/api/product-images/route";
import { db } from "../src/lib/db";
import {
  __test__ as productImageServiceTest,
  createProductImageJob,
  findProductImageResultForUser,
  retryRejectedProductImageProviderTask,
} from "../src/lib/services/product-image-service";

test("new product-image jobs are born recoverable and idempotent replay promotes legacy QUEUED jobs", async (t) => {
  const source = await readFile(
    new URL("../src/lib/services/product-image-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /productImageJob\.create\([\s\S]*?data:\s*\{[\s\S]*?status:\s*ProductImageStatus\.PROCESSING/,
    "the initial job/task transaction must not leave a parent permanently QUEUED",
  );

  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const originals = {
    findUnique: jobModel.findUnique,
    updateMany: jobModel.updateMany,
  };
  const existing = {
    id: "legacy-queued-job",
    userId: "owner-1",
    idempotencyKey: "idem-queued",
    status: ProductImageStatus.QUEUED,
    sourceAsset: null,
    outputs: [],
    providerTasks: [],
  } as Record<string, unknown>;
  jobModel.findUnique = async () => ({ ...existing });
  jobModel.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    assert.deepEqual(args.where, {
      id: "legacy-queued-job",
      status: ProductImageStatus.QUEUED,
    });
    Object.assign(existing, args.data);
    return { count: 1 };
  };
  t.after(() => Object.assign(jobModel, originals));

  const replayed = await createProductImageJob({
    userId: "owner-1",
    idempotencyKey: "idem-queued",
    prompt: "Create a truthful product photograph",
    preset: "white_studio",
    aspectRatio: "1:1",
    resolution: "1K",
    resultCount: 1,
  });
  assert.equal(replayed.status, ProductImageStatus.PROCESSING);
});

test("aggregate recovery self-heals success and failure after a terminal-task interruption", async (t) => {
  const recovery = (productImageServiceTest as unknown as Record<string, unknown>)
    .recoverProductImageAggregates;
  assert.equal(typeof recovery, "function", "cron needs an aggregate recovery scanner");

  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const originals = {
    findMany: jobModel.findMany,
    findUnique: jobModel.findUnique,
    updateMany: jobModel.updateMany,
  };
  const jobs = new Map<string, Record<string, unknown>>([
    ["interrupted-success", {
      id: "interrupted-success", userId: "owner-1", status: ProductImageStatus.PROCESSING,
      resultCount: 1, outputs: [{ assetId: "asset-1", outputImageUrl: "https://assets.test/1.png" }],
      providerTasks: [{ status: ProductImageStatus.SUCCEEDED, submissionState: ProviderSubmissionState.ACCEPTED }],
    }],
    ["interrupted-failure", {
      id: "interrupted-failure", userId: "owner-1", status: ProductImageStatus.QUEUED,
      resultCount: 1, outputs: [],
      providerTasks: [{
        status: ProductImageStatus.FAILED,
        submissionState: ProviderSubmissionState.REJECTED,
        errorCode: "PROVIDER_REJECTED",
        errorMessage: "rejected",
      }],
    }],
  ]);
  jobModel.findMany = async () => [...jobs.keys()].map((id) => ({ id }));
  jobModel.findUnique = async (args: { where: { id: string } }) => {
    const row = jobs.get(args.where.id);
    return row ? { ...row, sourceAsset: null } : null;
  };
  jobModel.updateMany = async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = jobs.get(args.where.id);
    if (!row) return { count: 0 };
    Object.assign(row, args.data);
    return { count: 1 };
  };
  t.after(() => Object.assign(jobModel, originals));

  const recovered = await (recovery as (limit?: number) => Promise<number>)(10);
  assert.equal(recovered, 2);
  assert.equal(jobs.get("interrupted-success")?.status, ProductImageStatus.SUCCEEDED);
  assert.equal(jobs.get("interrupted-failure")?.status, ProductImageStatus.FAILED);
});

test("transient polling errors back off without converting an ACCEPTED task into terminal failure", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const attemptModel = db.productImageProviderAttempt as unknown as Record<string, unknown>;
  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    updateMany: taskModel.updateMany,
    findFirst: taskModel.findFirst,
    attemptUpdateMany: attemptModel.updateMany,
    jobFindUnique: jobModel.findUnique,
    jobUpdateMany: jobModel.updateMany,
    transaction: client.$transaction,
  };
  const task: Record<string, unknown> = {
    id: "accepted-task",
    productImageJobId: "job-1",
    status: ProductImageStatus.PROCESSING,
    submissionState: ProviderSubmissionState.ACCEPTED,
    externalTaskId: "external-1",
    pollErrors: 2,
    leaseOwner: null,
    leaseExpiresAt: null,
    result: null,
    productImageJob: { id: "job-1", userId: "owner-1", sourceAsset: null, outputs: [] },
  };
  taskModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    Object.assign(task, args.data);
    return { count: 1 };
  };
  taskModel.findFirst = async () => ({ ...task });
  attemptModel.updateMany = async () => ({ count: 1 });
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(db);
  jobModel.findUnique = async () => ({
    id: "job-1",
    userId: "owner-1",
    status: ProductImageStatus.PROCESSING,
    resultCount: 1,
    outputs: [],
    providerTasks: [{ ...task }],
    sourceAsset: null,
  });
  jobModel.updateMany = async () => ({ count: 0 });
  productImageServiceTest.__setRuntimeDependenciesForTests({
    pollTask: async () => { throw new Error("temporary provider outage"); },
  });
  t.after(() => {
    taskModel.updateMany = originals.updateMany;
    taskModel.findFirst = originals.findFirst;
    attemptModel.updateMany = originals.attemptUpdateMany;
    jobModel.findUnique = originals.jobFindUnique;
    jobModel.updateMany = originals.jobUpdateMany;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  await productImageServiceTest.reconcileProductImageProviderTask("accepted-task");
  assert.equal(task.status, ProductImageStatus.PROCESSING);
  assert.equal(task.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(task.pollErrors, 3);
  assert.ok(task.availableAt instanceof Date, "poll failure should schedule a safe retry");
  assert.equal(task.completedAt, undefined);
});

test("fatal sibling suppresses confirmed-rejection retry in both DTO and service", async (t) => {
  const job = {
    id: "mixed-failure",
    userId: "owner-1",
    status: ProductImageStatus.FAILED,
    outputImageUrl: null,
    outputs: [],
    sourceAsset: null,
    providerTasks: [
      {
        id: "safe-rejected", ordinal: 0, status: ProductImageStatus.FAILED,
        submissionState: ProviderSubmissionState.REJECTED, errorMessage: "retry",
      },
      {
        id: "fatal-unknown", ordinal: 1, status: ProductImageStatus.FAILED,
        submissionState: ProviderSubmissionState.ACK_UNKNOWN, errorMessage: "stop",
      },
    ],
    createdAt: new Date(),
  };
  assert.deepEqual(productImageJobView(job as never).retryableTasks, []);

  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    findFirst: taskModel.findFirst,
    findUnique: taskModel.findUnique,
    updateMany: taskModel.updateMany,
    jobUpdateMany: jobModel.updateMany,
    transaction: client.$transaction,
  };
  let paidCalls = 0;
  taskModel.findFirst = async (args: { where: Record<string, unknown> }) => {
    const relation = args.where.productImageJob as { providerTasks?: { none?: unknown } } | undefined;
    if (relation?.providerTasks?.none) return null;
    return { id: "safe-rejected", productImageJobId: "mixed-failure", requestKey: "stable-key" };
  };
  taskModel.findUnique = async () => null;
  taskModel.updateMany = async () => ({ count: 1 });
  jobModel.updateMany = async () => ({ count: 1 });
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(db);
  productImageServiceTest.__setRuntimeDependenciesForTests({
    submitTask: async () => {
      paidCalls += 1;
      throw new Error("must not submit");
    },
  });
  t.after(() => {
    Object.assign(taskModel, {
      findFirst: originals.findFirst,
      findUnique: originals.findUnique,
      updateMany: originals.updateMany,
    });
    jobModel.updateMany = originals.jobUpdateMany;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  const retried = await retryRejectedProductImageProviderTask("safe-rejected", "owner-1");
  assert.equal(retried, null);
  assert.equal(paidCalls, 0);
});

test("provider-confirmed refunded task can be retried by its owner with a fresh paid identity", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const attemptModel = db.productImageProviderAttempt as unknown as Record<string, unknown>;
  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    taskFindFirst: taskModel.findFirst,
    taskFindUnique: taskModel.findUnique,
    taskUpdateMany: taskModel.updateMany,
    attemptCreate: attemptModel.create,
    attemptFindUnique: attemptModel.findUnique,
    attemptUpdateMany: attemptModel.updateMany,
    jobFindFirst: jobModel.findFirst,
    jobFindUnique: jobModel.findUnique,
    jobUpdateMany: jobModel.updateMany,
    jobUpdate: jobModel.update,
    transaction: client.$transaction,
  };
  const originalKey = "paid-attempt-one";
  const task: Record<string, unknown> = {
    id: "refunded-task",
    productImageJobId: "refunded-job",
    ordinal: 0,
    requestKey: originalKey,
    status: ProductImageStatus.FAILED,
    submissionState: ProviderSubmissionState.ACCEPTED,
    externalTaskId: "terminal-refunded-external",
    errorCode: "PROVIDER_REFUNDED",
    submitAttempts: 1,
    planId: "image-plan-01",
    modelSnapshot: "gpt-image-2",
    resolutionSnapshot: "1K",
    pointsSnapshot: 24,
    pollErrors: 0,
    result: null,
  };
  const job: Record<string, unknown> = {
    id: "refunded-job",
    userId: "owner-1",
    idempotencyKey: "idem-refunded",
    status: ProductImageStatus.FAILED,
    prompt: "Create a truthful product photograph",
    preset: "white_studio",
    aspectRatio: "1:1",
    quality: "1K",
    resolutionSnapshot: "1K",
    resultCount: 1,
    sourceAsset: null,
    sourceImageUrl: null,
    outputs: [],
  };
  const attempts: Array<Record<string, unknown>> = [{
    providerTaskId: task.id,
    attemptNumber: 1,
    requestKey: originalKey,
    externalTaskId: "terminal-refunded-external",
    submissionState: ProviderSubmissionState.ACCEPTED,
    status: ProductImageStatus.FAILED,
    errorCode: "PROVIDER_REFUNDED",
  }];
  const fullJob = () => ({
    ...job,
    sourceAsset: null,
    outputs: [],
    providerTasks: [{ ...task, result: null }],
  });
  taskModel.findFirst = async () => ({ ...task });
  taskModel.findUnique = async () => ({ ...task, productImageJob: fullJob() });
  taskModel.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (args.where.requestKey && args.where.requestKey !== task.requestKey) return { count: 0 };
    const { submitAttempts, ...plainData } = args.data;
    Object.assign(task, plainData);
    if (
      submitAttempts &&
      typeof submitAttempts === "object" &&
      "increment" in submitAttempts
    ) {
      task.submitAttempts = Number(task.submitAttempts) + Number(submitAttempts.increment);
    }
    return { count: 1 };
  };
  attemptModel.create = async (args: { data: Record<string, unknown> }) => {
    attempts.push({ ...args.data });
    return attempts.at(-1);
  };
  attemptModel.findUnique = async (args: {
    where: { providerTaskId_attemptNumber: { providerTaskId: string; attemptNumber: number } };
  }) => attempts.find((attempt) =>
    attempt.providerTaskId === args.where.providerTaskId_attemptNumber.providerTaskId &&
    attempt.attemptNumber === args.where.providerTaskId_attemptNumber.attemptNumber
  ) ?? null;
  attemptModel.updateMany = async (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    const attempt = attempts.find((candidate) =>
      candidate.providerTaskId === args.where.providerTaskId &&
      (args.where.attemptNumber == null || candidate.attemptNumber === args.where.attemptNumber) &&
      (args.where.externalTaskId == null || candidate.externalTaskId === args.where.externalTaskId) &&
      (args.where.requestKey == null || candidate.requestKey === args.where.requestKey)
    );
    if (!attempt) return { count: 0 };
    Object.assign(attempt, args.data);
    return { count: 1 };
  };
  jobModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    Object.assign(job, args.data);
    return { count: 1 };
  };
  jobModel.update = async () => fullJob();
  jobModel.findUnique = async () => fullJob();
  jobModel.findFirst = async () => fullJob();
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(db);
  let submittedKey: string | null = null;
  productImageServiceTest.__setRuntimeDependenciesForTests({
    submitTask: async (input) => {
      submittedKey = input.requestKey;
      assert.notEqual(input.requestKey, originalKey);
      assert.equal(task.externalTaskId, null, "terminal external identity must be cleared first");
      assert.equal(input.planSnapshot?.planId, "image-plan-01");
      return {
        requestKey: input.requestKey,
        externalTaskId: "paid-attempt-two-external",
        planSnapshot: input.planSnapshot!,
      };
    },
  });
  t.after(() => {
    taskModel.findFirst = originals.taskFindFirst;
    taskModel.findUnique = originals.taskFindUnique;
    taskModel.updateMany = originals.taskUpdateMany;
    attemptModel.create = originals.attemptCreate;
    attemptModel.findUnique = originals.attemptFindUnique;
    attemptModel.updateMany = originals.attemptUpdateMany;
    jobModel.findFirst = originals.jobFindFirst;
    jobModel.findUnique = originals.jobFindUnique;
    jobModel.updateMany = originals.jobUpdateMany;
    jobModel.update = originals.jobUpdate;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  const view = productImageJobView(fullJob() as never);
  assert.deepEqual(view.retryableTasks.map((candidate) => candidate.id), ["refunded-task"]);
  const retried = await retryRejectedProductImageProviderTask("refunded-task", "owner-1");
  assert.equal(retried?.id, "refunded-job");
  assert.ok(submittedKey);
  assert.notEqual(task.requestKey, originalKey);
  assert.equal(task.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(task.externalTaskId, "paid-attempt-two-external");
  assert.equal(attempts.length, 2);
  assert.deepEqual(
    {
      requestKey: attempts[0]?.requestKey,
      externalTaskId: attempts[0]?.externalTaskId,
      errorCode: attempts[0]?.errorCode,
    },
    {
      requestKey: originalKey,
      externalTaskId: "terminal-refunded-external",
      errorCode: "PROVIDER_REFUNDED",
    },
  );
  assert.equal(attempts[1]?.requestKey, submittedKey);
  assert.equal(attempts[1]?.externalTaskId, "paid-attempt-two-external");
});

test("only confirmed refunded is retryable; ordinary failed and refund_error fail closed", () => {
  const viewFor = (id: string, errorCode: string, rawStatus: string) => productImageJobView({
    id: `job-${id}`,
    userId: "owner-1",
    status: ProductImageStatus.FAILED,
    outputImageUrl: null,
    outputs: [],
    sourceAsset: null,
    providerTasks: [{
      id,
      ordinal: 0,
      status: ProductImageStatus.FAILED,
      submissionState: ProviderSubmissionState.ACCEPTED,
      externalTaskId: `external-${id}`,
      errorCode,
      lastProviderStatus: rawStatus,
      errorMessage: rawStatus,
    }],
    createdAt: new Date(),
  } as never);

  assert.deepEqual(viewFor("failed", "PROVIDER_FAILED", "failed").retryableTasks, []);
  assert.deepEqual(
    viewFor("refunded", "PROVIDER_REFUNDED", "refunded").retryableTasks.map((task) => task.id),
    ["refunded"],
  );
  assert.deepEqual(
    viewFor("refund-error", "PROVIDER_REFUND_ERROR", "refund_error").retryableTasks,
    [],
  );
});

test("every paid retry retains the previous request and external identities in durable attempts", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model ProductImageProviderAttempt\s*\{/);
  assert.match(schema, /attempts\s+ProductImageProviderAttempt\[\]/);
  assert.match(schema, /@@unique\(\[providerTaskId, attemptNumber\]\)/);

  const attemptModel = (db as unknown as Record<string, unknown>).productImageProviderAttempt;
  assert.ok(attemptModel, "generated Prisma client must expose immutable provider attempts");

  const migration = await readFile(
    new URL("../prisma/migrations/20260722192500_product_image_provider_attempts/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "ProductImageProviderAttempt"/);
  assert.match(migration, /INSERT INTO "ProductImageProviderAttempt"[\s\S]*"requestKey"/);

  const service = await readFile(
    new URL("../src/lib/services/product-image-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /productImageProviderAttempt\.create/);
  assert.doesNotMatch(
    service,
    /productImageProviderAttempt\.updateMany\([\s\S]{0,500}data:\s*\{[\s\S]{0,200}requestKey:/,
    "attempt request identity must never be overwritten",
  );
});

test("stale-submission quarantine never commits an attempt when the task CAS loses", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const attemptModel = db.productImageProviderAttempt as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    findMany: taskModel.findMany,
    updateMany: taskModel.updateMany,
    attemptUpdateMany: attemptModel.updateMany,
    transaction: client.$transaction,
  };
  let committedCasMiss = false;
  taskModel.findMany = async () => [{
    id: "stale-submit",
    productImageJobId: "job-stale-submit",
    requestKey: "stale-key",
    submitAttempts: 1,
  }];
  attemptModel.updateMany = async () => ({ count: 1 });
  taskModel.updateMany = async () => ({ count: 0 });
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => {
    const result = await callback(db);
    if ((result as { count?: number } | null)?.count === 0) committedCasMiss = true;
    return result;
  };
  t.after(() => {
    taskModel.findMany = originals.findMany;
    taskModel.updateMany = originals.updateMany;
    attemptModel.updateMany = originals.attemptUpdateMany;
    client.$transaction = originals.transaction;
  });

  const failed = await productImageServiceTest.failStaleSubmittingTasks(
    new Date("2026-07-22T18:00:00.000Z"),
  );
  assert.equal(failed, 0);
  assert.equal(
    committedCasMiss,
    false,
    "a lost task CAS must abort the transaction instead of committing attempt-only state",
  );
});

test("cron isolates image polling errors so video polling and sweep still complete as degraded", async () => {
  const factory = (cronRoute as unknown as Record<string, unknown>).createPollVideosHandler;
  assert.equal(typeof factory, "function", "cron route must expose an injectable behavior boundary");
  const calls: string[] = [];
  const handler = (factory as (deps: Record<string, unknown>) => (req: Request) => Promise<Response>)({
    machineAuthFailure: () => null,
    startSchedulerHeartbeat: () => ({
      finish: (status: string, details: Record<string, unknown>) => ({ status, details }),
    }),
    pollRunningJobs: async () => { calls.push("video"); return { polled: 3 }; },
    pollPendingProductImageJobs: async () => { calls.push("image"); throw new Error("image down"); },
    pollPendingStoryboardRuns: async () => { calls.push("storyboard"); return 2; },
    sweepStuckTasks: async () => { calls.push("sweep"); return { swept: 2 }; },
  });
  const response = await handler(new Request("http://localhost/api/cron/poll-videos"));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.sort(), ["image", "storyboard", "sweep", "video"]);
  const body = await response.json();
  assert.equal(body.polled, 3);
  assert.equal(body.imagePolled, 0);
  assert.equal(body.degraded, true);
  assert.match(body.imageError, /image down/);
  assert.equal(body.heartbeat.status, "degraded");
});

test("result-scoped handoff requires the result asset to belong to the authenticated owner", async (t) => {
  const model = db.productImageResult as unknown as Record<string, unknown>;
  const original = model.findFirst;
  let captured: Record<string, unknown> | undefined;
  model.findFirst = async (args: { where: Record<string, unknown> }) => {
    captured = args.where;
    return null;
  };
  t.after(() => { model.findFirst = original; });

  await findProductImageResultForUser("result-1", "owner-1");
  assert.deepEqual(captured, {
    id: "result-1",
    asset: { userId: "owner-1" },
    productImageJob: { userId: "owner-1", status: ProductImageStatus.SUCCEEDED },
  });
});
