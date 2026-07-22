import assert from "node:assert/strict";
import test from "node:test";
import {
  BatchJobStatus,
  FinalVideoStatus,
  ProviderSubmissionState,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import {
  classifyCustomerGenerationError,
  customerApiError,
} from "../src/lib/api/customer-generation-error";
import {
  toCustomerBriefRenderSummary,
  type BriefRenderSummary,
} from "../src/lib/services/video-service";
import { toCustomerBatchStatus } from "../src/lib/services/batch-service";
import { quotaErrorResponse } from "../src/lib/api-quota";
import {
  toCustomerVideoDispatchJob,
  toCustomerVideoDispatchResponse,
} from "../src/lib/api/customer-video-dispatch";
import { QuotaExceededError } from "../src/lib/services/quota-service";

test("Phase 2 contract: four customer generation failures have stable codes and recovery actions", () => {
  const timeout = classifyCustomerGenerationError({
    status: "FAILED",
    errorMessage: "watchdog:timeout provider stalled",
  });
  assert.deepEqual(timeout, {
    code: "PROVIDER_TIMEOUT",
    message: "生成等待超时，请稍后重试。",
    retryable: true,
    action: "retry",
  });

  const provider = classifyCustomerGenerationError({
    status: "FAILED",
    errorMessage: "vendor 502 upstream exploded with secret trace",
  });
  assert.deepEqual(provider, {
    code: "PROVIDER_ERROR",
    message: "视频生成失败，请稍后重试。",
    retryable: true,
    action: "retry",
  });

  const asset = classifyCustomerGenerationError({
    status: "FAILED",
    errorMessage: "reference image asset missing at private-origin/path",
  });
  assert.deepEqual(asset, {
    code: "ASSET_MISSING",
    message: "原始素材已失效或无法读取，请替换素材后重新提交。",
    retryable: false,
    action: "replace_asset",
  });

  assert.deepEqual(
    customerApiError({
      code: "QUOTA_EXCEEDED",
      message: "本月视频生成次数已用完。",
      retryable: false,
      action: "view_usage",
    }),
    {
      ok: false,
      code: "QUOTA_EXCEEDED",
      error: "本月视频生成次数已用完。",
      retryable: false,
      action: "view_usage",
    },
  );
});

test("Phase 2 contract: ambiguous acknowledgement is never exposed as retryable", () => {
  assert.deepEqual(
    classifyCustomerGenerationError({
      status: "FAILED",
      submissionState: ProviderSubmissionState.ACK_UNKNOWN,
      errorMessage: "socket closed after upstream accepted provider-job-secret",
    }),
    {
      code: "SUBMISSION_ACK_UNKNOWN",
      message:
        "生成服务可能已接收任务。系统已停止重复提交以避免重复计费，请联系支持核对。",
      retryable: false,
      action: "contact_support",
    },
  );
});

test("RF-018 contract: billing-unsafe timeout never advertises a dead retry action", () => {
  assert.deepEqual(
    classifyCustomerGenerationError({
      status: "FAILED",
      submissionState: ProviderSubmissionState.ACCEPTED,
      errorMessage: "[watchdog:provider_stalled] upstream still running",
      billingSafeToRetry: false,
    }),
    {
      code: "PROVIDER_TIMEOUT",
      message:
        "生成状态尚未确认。为避免重复计费，系统已暂停重试，请联系支持核对。",
      retryable: false,
      action: "contact_support",
    },
  );
});

test("Phase 2 contract: quota exhaustion is fail-closed with a customer recovery action", async () => {
  const response = quotaErrorResponse(
    new QuotaExceededError({
      resource: "SEEDANCE_SEGMENT",
      used: 60,
      limit: 60,
      periodKey: "2026-07",
    }),
  );
  assert.ok(response);
  assert.equal(response.status, 429);
  const json = await response.json();
  assert.deepEqual(json, {
    ok: false,
    code: "QUOTA_EXCEEDED",
    error: "本月 AI 画面生成额度已用完，请下月再试或联系客服。",
    resource: "VIDEO_GENERATION",
    used: 60,
    limit: 60,
    periodKey: "2026-07",
    retryable: false,
    action: "view_usage",
  });
  assert.doesNotMatch(JSON.stringify(json), /SEEDANCE/);
});

test("Phase 2 contract: customer brief serializer strips every provider and ffmpeg diagnostic", () => {
  const summary: BriefRenderSummary = {
    briefId: "brief-1",
    briefStatus: VideoBriefStatus.RENDER_FAILED,
    totalJobs: 1,
    succeeded: 0,
    running: 0,
    queued: 0,
    failed: 1,
    cancelled: 0,
    finalVideoUrl: null,
    finalThumbnailUrl: null,
    hasStuckJob: false,
    lastCheckedAt: new Date(),
    finalVideo: {
      id: "final-1",
      status: FinalVideoStatus.FAILED,
      targetDurationSec: 15,
      segmentCount: 1,
      segmentsCompleted: 0,
      stitchedVideoUrl: null,
      thumbnailUrl: null,
      ffmpegError: "ffmpeg /tmp/customer/path secret stack",
    },
    jobs: [
      {
        id: "job-1",
        sceneIndex: null,
        segmentIndex: 0,
        segmentDurationSec: 15,
        status: VideoJobStatus.FAILED,
        userStatusKey: "failed",
        outputVideoUrl: null,
        outputThumbnailUrl: null,
        submittedAt: new Date(),
        lastCheckedAt: new Date(),
        finishedAt: new Date(),
        userSafeError: "生成失败，请重试。",
        error: {
          code: "PROVIDER_ERROR",
          message: "生成失败，请重试。",
          retryable: true,
          action: "retry",
        },
        isStuck: false,
        debug: {
          provider: VideoProvider.SEEDANCE_T2V,
          externalJobId: "provider-secret-id",
          lastProviderStatus: "internal_failed_reason",
          adminError: "raw secret stack",
        },
      },
    ],
  };

  const json = JSON.stringify(toCustomerBriefRenderSummary(summary));
  for (const forbidden of [
    "provider-secret-id",
    "internal_failed_reason",
    "raw secret stack",
    "ffmpeg /tmp/customer/path",
    "SEEDANCE_T2V",
  ]) {
    assert.doesNotMatch(json, new RegExp(forbidden));
  }
  assert.match(json, /PROVIDER_ERROR/);
  assert.match(json, /生成失败，请重试/);
});

test("Phase 2 contract: customer batch serializer strips raw submission diagnostics", () => {
  const batchSensitive = {
    userId: "LEAK_BATCH_USER",
    imageIds: ["LEAK_BATCH_IMAGE_ID"],
    imageUrls: ["https://LEAK_BATCH_IMAGE_URL.invalid"],
    idempotencyKey: "LEAK_BATCH_IDEMPOTENCY",
    requestHash: "LEAK_BATCH_HASH",
    quotaConsumedAt: new Date(),
    breakerPausedAt: new Date(),
    dispatchQuarantineDecision: "LEAK_BATCH_QUARANTINE_DECISION",
    dispatchQuarantineAt: new Date(),
    dispatchQuarantineBy: "LEAK_BATCH_QUARANTINE_ACTOR",
    secretRelation: "LEAK_BATCH_RELATION",
  };
  const jobSensitive = {
    videoBriefId: "LEAK_JOB_BRIEF",
    batchJobId: "LEAK_JOB_BATCH",
    batchItemKey: "LEAK_JOB_ITEM_KEY",
    templateSnapshot: { secret: "LEAK_JOB_TEMPLATE_SNAPSHOT" },
    promptText: "LEAK_JOB_PROMPT",
    negativePrompt: "LEAK_JOB_NEGATIVE_PROMPT",
    seed: 8675309,
    submitAttempts: 99,
    logicalJobKey: "LEAK_JOB_LOGICAL_KEY",
    providerRequestKey: "LEAK_JOB_PROVIDER_REQUEST_KEY",
    providerUnitPriceUsd: "LEAK_JOB_PRICE",
    availableAt: "LEAK_JOB_AVAILABLE_AT",
    leaseOwner: "LEAK_JOB_LEASE_OWNER",
    leaseExpiresAt: "LEAK_JOB_LEASE_EXPIRES",
    heartbeatAt: "LEAK_JOB_HEARTBEAT",
    provider: "LEAK_JOB_PROVIDER",
    externalJobId: "LEAK_JOB_EXTERNAL_ID",
    dispatchQuarantineDecision: "LEAK_JOB_QUARANTINE_DECISION",
    dispatchQuarantineAt: "LEAK_JOB_QUARANTINE_AT",
    dispatchQuarantineBy: "LEAK_JOB_QUARANTINE_BY",
    lastCheckedAt: "LEAK_JOB_LAST_CHECKED",
    lastProviderStatus: "LEAK_JOB_PROVIDER_STATUS",
    timeoutAt: "LEAK_JOB_TIMEOUT",
    pollErrors: 99,
    finalVideoId: "LEAK_JOB_FINAL_VIDEO",
    updatedAt: "LEAK_JOB_UPDATED_AT",
    secretRelation: "LEAK_JOB_RELATION",
  };
  const rawBatch = {
    id: "batch-1",
    templateId: "template-1",
    templateVersion: 1,
    productName: null,
    requestedCount: 1,
    status: BatchJobStatus.FAILED,
    queuedCount: 0,
    pausedCount: 0,
    runningCount: 0,
    completedCount: 0,
    failedCount: 1,
    cancelledCount: 0,
    statusReason: "provider breaker internal diagnostic secret",
    ...batchSensitive,
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: null,
    template: {
      id: "template-1",
      version: 1,
      name: "Template",
      nameZh: "模板",
      category: "UGC",
      coverImage: null,
    },
    videoJobs: [
      {
        id: "job-1",
        batchIndex: 0,
        status: VideoJobStatus.FAILED,
        assignedAssets: [],
        outputVideoUrl: null,
        outputThumbUrl: null,
        lastProgress: null,
        errorMessage: "private upstream host and token",
        userSafeError: "视频生成失败，请稍后重试。",
        submissionState: ProviderSubmissionState.ACK_UNKNOWN,
        submissionErrorClass: "status_lookup_ack_unknown secret",
        ...jobSensitive,
        retryCount: 0,
        storyboardRun: {
          id: "storyboard-1",
          status: "APPROVED",
          approvalPolicy: "AUTO",
          userId: "LEAK_STORYBOARD_USER",
          dispatchReservationKey: "LEAK_STORYBOARD_RESERVATION",
          frames: [
            {
              id: "frame-1",
              ordinal: 0,
              status: "SUCCEEDED",
              outputUrl: "https://cdn.example.com/frame-1.png",
              outputAsset: null,
              prompt: "LEAK_FRAME_PROMPT",
              providerRequestKey: "LEAK_FRAME_REQUEST_KEY",
              externalTaskId: "LEAK_FRAME_EXTERNAL_TASK",
            },
          ],
        },
        createdAt: new Date(),
        submittedAt: new Date(),
        finishedAt: new Date(),
      },
    ],
  };

  const customer = toCustomerBatchStatus(
    rawBatch as unknown as Parameters<typeof toCustomerBatchStatus>[0],
  );
  const json = JSON.stringify(customer);
  assert.doesNotMatch(json, /private upstream|token|status_lookup|breaker internal/);
  for (const value of [
    ...Object.values(batchSensitive),
    ...Object.values(jobSensitive),
  ]) {
    if (typeof value === "string" && value.startsWith("LEAK_")) {
      assert.doesNotMatch(json, new RegExp(value));
    }
  }
  assert.deepEqual(Object.keys(customer).sort(), [
    "cancelledCount",
    "completedCount",
    "createdAt",
    "failedCount",
    "finishedAt",
    "id",
    "pausedCount",
    "productName",
    "queuedCount",
    "requestedCount",
    "runningCount",
    "status",
    "statusReason",
    "template",
    "templateId",
    "templateVersion",
    "updatedAt",
    "videoJobs",
  ]);
  assert.deepEqual(Object.keys(customer.videoJobs[0]).sort(), [
    "assignedAssets",
    "batchIndex",
    "createdAt",
    "error",
    "finishedAt",
    "id",
    "lastProgress",
    "outputThumbUrl",
    "outputVideoUrl",
    "retryCount",
    "status",
    "storyboard",
    "submittedAt",
    "userSafeError",
  ]);
  assert.deepEqual(Object.keys(customer.videoJobs[0].storyboard!).sort(), [
    "approvalPolicy",
    "frames",
    "id",
    "status",
  ]);
  assert.deepEqual(
    Object.keys(customer.videoJobs[0].storyboard!.frames[0]).sort(),
    ["id", "imageUrl", "ordinal", "status"],
  );
  assert.match(json, /SUBMISSION_ACK_UNKNOWN/);
  assert.match(json, /contact_support/);
});

test("Phase 2 contract: initial and replay dispatch DTOs exhaustively allowlist VideoJob fields", () => {
  const rawJob = {
    id: "job-safe-id",
    status: VideoJobStatus.FAILED,
    segmentIndex: 0,
    segmentDurationSec: 15,
    outputVideoUrl: null,
    outputThumbUrl: null,
    lastProgress: 4,
    retryCount: 1,
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    submittedAt: new Date("2026-07-14T00:01:00.000Z"),
    startedAt: new Date("2026-07-14T00:02:00.000Z"),
    finishedAt: new Date("2026-07-14T00:03:00.000Z"),
    userSafeError: "生成失败，请重试。",
    submissionState: ProviderSubmissionState.ACK_UNKNOWN,
    submissionErrorClass: "LEAK_DISPATCH_SUBMISSION_CLASS",
    errorMessage: "LEAK_DISPATCH_RAW_ERROR",
    videoBriefId: "LEAK_DISPATCH_BRIEF_FK",
    batchJobId: "LEAK_DISPATCH_BATCH_FK",
    batchIndex: 8,
    batchItemKey: "LEAK_DISPATCH_ITEM_KEY",
    assignedAssets: { secret: "LEAK_DISPATCH_ASSIGNED_ASSETS" },
    templateSnapshot: { secret: "LEAK_DISPATCH_TEMPLATE" },
    promptText: "LEAK_DISPATCH_PROMPT",
    negativePrompt: "LEAK_DISPATCH_NEGATIVE_PROMPT",
    seed: 1234,
    submitAttempts: 4,
    logicalJobKey: "LEAK_DISPATCH_LOGICAL_KEY",
    providerRequestKey: "LEAK_DISPATCH_PROVIDER_KEY",
    providerUnitPriceUsd: "LEAK_DISPATCH_PRICE",
    availableAt: "LEAK_DISPATCH_AVAILABLE",
    leaseOwner: "LEAK_DISPATCH_LEASE_OWNER",
    leaseExpiresAt: "LEAK_DISPATCH_LEASE_EXPIRES",
    heartbeatAt: "LEAK_DISPATCH_HEARTBEAT",
    provider: "LEAK_DISPATCH_PROVIDER",
    externalJobId: "LEAK_DISPATCH_EXTERNAL_ID",
    dispatchQuarantineDecision: "LEAK_DISPATCH_QUARANTINE",
    dispatchQuarantineAt: "LEAK_DISPATCH_QUARANTINE_AT",
    dispatchQuarantineBy: "LEAK_DISPATCH_QUARANTINE_BY",
    lastCheckedAt: "LEAK_DISPATCH_LAST_CHECKED",
    lastProviderStatus: "LEAK_DISPATCH_PROVIDER_STATUS",
    timeoutAt: "LEAK_DISPATCH_TIMEOUT",
    pollErrors: 4,
    finalVideoId: "LEAK_DISPATCH_FINAL_VIDEO",
    updatedAt: "LEAK_DISPATCH_UPDATED_AT",
  };
  const raw = {
    ok: true,
    deliveryOrderId: "order-safe",
    briefId: "brief-safe",
    videoJobs: [rawJob],
    batch: [
      {
        briefId: "brief-safe",
        deliveryOrderId: "order-safe",
        secret: "LEAK_DISPATCH_BATCH_ENTRY",
      },
    ],
    planPreview: {
      summary: "safe summary",
      breakdown: {
        aiClipCount: 1,
        uploadedClipCount: 0,
        hasBrandEndCard: true,
        finalDurationSec: 15,
        aspectRatio: "9:16",
        secret: "LEAK_DISPATCH_PLAN_BREAKDOWN",
      },
      secret: "LEAK_DISPATCH_PLAN",
    },
    nextUrl: "/app/library?highlight=order-safe",
    userStatus: {
      status: "generating",
      label: "AI 正在生成画面",
      shortLabel: "生成中",
      progressHint: 0.2,
      cta: null,
      assemblingPhase: null,
      secret: "LEAK_DISPATCH_USER_STATUS",
    },
    secret: "LEAK_DISPATCH_TOP_LEVEL",
  };

  const safeJob = toCustomerVideoDispatchJob(rawJob);
  assert.deepEqual(Object.keys(safeJob).sort(), [
    "createdAt",
    "error",
    "finishedAt",
    "id",
    "lastProgress",
    "outputThumbUrl",
    "outputVideoUrl",
    "retryCount",
    "segmentDurationSec",
    "segmentIndex",
    "startedAt",
    "status",
    "submittedAt",
    "userSafeError",
  ]);

  const initial = toCustomerVideoDispatchResponse(raw);
  const replay = toCustomerVideoDispatchResponse(raw);
  assert.deepEqual(replay, initial);
  const json = JSON.stringify(initial);
  for (const value of Object.values(rawJob)) {
    if (typeof value === "string" && value.startsWith("LEAK_")) {
      assert.doesNotMatch(json, new RegExp(value));
    }
  }
  for (const canary of [
    "LEAK_DISPATCH_BATCH_ENTRY",
    "LEAK_DISPATCH_PLAN_BREAKDOWN",
    "LEAK_DISPATCH_PLAN",
    "LEAK_DISPATCH_USER_STATUS",
    "LEAK_DISPATCH_TOP_LEVEL",
    "LEAK_DISPATCH_ASSIGNED_ASSETS",
    "LEAK_DISPATCH_TEMPLATE",
  ]) {
    assert.doesNotMatch(json, new RegExp(canary));
  }
  assert.match(json, /SUBMISSION_ACK_UNKNOWN/);
  assert.match(json, /contact_support/);
});
