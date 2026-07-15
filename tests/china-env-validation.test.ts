import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVideoGenerationRuntimeReady,
  parseAppEnv,
  validateDeploymentEnv,
  VideoGenerationRuntimeUnavailableError,
  videoGenerationRuntimeReadiness,
} from "../src/lib/config/env";

type EnvMap = Record<string, string | undefined>;
const EMPTY: EnvMap = {};

test("parseAppEnv: 默认锁定加拿大/北美 provider 路由", () => {
  const app = parseAppEnv(EMPTY);
  assert.equal(app.region, "na");
  assert.equal(app.deploymentTarget, "vercel");
  assert.equal(app.aiProvider, "openai");
  assert.equal(app.storageProvider, "vercel_blob");
  assert.equal(app.videoProvider, "byteplus");
  assert.equal(app.contentReviewProvider, "noop");
  assert.equal(app.paymentEnabled, true);
});

test("parseAppEnv: REGION=cn 已退出当前路线并 fail closed", () => {
  assert.throws(() => parseAppEnv({ REGION: "cn" } as EnvMap), /REGION="cn"/);
});

test("parseAppEnv: 显式 future provider 仍由配置控制", () => {
  const app = parseAppEnv({
    REGION: "future",
    AI_PROVIDER: "volcengine",
    STORAGE_PROVIDER: "volcengine_tos",
  } as EnvMap);
  assert.equal(app.aiProvider, "volcengine");
  assert.equal(app.storageProvider, "volcengine_tos");
});

test("parseAppEnv: 非法 AI_PROVIDER 抛清晰错误", () => {
  assert.throws(() => parseAppEnv({ AI_PROVIDER: "claude" } as EnvMap), /AI_PROVIDER="claude"/);
});

test("parseAppEnv: 非法 STORAGE_PROVIDER 抛错", () => {
  assert.throws(() => parseAppEnv({ STORAGE_PROVIDER: "s3" } as EnvMap), /STORAGE_PROVIDER="s3"/);
});

test("parseAppEnv: bool 解析支持常见真假值", () => {
  for (const v of ["true", "TRUE", "1", "yes", "on"]) {
    assert.equal(parseAppEnv({ CONTENT_REVIEW_ENABLED: v } as EnvMap).contentReviewEnabled, true);
  }
  for (const v of ["false", "FALSE", "0", "no", "off"]) {
    assert.equal(parseAppEnv({ CONTENT_REVIEW_ENABLED: v } as EnvMap).contentReviewEnabled, false);
  }
});

test("validateDeploymentEnv: NA 缺基础生产变量时 fail closed", () => {
  const r = validateDeploymentEnv(EMPTY);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("DATABASE_URL"));
  assert.ok(r.missing.includes("AUTH_SECRET"));
});

test("validateDeploymentEnv: 真实 BytePlus 缺国际密钥时 fail closed", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    LLM_FORCE_MOCK: "true",
    VIDEO_ENGINE_MOCK: "false",
  } as EnvMap);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /BYTEPLUS_ARK_API_KEY/.test(m)));
});

test("validateDeploymentEnv: NA mock 配置齐全 → ok=true", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    LLM_FORCE_MOCK: "true",
    VIDEO_ENGINE_MOCK: "true",
    ARK_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
  } as EnvMap);
  assert.equal(r.ok, true);
});

test("validateDeploymentEnv: Vercel production 禁止 mock 视频 runtime", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    VERCEL_ENV: "production",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "true",
    ARK_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
  } as EnvMap);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /production.*mock/i.test(m)));
});

test("video runtime readiness: production mock 在任何写入前关闭", () => {
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      VERCEL_ENV: "production",
      VIDEO_PROVIDER: "byteplus",
      VIDEO_ENGINE_MOCK: "true",
    } as EnvMap),
    { ok: false, reason: "production_mock_forbidden" },
  );
});

test("video runtime readiness: real BytePlus 必须同时有国际密钥与国际端点", () => {
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      VERCEL_ENV: "production",
      VIDEO_PROVIDER: "byteplus",
      VIDEO_ENGINE_MOCK: "false",
      ARK_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
    } as EnvMap),
    { ok: false, reason: "byteplus_key_missing" },
  );
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      VERCEL_ENV: "production",
      VIDEO_PROVIDER: "byteplus",
      VIDEO_ENGINE_MOCK: "false",
      BYTEPLUS_ARK_API_KEY: "configured",
      ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
    } as EnvMap),
    { ok: false, reason: "byteplus_endpoint_invalid" },
  );
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      VERCEL_ENV: "production",
      VIDEO_PROVIDER: "byteplus",
      VIDEO_ENGINE_MOCK: "false",
      BYTEPLUS_ARK_API_KEY: "  configured  ",
      ARK_BASE_URL: "  https://ark.ap-southeast.bytepluses.com/api/v3///  ",
    } as EnvMap),
    { ok: true },
  );
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      VERCEL_ENV: "production",
      VIDEO_PROVIDER: "byteplus",
      VIDEO_ENGINE_MOCK: "false",
      BYTEPLUS_ARK_API_KEY: "  \t  ",
      ARK_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
    } as EnvMap),
    { ok: false, reason: "byteplus_key_missing" },
  );
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      VERCEL_ENV: "production",
      VIDEO_PROVIDER: "byteplus",
      VIDEO_ENGINE_MOCK: "false",
      BYTEPLUS_ARK_API_KEY: "configured",
      ARK_BASE_URL: "   ",
    } as EnvMap),
    { ok: false, reason: "byteplus_endpoint_invalid" },
  );
});

test("video runtime readiness: 非法 enum 折叠为 typed unavailable", () => {
  const env = {
    VERCEL_ENV: "production",
    VIDEO_PROVIDER: "not-a-provider",
    VIDEO_ENGINE_MOCK: "false",
  } as EnvMap;
  assert.deepEqual(videoGenerationRuntimeReadiness(env), {
    ok: false,
    reason: "environment_invalid",
  });
  assert.throws(
    () => assertVideoGenerationRuntimeReady(env),
    (error: unknown) => {
      assert.ok(error instanceof VideoGenerationRuntimeUnavailableError);
      assert.equal(error.reason, "environment_invalid");
      assert.equal(error.httpStatus, 503);
      return true;
    },
  );
});

test("video runtime readiness: 真实 OpenAI moderation 缺密钥时关闭", () => {
  const base = {
    VERCEL_ENV: "production",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "false",
    BYTEPLUS_ARK_API_KEY: "configured",
    ARK_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
    CONTENT_REVIEW_ENABLED: "true",
    CONTENT_REVIEW_PROVIDER: "openai_moderation",
  } as EnvMap;
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      ...base,
      OPENAI_API_KEY: "  ",
    }),
    { ok: false, reason: "content_review_key_missing" },
  );
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      ...base,
      OPENAI_API_KEY: "  configured  ",
    }),
    { ok: true },
  );
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      ...base,
      CONTENT_REVIEW_MOCK: "true",
    }),
    { ok: true },
  );
});

test("validateDeploymentEnv: Vercel production 即使 dry-run 也不能伪装成 rehearsal", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    VERCEL_ENV: "production",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
  } as EnvMap);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /production.*mock/i.test(m)));
});

test("validateDeploymentEnv: Vercel preview 显式 mock 仍可用于演练", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://preview.aivora.example",
    VERCEL_ENV: "preview",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
  } as EnvMap);
  assert.equal(r.ok, true);
});

test("validateDeploymentEnv: 本地 optimized server + 显式 dry-run 仍可用于金路径", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "http://localhost:3120",
    NODE_ENV: "production",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "mock",
    VIDEO_ENGINE_MOCK: "true",
  } as EnvMap);
  assert.equal(r.ok, true);
});

test("validateDeploymentEnv: CONTENT_REVIEW_ENABLED=true + noop 应给警告", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    LLM_FORCE_MOCK: "true",
    VIDEO_ENGINE_MOCK: "true",
    CONTENT_REVIEW_ENABLED: "true",
    CONTENT_REVIEW_PROVIDER: "noop",
  } as EnvMap);
  assert.ok(r.warnings.some((m) => /CONTENT_REVIEW.*noop/.test(m)));
});

test("validateDeploymentEnv: 非国际 Ark URL 被拒绝", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    LLM_FORCE_MOCK: "true",
    VIDEO_ENGINE_MOCK: "true",
    ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
  } as EnvMap);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /BytePlus 国际/.test(m)));
});
