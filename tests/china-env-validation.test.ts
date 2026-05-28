import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAppEnv,
  validateChinaDeploymentEnv,
} from "../src/lib/config/env";

type EnvMap = Record<string, string | undefined>;

const EMPTY: EnvMap = {};

test("parseAppEnv: 默认（无任何 PROVIDER 变量）→ 海外默认 openai / vercel_blob / volcengine", () => {
  const app = parseAppEnv(EMPTY);
  assert.equal(app.region, "global");
  assert.equal(app.deploymentTarget, "vercel");
  assert.equal(app.aiProvider, "openai");
  assert.equal(app.storageProvider, "vercel_blob");
  assert.equal(app.videoProvider, "volcengine");
  assert.equal(app.contentReviewProvider, "noop");
  assert.equal(app.contentReviewEnabled, false);
  assert.equal(app.chinaComplianceMode, false);
  assert.equal(app.smsLoginEnabled, false);
});

test("parseAppEnv: REGION=cn 自动推导出全套火山 provider 默认值", () => {
  const app = parseAppEnv({ REGION: "cn" } as EnvMap);
  assert.equal(app.region, "cn");
  assert.equal(app.deploymentTarget, "china");
  assert.equal(app.aiProvider, "volcengine");
  assert.equal(app.storageProvider, "volcengine_tos");
  assert.equal(app.videoProvider, "volcengine");
  assert.equal(app.chinaComplianceMode, true);
  /// 大陆模式默认关支付
  assert.equal(app.paymentEnabled, false);
});

test("parseAppEnv: 显式 AI_PROVIDER 覆盖区域默认", () => {
  const app = parseAppEnv({
    REGION: "cn",
    AI_PROVIDER: "openai",
  } as EnvMap);
  assert.equal(app.aiProvider, "openai");
});

test("parseAppEnv: 非法 AI_PROVIDER 抛清晰错误", () => {
  assert.throws(
    () =>
      parseAppEnv({ AI_PROVIDER: "claude" } as EnvMap),
    /AI_PROVIDER="claude"/,
  );
});

test("parseAppEnv: 非法 STORAGE_PROVIDER 抛错", () => {
  assert.throws(
    () =>
      parseAppEnv({
        STORAGE_PROVIDER: "s3",
      } as EnvMap),
    /STORAGE_PROVIDER="s3"/,
  );
});

test("parseAppEnv: bool 解析支持 true/1/yes/on 与 false/0/no/off", () => {
  const trueValues = ["true", "TRUE", "1", "yes", "on"];
  for (const v of trueValues) {
    const app = parseAppEnv({
      CONTENT_REVIEW_ENABLED: v,
    } as EnvMap);
    assert.equal(app.contentReviewEnabled, true, `value=${v}`);
  }
  const falseValues = ["false", "FALSE", "0", "no", "off"];
  for (const v of falseValues) {
    const app = parseAppEnv({
      CONTENT_REVIEW_ENABLED: v,
    } as EnvMap);
    assert.equal(app.contentReviewEnabled, false, `value=${v}`);
  }
});

test("validateChinaDeploymentEnv: region=global 永远 ok", () => {
  const r = validateChinaDeploymentEnv(EMPTY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("validateChinaDeploymentEnv: region=cn 缺关键 vars 给出 missing 列表", () => {
  const r = validateChinaDeploymentEnv({
    REGION: "cn",
  } as EnvMap);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("DATABASE_URL"));
  assert.ok(r.missing.includes("AUTH_SECRET"));
  assert.ok(r.missing.some((m) => /ARK_API_KEY/.test(m)));
  assert.ok(r.missing.includes("VOLCENGINE_ACCESS_KEY_ID"));
});

test("validateChinaDeploymentEnv: 配齐所有大陆必备 → ok=true", () => {
  const r = validateChinaDeploymentEnv({
    REGION: "cn",
    DATABASE_URL: "postgresql://x:y@host/db?sslmode=require",
    AUTH_SECRET: "super-secret",
    APP_BASE_URL: "https://demo.aivora.cn",
    VOLCENGINE_ARK_API_KEY: "ak-123",
    VOLCENGINE_ACCESS_KEY_ID: "AKID",
    VOLCENGINE_SECRET_ACCESS_KEY: "secret",
    VOLCENGINE_TOS_ENDPOINT: "tos-cn-beijing.volces.com",
    VOLCENGINE_TOS_BUCKET_UPLOADS: "u",
    VOLCENGINE_TOS_BUCKET_RENDERS: "r",
    ARK_API_KEY: "ak-123",
    VIDEO_ENGINE_MOCK: "false",
  } as EnvMap);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("validateChinaDeploymentEnv: CONTENT_REVIEW_ENABLED=true + noop 应给警告", () => {
  const r = validateChinaDeploymentEnv({
    REGION: "cn",
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "s",
    APP_BASE_URL: "https://x",
    VOLCENGINE_ARK_API_KEY: "k",
    VOLCENGINE_ACCESS_KEY_ID: "AK",
    VOLCENGINE_SECRET_ACCESS_KEY: "S",
    VOLCENGINE_TOS_ENDPOINT: "e",
    VOLCENGINE_TOS_BUCKET_UPLOADS: "u",
    VOLCENGINE_TOS_BUCKET_RENDERS: "r",
    ARK_API_KEY: "k",
    VIDEO_ENGINE_MOCK: "true",
    CONTENT_REVIEW_ENABLED: "true",
    CONTENT_REVIEW_PROVIDER: "noop",
  } as EnvMap);
  assert.equal(r.ok, true);
  assert.ok(
    r.warnings.some((w) => /CONTENT_REVIEW.*noop/.test(w)),
    `expect warning, got: ${JSON.stringify(r.warnings)}`,
  );
});
