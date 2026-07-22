import assert from "node:assert/strict";
import test from "node:test";
import { ProductImageStatus, ProviderSubmissionState } from "@prisma/client";

import {
  fetchShuyuOutputImage,
  pollShuyuImageTask,
  submitShuyuImageTask,
} from "../src/lib/providers/shuyu-image-provider";
import { db } from "../src/lib/db";
import {
  __test__ as productImageServiceTest,
  createProductImageJob,
  retryRejectedProductImageProviderTask,
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

test("one durable task per requested result fails closed on acknowledgement loss and is not resubmitted", async (t) => {
  const model = db.productImageJob as unknown as Record<string, unknown>;
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    findUnique: model.findUnique,
    create: model.create,
    updateMany: model.updateMany,
    update: model.update,
    findFirst: model.findFirst,
    taskFindUnique: taskModel.findUnique,
    taskUpdateMany: taskModel.updateMany,
    transaction: client.$transaction,
  };
  let row: Record<string, unknown> | null = null;
  const tasks: Array<Record<string, unknown>> = [];
  const fullRow = () => row ? {
    ...row,
    sourceAsset,
    outputs: [],
    providerTasks: tasks.map((task) => ({ ...task, result: null })),
  } : null;
  model.findUnique = async () => fullRow();
  model.create = async (args: { data: Record<string, unknown> }) => {
    const providerTasks = args.data.providerTasks as {
      create: Array<Record<string, unknown>>;
    };
    const { providerTasks: _nested, ...data } = args.data;
    row = {
      id: "job-1",
      status: "QUEUED",
      retryCount: 0,
      pollErrors: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    tasks.push(...providerTasks.create.map((task, ordinal) => ({
      id: `provider-task-${ordinal}`,
      productImageJobId: "job-1",
      status: ProductImageStatus.QUEUED,
      submissionState: ProviderSubmissionState.NOT_STARTED,
      submitAttempts: 0,
      pollErrors: 0,
      planId: null,
      modelSnapshot: null,
      pointsSnapshot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...task,
    })));
    return fullRow();
  };
  model.updateMany = async (args: { data: Record<string, unknown> }) => {
    if (!row) return { count: 0 };
    applyMockData(row, args.data);
    return { count: 1 };
  };
  model.update = async (args: { data: Record<string, unknown> }) => {
    if (!row) throw new Error("missing row");
    applyMockData(row, args.data);
    return fullRow();
  };
  model.findFirst = async () => fullRow();
  taskModel.findUnique = async (args: { where: { id: string } }) => {
    const task = tasks.find((candidate) => candidate.id === args.where.id);
    return task ? { ...task, result: null, productImageJob: fullRow() } : null;
  };
  taskModel.updateMany = async (args: {
    where: { id: string; submissionState?: unknown; requestKey?: string };
    data: Record<string, unknown>;
  }) => {
    const task = tasks.find((candidate) => candidate.id === args.where.id);
    if (!task || (args.where.requestKey && task.requestKey !== args.where.requestKey)) return { count: 0 };
    const expected = args.where.submissionState as { in?: string[] } | string | undefined;
    if (typeof expected === "string" && task.submissionState !== expected) return { count: 0 };
    if (expected && typeof expected === "object" && expected.in && !expected.in.includes(String(task.submissionState))) return { count: 0 };
    applyMockData(task, args.data);
    return { count: 1 };
  };
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(db);
  const sourceAsset = {
    id: "source-asset", userId: "user-1", workspaceId: null,
    storageKey: "uploads/source.png", url: "https://assets.example.test/source.png",
    mimeType: "image/png", byteSize: 68, sha256: "sha", width: 1, height: 1,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const submittedKeys: string[] = [];
  productImageServiceTest.__setRuntimeDependenciesForTests({
    submitTask: async (input) => {
      assert.equal(tasks.length, 4, "all task rows must exist before the first paid call");
      submittedKeys.push(input.requestKey);
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
    taskModel.findUnique = originals.taskFindUnique;
    taskModel.updateMany = originals.taskUpdateMany;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  const failed = await createProductImageJob({
    userId: "user-1",
    idempotencyKey: "idem-1",
    prompt: "Improve this real product photo",
    preset: "white_studio",
    aspectRatio: "1:1",
    resolution: "1K",
    resultCount: 4,
    sourceAsset,
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.provider, "shuyu");
  assert.equal(failed.planId, "image-plan-01");
  assert.equal(failed.modelSnapshot, "gpt-image-2");
  assert.equal(failed.pointsSnapshot, 96);
  assert.equal(failed.sourceAssetId, sourceAsset.id);
  assert.equal(failed.sourceAsset?.id, sourceAsset.id);
  assert.equal(tasks.length, 4);
  assert.equal(new Set(tasks.map((task) => task.requestKey)).size, 4);
  assert.deepEqual(submittedKeys, tasks.map((task) => task.requestKey));
  assert.ok(tasks.every((task) => task.submissionState === ProviderSubmissionState.ACK_UNKNOWN));

  await productImageServiceTest.submitProductImageProviderTask(String(tasks[0].id));
  assert.equal(submittedKeys.length, 4, "ACK_UNKNOWN must never be blindly resubmitted");
});

test("concurrent reconciliation can grant a provider-task lease to only one owner", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const originals = { updateMany: taskModel.updateMany, findFirst: taskModel.findFirst };
  const task: Record<string, unknown> = {
    id: "task-lease",
    status: ProductImageStatus.PROCESSING,
    submissionState: ProviderSubmissionState.ACCEPTED,
    externalTaskId: "external-1",
    leaseOwner: null,
    leaseExpiresAt: null,
    productImageJob: { id: "job-lease", userId: "user-1", sourceAsset: null, outputs: [] },
    result: null,
  };
  taskModel.updateMany = async (args: {
    where: {
      status: string;
      submissionState: string;
      externalTaskId: { not: null };
      OR: Array<{ leaseExpiresAt?: { lte: Date } }>;
    };
    data: Record<string, unknown>;
  }) => {
    assert.equal(args.where.status, ProductImageStatus.PROCESSING);
    assert.equal(args.where.submissionState, ProviderSubmissionState.ACCEPTED);
    assert.deepEqual(args.where.externalTaskId, { not: null });
    const cutoff = args.where.OR.find((condition) => condition.leaseExpiresAt)?.leaseExpiresAt?.lte;
    if (task.leaseOwner && task.leaseExpiresAt && cutoff && (task.leaseExpiresAt as Date) > cutoff) {
      return { count: 0 };
    }
    Object.assign(task, args.data);
    return { count: 1 };
  };
  taskModel.findFirst = async (args: { where: { leaseOwner: string; leaseExpiresAt: { gt: Date } } }) =>
    task.leaseOwner === args.where.leaseOwner &&
      (task.leaseExpiresAt as Date) > args.where.leaseExpiresAt.gt
      ? { ...task }
      : null;
  t.after(() => Object.assign(taskModel, originals));

  const now = new Date("2026-07-22T12:00:00.000Z");
  const [first, second] = await Promise.all([
    productImageServiceTest.claimProductImageProviderTask("task-lease", "owner-a", now),
    productImageServiceTest.claimProductImageProviderTask("task-lease", "owner-b", now),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(task.leaseOwner, "owner-a");

  const beforeExpiry = await productImageServiceTest.claimProductImageProviderTask(
    "task-lease",
    "owner-c",
    new Date("2026-07-22T12:01:00.000Z"),
  );
  assert.equal(beforeExpiry, null);
  const afterExpiry = await productImageServiceTest.claimProductImageProviderTask(
    "task-lease",
    "owner-d",
    new Date("2026-07-22T12:03:00.000Z"),
  );
  assert.equal(afterExpiry?.leaseOwner, "owner-d");
});

test("confirmed-no-job rejection can retry with the same stable request identity", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    taskFindUnique: taskModel.findUnique,
    taskUpdateMany: taskModel.updateMany,
    jobUpdate: jobModel.update,
    jobUpdateMany: jobModel.updateMany,
    transaction: client.$transaction,
  };
  const stableKey = "product-image-stable-result-2";
  const task: Record<string, unknown> = {
    id: "task-rejected",
    productImageJobId: "job-rejected",
    ordinal: 1,
    requestKey: stableKey,
    status: ProductImageStatus.FAILED,
    submissionState: ProviderSubmissionState.REJECTED,
    submitAttempts: 1,
    planId: "image-plan-01",
    modelSnapshot: "gpt-image-2",
    resolutionSnapshot: "1K",
    pointsSnapshot: 24,
    result: null,
  };
  const job = {
    id: "job-rejected", userId: "user-1", idempotencyKey: "idem-rejected",
    prompt: "Create a truthful product image", preset: "white_studio",
    aspectRatio: "1:1", quality: "1K", resolutionSnapshot: "1K",
    resultCount: 2, sourceAsset: null,
    sourceImageUrl: "https://immutable.example.test/original-source.png", outputs: [],
  };
  taskModel.findUnique = async () => ({ ...task, productImageJob: job });
  taskModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    applyMockData(task, args.data);
    return { count: 1 };
  };
  jobModel.update = async () => job;
  jobModel.updateMany = async () => ({ count: 1 });
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(db);
  const submittedKeys: string[] = [];
  productImageServiceTest.__setRuntimeDependenciesForTests({
    submitTask: async (input) => {
      submittedKeys.push(input.requestKey);
      assert.equal(input.planSnapshot?.planId, "image-plan-01");
      assert.deepEqual(input.inputImages, ["https://immutable.example.test/original-source.png"]);
      await input.onPlanSelected?.({
        planId: "image-plan-01", model: "gpt-image-2", resolution: "1K",
        points: 24, family: "gpt-image-2",
      });
      return { requestKey: input.requestKey, externalTaskId: "external-retry", planSnapshot: {} as never };
    },
  });
  t.after(() => {
    taskModel.findUnique = originals.taskFindUnique;
    taskModel.updateMany = originals.taskUpdateMany;
    jobModel.update = originals.jobUpdate;
    jobModel.updateMany = originals.jobUpdateMany;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  await productImageServiceTest.submitProductImageProviderTask("task-rejected", undefined, true);
  assert.deepEqual(submittedKeys, [stableKey]);
  assert.equal(task.requestKey, stableKey);
  assert.equal(task.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(task.externalTaskId, "external-retry");
});

test("public rejected-task retry atomically reactivates the job and claims the task before submission", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    taskFindFirst: taskModel.findFirst,
    taskFindUnique: taskModel.findUnique,
    taskUpdateMany: taskModel.updateMany,
    jobFindFirst: jobModel.findFirst,
    jobFindUnique: jobModel.findUnique,
    jobUpdateMany: jobModel.updateMany,
    jobUpdate: jobModel.update,
    transaction: client.$transaction,
  };
  const task: Record<string, unknown> = {
    id: "task-public-retry", productImageJobId: "job-public-retry", ordinal: 1,
    requestKey: "stable-public-key", status: ProductImageStatus.FAILED,
    submissionState: ProviderSubmissionState.REJECTED, submitAttempts: 1,
    planId: "image-plan-01", modelSnapshot: "gpt-image-2",
    resolutionSnapshot: "1K", pointsSnapshot: 24, pollErrors: 0, result: null,
  };
  const job: Record<string, unknown> = {
    id: "job-public-retry", userId: "owner-1", idempotencyKey: "idem-public",
    status: ProductImageStatus.FAILED, prompt: "Create a truthful product photo",
    preset: "white_studio", aspectRatio: "1:1", quality: "1K", resolutionSnapshot: "1K",
    resultCount: 2, sourceAsset: null, sourceImageUrl: null, outputs: [],
  };
  let transactionDepth = 0;
  const fullJob = () => ({ ...job, providerTasks: [{ ...task, result: null }], outputs: [] });
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionDepth += 1;
    try { return await callback(db); } finally { transactionDepth -= 1; }
  };
  taskModel.findFirst = async () => ({
    id: task.id, productImageJobId: task.productImageJobId, requestKey: task.requestKey,
  });
  taskModel.findUnique = async () => ({ ...task, productImageJob: fullJob() });
  taskModel.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (args.where.submissionState === ProviderSubmissionState.REJECTED) {
      assert.equal(transactionDepth, 1, "retry task CAS must share the aggregate transaction");
      if (task.submissionState !== ProviderSubmissionState.REJECTED) return { count: 0 };
    }
    applyMockData(task, args.data);
    return { count: 1 };
  };
  jobModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    if (args.data.status === ProductImageStatus.PROCESSING) {
      assert.equal(transactionDepth, 1, "aggregate reactivation must share the task-claim transaction");
    }
    applyMockData(job, args.data);
    return { count: 1 };
  };
  jobModel.update = async () => fullJob();
  jobModel.findUnique = async () => fullJob();
  jobModel.findFirst = async () => fullJob();
  productImageServiceTest.__setRuntimeDependenciesForTests({
    submitTask: async (input) => {
      assert.equal(transactionDepth, 0, "paid submission starts only after the atomic claim commits");
      assert.equal(job.status, ProductImageStatus.PROCESSING);
      assert.equal(task.submissionState, ProviderSubmissionState.SUBMITTING);
      return {
        requestKey: input.requestKey,
        externalTaskId: "external-public-retry",
        planSnapshot: {} as never,
      };
    },
  });
  t.after(() => {
    taskModel.findFirst = originals.taskFindFirst;
    taskModel.findUnique = originals.taskFindUnique;
    taskModel.updateMany = originals.taskUpdateMany;
    jobModel.findFirst = originals.jobFindFirst;
    jobModel.findUnique = originals.jobFindUnique;
    jobModel.updateMany = originals.jobUpdateMany;
    jobModel.update = originals.jobUpdate;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  const retried = await retryRejectedProductImageProviderTask("task-public-retry", "owner-1");
  assert.equal(retried?.id, "job-public-retry");
  assert.equal(task.requestKey, "stable-public-key");
  assert.equal(task.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(task.externalTaskId, "external-public-retry");
});

test("aggregate succeeds only after exactly all four durable task results exist", async (t) => {
  const jobModel = db.productImageJob as unknown as Record<string, unknown>;
  const originals = {
    jobFindUnique: jobModel.findUnique,
    jobUpdateMany: jobModel.updateMany,
  };
  const now = new Date();
  const row: Record<string, unknown> = {
    id: "job-success", userId: "user-1", status: "PROCESSING",
    resultCount: 4, pollErrors: 0,
    lastCheckedAt: now, outputs: [], sourceAsset: null,
    mode: "GENERATE", preset: "white_studio", aspectRatio: "1:1",
    model: "gpt-image-2", modelSnapshot: "gpt-image-2",
  };
  const tasks = Array.from({ length: 4 }, (_, ordinal) => ({
    id: `task-${ordinal}`,
    ordinal,
    status: ProductImageStatus.SUCCEEDED,
    submissionState: ProviderSubmissionState.ACCEPTED,
    result: null,
  }));
  const results: Array<Record<string, unknown>> = Array.from({ length: 3 }, (_, position) => ({
    id: `result-${position}`,
    assetId: `asset-${position}`,
    position,
    outputImageUrl: `https://assets.example.test/${position}.png`,
    asset: { id: `asset-${position}` },
  }));
  const fullRow = () => ({
    ...row,
    sourceAsset: null,
    outputs: results,
    providerTasks: tasks,
  });
  jobModel.findUnique = async () => fullRow();
  jobModel.updateMany = async (args: { data: Record<string, unknown> }) => {
    applyMockData(row, args.data);
    return { count: 1 };
  };
  t.after(() => {
    jobModel.findUnique = originals.jobFindUnique;
    jobModel.updateMany = originals.jobUpdateMany;
  });

  await productImageServiceTest.refreshProductImageJob("job-success");
  assert.equal(row.status, ProductImageStatus.PROCESSING);
  results.push({
    id: "result-3", assetId: "asset-3", position: 3,
    outputImageUrl: "https://assets.example.test/3.png", asset: { id: "asset-3" },
  });
  await productImageServiceTest.refreshProductImageJob("job-success");
  assert.equal(row.status, ProductImageStatus.SUCCEEDED);
  assert.equal(row.outputAssetId, "asset-0");
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
    productImageServiceTest.persistProviderTaskOutput({
      id: "task-cleanup",
      productImageJobId: "job-cleanup",
      ordinal: 0,
      productImageJob: { id: "job-cleanup", userId: "user-1" },
    } as never, "lease-owner", "https://cdn.shuyu.example/output.png"),
    /database unavailable/,
  );
  assert.deepEqual(deleted, ["renders/uncommitted.png"]);
});

test("expired owners cannot finalize and their unreferenced asset and object are removed", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const resultModel = db.productImageResult as unknown as Record<string, unknown>;
  const assetModel = db.mediaAsset as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    taskUpdateMany: taskModel.updateMany,
    resultCreate: resultModel.create,
    assetDeleteMany: assetModel.deleteMany,
    transaction: client.$transaction,
  };
  let resultCreates = 0;
  const deleted: string[] = [];
  taskModel.updateMany = async (args: {
    where: { leaseOwner: string; leaseExpiresAt: { gt: Date } };
  }) => {
    assert.equal(args.where.leaseOwner, "stale-owner");
    assert.ok(args.where.leaseExpiresAt.gt instanceof Date);
    return { count: 0 };
  };
  resultModel.create = async () => { resultCreates += 1; };
  assetModel.deleteMany = async () => ({ count: 1 });
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(db);
  productImageServiceTest.__setRuntimeDependenciesForTests({
    fetchOutputImage: async () => ({ bytes: Buffer.from("png"), mimeType: "image/png" }),
    getStorageProvider: () => ({
      id: "vercel_blob", displayName: "test", isConfigured: () => true,
      uploadFile: async () => { throw new Error("unused"); },
      uploadBuffer: async () => ({
        key: "renders/stale-owner.png",
        url: "https://assets.example.test/stale-owner.png",
        absolute: true,
      }),
      getSignedUploadUrl: async () => null, getSignedDownloadUrl: async () => "", getPublicUrl: () => "",
      deleteObject: async (_bucket, key) => { deleted.push(key); },
    }),
    createOwnedAsset: async () => ({ id: "loser-asset", url: "https://assets.example.test/stale-owner.png" }) as never,
  });
  t.after(() => {
    taskModel.updateMany = originals.taskUpdateMany;
    resultModel.create = originals.resultCreate;
    assetModel.deleteMany = originals.assetDeleteMany;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  await assert.rejects(
    productImageServiceTest.persistProviderTaskOutput({
      id: "task-stale", productImageJobId: "job-stale", ordinal: 0,
      productImageJob: { id: "job-stale", userId: "owner-1" },
    } as never, "stale-owner", "https://cdn.shuyu.example/output.png"),
    /lease was lost/,
  );
  assert.equal(resultCreates, 0, "stale owner must not insert a duplicate result");
  assert.deepEqual(deleted, ["renders/stale-owner.png"]);
});

test("unique-result loser cleans up its newly copied asset and object", async (t) => {
  const taskModel = db.productImageProviderTask as unknown as Record<string, unknown>;
  const resultModel = db.productImageResult as unknown as Record<string, unknown>;
  const assetModel = db.mediaAsset as unknown as Record<string, unknown>;
  const client = db as unknown as Record<string, unknown>;
  const originals = {
    taskUpdateMany: taskModel.updateMany,
    resultCreate: resultModel.create,
    assetDeleteMany: assetModel.deleteMany,
    transaction: client.$transaction,
  };
  const deleted: string[] = [];
  taskModel.updateMany = async () => ({ count: 1 });
  resultModel.create = async () => { throw new Error("unique providerTaskId conflict"); };
  assetModel.deleteMany = async () => ({ count: 1 });
  client.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(db);
  productImageServiceTest.__setRuntimeDependenciesForTests({
    fetchOutputImage: async () => ({ bytes: Buffer.from("png"), mimeType: "image/png" }),
    getStorageProvider: () => ({
      id: "vercel_blob", displayName: "test", isConfigured: () => true,
      uploadFile: async () => { throw new Error("unused"); },
      uploadBuffer: async () => ({
        key: "renders/duplicate-loser.png",
        url: "https://assets.example.test/duplicate-loser.png",
        absolute: true,
      }),
      getSignedUploadUrl: async () => null, getSignedDownloadUrl: async () => "", getPublicUrl: () => "",
      deleteObject: async (_bucket, key) => { deleted.push(key); },
    }),
    createOwnedAsset: async () => ({ id: "duplicate-asset", url: "https://assets.example.test/duplicate-loser.png" }) as never,
  });
  t.after(() => {
    taskModel.updateMany = originals.taskUpdateMany;
    resultModel.create = originals.resultCreate;
    assetModel.deleteMany = originals.assetDeleteMany;
    client.$transaction = originals.transaction;
    productImageServiceTest.__setRuntimeDependenciesForTests(null);
  });

  await assert.rejects(
    productImageServiceTest.persistProviderTaskOutput({
      id: "task-duplicate", productImageJobId: "job-duplicate", ordinal: 0,
      productImageJob: { id: "job-duplicate", userId: "owner-1" },
    } as never, "lease-owner", "https://cdn.shuyu.example/output.png"),
    /unique providerTaskId conflict/,
  );
  assert.deepEqual(deleted, ["renders/duplicate-loser.png"]);
});

function applyMockData(target: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) {
      target[key] = Number(target[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      target[key] = value;
    }
  }
}
