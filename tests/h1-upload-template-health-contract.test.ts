import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  batchStyleTemplateDto,
  batchStyleTemplatesResponseSchema,
  batchStyleTemplatesSuccessSchema,
} from "../src/lib/contracts/batch-style-templates";
import {
  customerApiError,
  customerApiErrorSchema,
} from "../src/lib/contracts/customer-api";
import {
  healthHttpStatus,
  healthResponseSchema,
  unavailableHealthResponse,
} from "../src/lib/contracts/health";
import {
  uploadBlobResponseSchema,
  uploadBlobQuotaErrorSchema,
  uploadBlobSuccess,
} from "../src/lib/contracts/upload-blob";

const AUTH_REQUIRED = customerApiError({
  code: "AUTH_REQUIRED",
  message: "未登录",
  retryable: false,
  action: "sign_in",
});

test("H1 upload contract: success and auth/failure envelopes are closed", () => {
  const success = uploadBlobSuccess({
    url: "https://assets.example.test/uploads/a.png",
    pathname: "uploads/a.png",
  });
  assert.deepEqual(uploadBlobResponseSchema.parse(success), success);
  assert.deepEqual(uploadBlobResponseSchema.parse(AUTH_REQUIRED), AUTH_REQUIRED);

  for (const error of [
    customerApiError({
      code: "VALIDATION_FAILED",
      message: "文件格式不受支持。",
      retryable: false,
      action: "fix_request",
    }),
    customerApiError({
      code: "STORAGE_UNAVAILABLE",
      message: "素材存储暂不可用，请稍后重试。",
      retryable: true,
      action: "retry",
    }),
    uploadBlobQuotaErrorSchema.parse({
      ...customerApiError({
        code: "QUOTA_EXCEEDED",
        message: "本周期上传额度已用尽。",
        retryable: false,
        action: "view_usage",
      }),
      resource: "BLOB_UPLOAD_BYTES",
      used: 100,
      limit: 100,
      periodKey: "2026-07",
    }),
    customerApiError({
      code: "SERVICE_UNAVAILABLE",
      message: "素材安全检查暂不可用，请稍后重试。",
      retryable: true,
      action: "retry",
    }),
    customerApiError({
      code: "QUALITY_BLOCKED",
      message: "内容安全检查未通过，请更换素材后重试。",
      retryable: false,
      action: "replace_asset",
    }),
  ]) {
    assert.equal(uploadBlobResponseSchema.safeParse(error).success, true);
  }

  assert.equal(
    uploadBlobResponseSchema.safeParse({ error: "raw framework error" })
      .success,
    false,
  );
  assert.equal(
    uploadBlobResponseSchema.safeParse({
      ...AUTH_REQUIRED,
      stack: "private stack",
    }).success,
    false,
  );
});

test("H1 template contract: DTO allowlist is stable and strips persistence fields", () => {
  const template = batchStyleTemplateDto(
    {
      id: "template_1",
      slug: "ugc-proof",
      version: 3,
      name: "UGC Proof",
      nameZh: "UGC 真实证明",
      category: "UGC",
      coverImage: "/template-previews/ugc-proof.jpg",
      promptSkeleton: "Use {IMAGE_REFS} as truth.",
      negativePrompt: "product morphing",
      lockedParams: {
        duration: 15,
        aspectRatio: "9:16",
        resolution: "1080p",
        cameraStyle: "controlled handheld camera",
        stability: "balanced",
        humanInteraction: "controlled",
      },
      imagesPerVideo: { min: 2, max: 4 },
      // Compile-time input is intentionally structural; persistence fields are
      // supplied at runtime here to prove they cannot cross the DTO allowlist.
      status: "ACTIVE",
      createdAt: "secret-persistence-shape",
    } as Parameters<typeof batchStyleTemplateDto>[0],
    "/template-previews/ugc-proof.jpg",
  );

  assert.equal("status" in template, false);
  assert.equal("createdAt" in template, false);
  const success = batchStyleTemplatesSuccessSchema.parse({
    ok: true,
    templates: [template],
  });
  assert.deepEqual(batchStyleTemplatesResponseSchema.parse(success), success);
  assert.deepEqual(
    batchStyleTemplatesResponseSchema.parse(AUTH_REQUIRED),
    AUTH_REQUIRED,
  );
  assert.equal(
    batchStyleTemplatesResponseSchema.safeParse(
      customerApiError({
        code: "SERVICE_UNAVAILABLE",
        message: "风格模板暂时无法加载，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
    ).success,
    true,
  );

  const legacy = batchStyleTemplateDto(
    {
      id: "acceptance_fixture",
      slug: "final-acceptance-single-image",
      version: 1,
      name: "Final acceptance",
      nameZh: "最终验收",
      category: "自动化验收",
      coverImage: "https://assets.example.test/fixture.svg",
      promptSkeleton: "Use {IMAGE_REFS} as truth.",
      negativePrompt: "morphing",
      lockedParams: {
        duration: 5,
        aspectRatio: "9:16",
        resolution: "720p",
        cameraStyle: "deterministic fixture camera",
      },
      imagesPerVideo: { min: 1, max: 1 },
    },
    null,
  );
  assert.equal(legacy.lockedParams.stability, "balanced");
  assert.equal(legacy.lockedParams.humanInteraction, "controlled");
});

test("H1 health contract: healthy and degraded snapshots expose only bounded diagnostics", () => {
  const healthy = healthResponseSchema.parse({
    ok: true,
    region: "na",
    deploymentTarget: "vercel",
    aiProvider: "openai",
    storageProvider: "vercel_blob",
    videoProvider: "mock",
    contentReviewProvider: "openai_moderation",
    contentReviewEnabled: true,
    paymentEnabled: false,
    smsLoginEnabled: false,
    database: "connected",
    aiProviderStatus: "configured",
    storageProviderStatus: "configured",
    videoProviderStatus: "mock",
    storage: "not_checked",
    envValidation: { ok: true, missing: [], warnings: [] },
    appVersion: "0.2.0",
    timestamp: "2026-07-14T12:00:00.000Z",
  });
  assert.deepEqual(Object.keys(healthy).sort(), [
    "aiProvider",
    "aiProviderStatus",
    "appVersion",
    "contentReviewEnabled",
    "contentReviewProvider",
    "database",
    "deploymentTarget",
    "envValidation",
    "ok",
    "paymentEnabled",
    "region",
    "smsLoginEnabled",
    "storage",
    "storageProvider",
    "storageProviderStatus",
    "timestamp",
    "videoProvider",
    "videoProviderStatus",
  ]);
  assert.equal(healthHttpStatus(healthy), 200);

  const degraded = unavailableHealthResponse(
    new Date("2026-07-14T12:00:00.000Z"),
  );
  assert.equal(degraded.ok, false);
  assert.equal(degraded.database, "not_checked");
  assert.equal(healthHttpStatus(degraded), 503);
  assert.deepEqual(healthResponseSchema.parse(degraded), degraded);

  assert.equal(
    healthResponseSchema.safeParse({
      ...healthy,
      database: "failed",
      databaseError:
        "postgresql://user:password@secret-host.example/db?token=leak",
    }).success,
    false,
  );
  assert.equal(
    healthResponseSchema.safeParse({
      ...healthy,
      storage: "failed",
      storageError: "Bearer secret-token",
    }).success,
    false,
  );
});

test("H1 endpoint wiring: all three routes use the shared schemas and safe envelopes", async () => {
  const [upload, templates, health] = await Promise.all([
    readFile("src/app/api/upload/blob/route.ts", "utf8"),
    readFile("src/app/api/batch-style-templates/route.ts", "utf8"),
    readFile("src/app/api/health/route.ts", "utf8"),
  ]);

  assert.match(upload, /requireAuth\(\)/);
  assert.match(upload, /uploadBlobSuccess\(/);
  assert.match(upload, /customerApiError\(/);
  assert.match(upload, /ContentReviewRejectedError/);
  assert.match(upload, /code: "QUALITY_BLOCKED"/);
  assert.doesNotMatch(upload, /throw err\b/);

  assert.match(templates, /requireAuth\(\)/);
  assert.match(templates, /batchStyleTemplatesSuccessSchema\.parse\(/);
  assert.match(templates, /code: "SERVICE_UNAVAILABLE"/);
  assert.match(templates, /\{ status: 503 \}/);

  assert.match(health, /healthResponseSchema\.parse\(/);
  assert.match(health, /unavailableHealthResponse\(\)/);
  assert.match(health, /export const HEAD = GET/);
  assert.doesNotMatch(health, /error:\s*\(err as Error\)\.message/);

  // Shared guard's 401 is part of both protected endpoint unions.
  assert.equal(customerApiErrorSchema.safeParse(AUTH_REQUIRED).success, true);
});
