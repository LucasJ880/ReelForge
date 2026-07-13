import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAppEnv,
  validateDeploymentEnv,
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
