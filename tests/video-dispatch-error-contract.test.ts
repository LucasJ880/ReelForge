import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  customerVideoDispatchSuccessSchema,
  toCustomerVideoDispatchError,
  toCustomerVideoDispatchResponse,
  type CustomerVideoDispatchErrorInput,
} from "../src/lib/api/customer-video-dispatch";
import {
  dispatchRecoveryHint,
  shouldResetDispatchAttempt,
} from "../src/lib/api/customer-video-dispatch-recovery";
import {
  customerRecoveryActions,
} from "../src/lib/contracts/customer-api";
import { videoDispatchErrorSchema } from "../src/lib/contracts/video-dispatch-error";

const dispatchFailures: CustomerVideoDispatchErrorInput[] = [
  {
    code: "AUTH_REQUIRED",
    message: "请先登录。",
    retryable: false,
    action: "sign_in",
  },
  {
    code: "FORBIDDEN",
    message: "当前账号无权提交。",
    retryable: false,
    action: "contact_support",
  },
  {
    code: "VALIDATION_FAILED",
    message: "请修改提交内容。",
    retryable: false,
    action: "fix_request",
  },
  {
    code: "IDEMPOTENCY_KEY_REQUIRED",
    message: "提交标识缺失。",
    retryable: false,
    action: "fix_request",
  },
  {
    code: "IDEMPOTENCY_CONFLICT",
    message: "提交标识冲突。",
    retryable: false,
    action: "fix_request",
  },
  {
    code: "REQUEST_IN_PROGRESS",
    message: "请求正在处理中。",
    retryable: false,
    action: "refresh_status",
  },
  {
    code: "QUALITY_BLOCKED",
    message: "请补充生成要求。",
    retryable: false,
    action: "fix_request",
    blockers: ["请明确产品使用场景。"],
  },
  {
    code: "SERVICE_UNAVAILABLE",
    message: "生成服务拥堵。",
    retryable: true,
    action: "wait",
  },
  {
    code: "RATE_LIMITED",
    message: "操作过于频繁。",
    retryable: true,
    action: "retry",
  },
  {
    code: "QUOTA_EXCEEDED",
    message: "额度已用尽。",
    retryable: false,
    action: "view_usage",
    resource: "VIDEO_GENERATION",
    used: 60,
    limit: 60,
    periodKey: "2026-07",
  },
  {
    code: "QUOTA_CHECK_UNAVAILABLE",
    message: "暂时无法确认额度。",
    retryable: true,
    action: "retry",
  },
  {
    code: "PROVIDER_ERROR",
    message: "暂时无法开始生成。",
    retryable: true,
    action: "retry",
  },
  {
    code: "SUBMISSION_ACK_UNKNOWN",
    message: "接收状态尚未确认。",
    retryable: false,
    action: "contact_support",
  },
  {
    code: "INTERNAL_ERROR",
    message: "暂时无法登记请求。",
    retryable: true,
    action: "retry",
  },
  {
    code: "INTERNAL_ERROR",
    message: "额度状态尚未确认。",
    retryable: false,
    action: "contact_support",
  },
];

function completeDispatchSuccess() {
  return {
    ok: true,
    deliveryOrderId: "order-contract-1",
    briefId: "brief-contract-1",
    videoJobs: [
      {
        id: "job-contract-1",
        status: "RUNNING",
        segmentIndex: 0,
        segmentDurationSec: 15,
        outputVideoUrl: "https://assets.example.com/video.mp4",
        outputThumbUrl: "https://assets.example.com/thumb.jpg",
        lastProgress: 20,
        retryCount: 0,
        createdAt: new Date("2026-07-14T12:00:00.000Z"),
        submittedAt: new Date("2026-07-14T12:00:01.000Z"),
        startedAt: new Date("2026-07-14T12:00:02.000Z"),
        finishedAt: null,
        userSafeError: null,
        provider: "MUST_NOT_LEAK_PROVIDER",
        externalJobId: "MUST_NOT_LEAK_PROVIDER_JOB_ID",
        providerRequestKey: "MUST_NOT_LEAK_PROVIDER_REQUEST_KEY",
        promptText: "MUST_NOT_LEAK_PROMPT",
      },
    ],
    batch: [
      {
        briefId: "brief-contract-1",
        deliveryOrderId: "order-contract-1",
        internalAttempt: "MUST_NOT_LEAK_BATCH_METADATA",
      },
    ],
    planPreview: {
      summary: "1 AI clip, 15 second vertical video",
      breakdown: {
        aiClipCount: 1,
        uploadedClipCount: 0,
        hasBrandEndCard: false,
        finalDurationSec: 15,
        aspectRatio: "9:16",
      },
    },
    nextUrl: "/app/library?highlight=order-contract-1",
    userStatus: {
      status: "generating",
      label: "AI 正在生成画面",
      shortLabel: "生成中",
      progressHint: 0.2,
      cta: null,
      assemblingPhase: null,
    },
    provider: "MUST_NOT_LEAK_TOP_LEVEL_PROVIDER",
  };
}

test("H1 dispatch success contract: complete DTO is strict and provider-safe", () => {
  const payload = toCustomerVideoDispatchResponse(completeDispatchSuccess());
  assert.deepEqual(customerVideoDispatchSuccessSchema.parse(payload), payload);
  assert.equal(payload.ok, true);
  assert.doesNotMatch(JSON.stringify(payload), /MUST_NOT_LEAK/);
});

test("H1 dispatch success contract: truncated or unsafe success replays fail closed", () => {
  for (const body of [
    { ok: true },
    { ...completeDispatchSuccess(), videoJobs: [] },
    { ...completeDispatchSuccess(), batch: [] },
  ]) {
    assert.deepEqual(toCustomerVideoDispatchResponse(body), {
      ok: false,
      code: "SUBMISSION_ACK_UNKNOWN",
      error:
        "生成结果记录不完整。为避免重复计费，系统已停止重试，请联系支持核对。",
      retryable: false,
      action: "contact_support",
    });
  }
});

test("H1 dispatch success contract: non-http job asset URLs are scrubbed", () => {
  const fixture = completeDispatchSuccess();
  fixture.videoJobs[0].outputVideoUrl =
    "file:///private/provider-output.mp4";
  fixture.videoJobs[0].outputThumbUrl =
    "data:image/png;base64,PRIVATE_PROVIDER_FRAME";

  const payload = toCustomerVideoDispatchResponse(fixture);
  assert.equal(payload.ok, true);
  if (!payload.ok) return;
  assert.equal(payload.videoJobs[0].outputVideoUrl, null);
  assert.equal(payload.videoJobs[0].outputThumbUrl, null);
  assert.doesNotMatch(JSON.stringify(payload), /private\/provider|PRIVATE_PROVIDER/);
});

test("H1 dispatch contract: every route failure uses the shared closed envelope", () => {
  for (const input of dispatchFailures) {
    const payload = toCustomerVideoDispatchError(input);
    assert.deepEqual(videoDispatchErrorSchema.parse(payload), payload);
    assert.equal(payload.code, input.code);
    assert.equal(payload.retryable, input.retryable);
    assert.equal(payload.action, input.action);
    for (const forbiddenKey of ["debugMessage", "debugIssues", "issues", "stack"]) {
      assert.equal(forbiddenKey in payload, false);
    }
  }
});

test("H1 dispatch contract: persisted legacy failures normalize before replay", () => {
  assert.deepEqual(
    toCustomerVideoDispatchResponse({
      ok: false,
      code: "IDEMPOTENCY_KEY_CONFLICT",
      error: "legacy conflict",
      retryable: false,
    }),
    {
      ok: false,
      code: "IDEMPOTENCY_CONFLICT",
      error: "legacy conflict",
      retryable: false,
      action: "fix_request",
    },
  );
  assert.deepEqual(
    toCustomerVideoDispatchResponse({
      ok: false,
      code: "PROVIDER_UNAVAILABLE",
      error: "legacy provider failure",
      retryable: true,
    }),
    {
      ok: false,
      code: "SUBMISSION_ACK_UNKNOWN",
      error: "legacy provider failure",
      retryable: false,
      action: "contact_support",
    },
  );
  assert.deepEqual(
    toCustomerVideoDispatchResponse({
      ok: false,
      code: "DISPATCH_FAILED",
      error: "legacy unknown failure",
      retryable: true,
      action: "retry",
      debugMessage: "private stack",
    }),
    {
      ok: false,
      code: "SUBMISSION_ACK_UNKNOWN",
      error: "legacy unknown failure",
      retryable: false,
      action: "contact_support",
    },
  );
  assert.deepEqual(
    toCustomerVideoDispatchResponse({
      ok: false,
      code: "SUBMISSION_ACK_UNKNOWN",
      error: "legacy acknowledgement ambiguity",
      retryable: true,
      action: "view_usage",
    }),
    {
      ok: false,
      code: "SUBMISSION_ACK_UNKNOWN",
      error: "legacy acknowledgement ambiguity",
      retryable: false,
      action: "contact_support",
    },
  );
  assert.deepEqual(
    toCustomerVideoDispatchResponse({
      ok: false,
      code: "UNRECOGNIZED_LEGACY_FAILURE",
      error: "legacy code without submission evidence",
      retryable: true,
      action: "retry",
    }),
    {
      ok: false,
      code: "SUBMISSION_ACK_UNKNOWN",
      error: "legacy code without submission evidence",
      retryable: false,
      action: "contact_support",
    },
  );
});

test("H1 dispatch contract: frontend recovery never resets an ambiguous attempt", () => {
  const safeRetry = toCustomerVideoDispatchError({
    code: "PROVIDER_ERROR",
    message: "已确认提交失败。",
    retryable: true,
    action: "retry",
  });
  const wait = toCustomerVideoDispatchError({
    code: "SERVICE_UNAVAILABLE",
    message: "服务拥堵。",
    retryable: true,
    action: "wait",
  });
  const ambiguous = toCustomerVideoDispatchError({
    code: "SUBMISSION_ACK_UNKNOWN",
    message: "接收状态未知。",
    retryable: false,
    action: "contact_support",
  });

  assert.equal(shouldResetDispatchAttempt(safeRetry), true);
  assert.equal(shouldResetDispatchAttempt(wait), false);
  assert.equal(shouldResetDispatchAttempt(ambiguous), false);
});

test("H1 dispatch contract: every server recovery action has executable bilingual guidance", () => {
  for (const action of customerRecoveryActions) {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const hint = dispatchRecoveryHint(action, locale);
      assert.ok(hint.length >= 10, `${action}/${locale} must explain recovery`);
    }
  }
});

test("H1 dispatch wiring: route and direct consumers cannot drift to legacy retry semantics", async () => {
  const [route, unified, editorial] = await Promise.all([
    readFile("src/app/api/video-generation/dispatch/route.ts", "utf8"),
    readFile(
      "src/components/video-generation/unified-creative-input.tsx",
      "utf8",
    ),
    readFile("src/components/personal/glass-create-workflow.tsx", "utf8"),
  ]);

  assert.doesNotMatch(
    route,
    /code:\s*"(?:IDEMPOTENCY_KEY_CONFLICT|PROVIDER_UNAVAILABLE|DISPATCH_FAILED)"/,
  );
  assert.doesNotMatch(route, /debugMessage|debugIssues/);
  assert.match(route, /toCustomerVideoDispatchError/);
  assert.match(route, /code:\s*"SUBMISSION_ACK_UNKNOWN"/);
  assert.match(route, /retryable:\s*false,[\s\S]{0,80}action:\s*"contact_support"/);
  assert.match(
    route,
    /code:\s*"PROVIDER_ERROR",[\s\S]{0,240}retryable:\s*false,[\s\S]{0,80}action:\s*"contact_support"/,
    "post-quota provider failures must not advertise a new paid attempt",
  );

  for (const consumer of [unified, editorial]) {
    assert.match(consumer, /CustomerVideoDispatchResponse/);
    assert.match(consumer, /shouldResetDispatchAttempt\(j\)/);
    assert.match(consumer, /dispatchRecoveryHint\(/);
    assert.doesNotMatch(
      consumer,
      /j\.retryable\s*===\s*true[\s\S]{0,80}dispatchAttemptRef\.current\s*=\s*null/,
    );
  }
});
