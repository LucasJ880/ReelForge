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
  assert.equal(app.aiProvider, "openai");
  assert.equal(app.storageProvider, "vercel_blob");
  assert.equal(app.videoProvider, "shuyu");
  /// 直连线路与内容审核删了之后，这些字段不再存在
  for (const key of ["seedanceRuntimeProfile", "contentReviewProvider", "contentReviewEnabled"]) {
    assert.equal(key in app, false, key);
  }
});

test("parseAppEnv: VIDEO_PROVIDER 只认 shuyu / mock；别的值报清晰错误", () => {
  assert.equal(parseAppEnv({ VIDEO_PROVIDER: "shuyu" } as EnvMap).videoProvider, "shuyu");
  assert.equal(parseAppEnv({ VIDEO_PROVIDER: " Mock " } as EnvMap).videoProvider, "mock");
  assert.equal(parseAppEnv({ VIDEO_PROVIDER: "  " } as EnvMap).videoProvider, "shuyu");
  for (const value of ["runway", "volcengine_cn_legacy", "byteplus_international", "seedance", "not-a-provider"]) {
    assert.throws(
      () => parseAppEnv({ VIDEO_PROVIDER: value } as EnvMap),
      new RegExp(`VIDEO_PROVIDER="${value}" 不在允许列表 \\[shuyu, mock\\] 内`),
      value,
    );
  }
});

test("parseAppEnv: 线上残留的旧值 VIDEO_PROVIDER=byteplus 按 shuyu 处理（不让下一次部署整站停摆），并挂一条提醒", () => {
  for (const value of ["byteplus", " BytePlus "]) {
    assert.equal(parseAppEnv({ VIDEO_PROVIDER: value } as EnvMap).videoProvider, "shuyu", value);
  }
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    VERCEL_ENV: "production",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "false",
    SHUYU_API_KEY: "shuyu-key",
  } as EnvMap);
  assert.equal(r.ok, true, r.missing.join("; "));
  assert.ok(r.warnings.some((w) => /VIDEO_PROVIDER=byteplus/.test(w) && /按 shuyu 处理/.test(w)));
  /// 没有旧值就没有这条提醒
  const clean = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    VIDEO_ENGINE_MOCK: "false",
    SHUYU_API_KEY: "shuyu-key",
  } as EnvMap);
  assert.deepEqual(clean.warnings, []);
});

test("parseAppEnv: 直连线路与内容审核的开关不再读取，线上残留（含原来会报错的值）不影响解析", () => {
  const app = parseAppEnv({
    SEEDANCE_RUNTIME_PROFILE: "legacy-auto-fallback",
    ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
    ARK_API_KEY: "legacy-key",
    BYTEPLUS_ARK_API_KEY: "international-key",
    CONTENT_REVIEW_ENABLED: "true",
    CONTENT_REVIEW_PROVIDER: "not-a-review-provider",
    CONTENT_REVIEW_MOCK: "true",
  } as EnvMap);
  assert.equal(app.videoProvider, "shuyu");
});

test("parseAppEnv: 国内版的 provider 已删（2026-11-16），旧值报清晰错误而不是静默退回默认", () => {
  assert.throws(
    () => parseAppEnv({ AI_PROVIDER: "volcengine" } as EnvMap),
    /AI_PROVIDER="volcengine" 不在允许列表 \[openai\] 内/,
  );
  assert.throws(
    () => parseAppEnv({ STORAGE_PROVIDER: "volcengine_tos" } as EnvMap),
    /STORAGE_PROVIDER="volcengine_tos" 不在允许列表 \[vercel_blob\] 内/,
  );
});

test("parseAppEnv: 已退役的国内版开关不再读取，线上残留也不影响解析", () => {
  const app = parseAppEnv({
    REGION: "cn",
    DEPLOYMENT_TARGET: "selfhosted",
    SMS_LOGIN_ENABLED: "true",
    PAYMENT_ENABLED: "false",
    CDN_BASE_URL: "https://cdn.example",
  } as EnvMap);
  assert.equal(app.aiProvider, "openai");
  assert.equal(app.storageProvider, "vercel_blob");
  for (const key of ["region", "deploymentTarget", "smsLoginEnabled", "paymentEnabled", "cdnBaseUrl"]) {
    assert.equal(key in app, false, key);
  }
});

test("parseAppEnv: 非法 AI_PROVIDER 抛清晰错误", () => {
  assert.throws(() => parseAppEnv({ AI_PROVIDER: "claude" } as EnvMap), /AI_PROVIDER="claude"/);
});

test("parseAppEnv: 非法 STORAGE_PROVIDER 抛错", () => {
  assert.throws(() => parseAppEnv({ STORAGE_PROVIDER: "s3" } as EnvMap), /STORAGE_PROVIDER="s3"/);
});

test("validateDeploymentEnv: NA 缺基础生产变量时 fail closed", () => {
  const r = validateDeploymentEnv(EMPTY);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("DATABASE_URL"));
  assert.ok(r.missing.includes("AUTH_SECRET"));
});

test("validateDeploymentEnv: 真实出片缺 Shuyu 密钥时 fail closed", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    LLM_FORCE_MOCK: "true",
    VIDEO_ENGINE_MOCK: "false",
  } as EnvMap);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /SHUYU_API_KEY/.test(m)));
  assert.equal(r.missing.some((m) => /ARK_API_KEY/.test(m)), false, "不再要求直连线路的密钥");
});

test("validateDeploymentEnv: NA mock 配置齐全 → ok=true", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    LLM_FORCE_MOCK: "true",
    VIDEO_ENGINE_MOCK: "true",
  } as EnvMap);
  assert.equal(r.ok, true);
});

test("validateDeploymentEnv: Vercel production 禁止 mock 视频 runtime", () => {
  const r = validateDeploymentEnv({
    DATABASE_URL: "postgresql://x:y@host/db",
    AUTH_SECRET: "secret",
    APP_BASE_URL: "https://aivora.example",
    VERCEL_ENV: "production",
    VIDEO_PROVIDER: "shuyu",
    VIDEO_ENGINE_MOCK: "true",
    SHUYU_API_KEY: "shuyu-key",
  } as EnvMap);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /production.*mock/i.test(m)));
});

test("video runtime readiness: production mock 在任何写入前关闭", () => {
  assert.deepEqual(
    videoGenerationRuntimeReadiness({
      VERCEL_ENV: "production",
      VIDEO_PROVIDER: "shuyu",
      VIDEO_ENGINE_MOCK: "true",
      SHUYU_API_KEY: "shuyu-key",
    } as EnvMap),
    { ok: false, reason: "production_mock_forbidden" },
  );
});

test("video runtime readiness: 生产的三种真实形状（没写、写 shuyu、残留 byteplus）结论一样——只看 Shuyu 密钥", () => {
  for (const provider of [undefined, "shuyu", "byteplus"]) {
    const base = {
      VERCEL_ENV: "production",
      VIDEO_ENGINE_MOCK: "false",
      ...(provider ? { VIDEO_PROVIDER: provider } : {}),
      /// 线上还留着的直连 / 审核变量：都不再影响结论
      SEEDANCE_RUNTIME_PROFILE: "volcengine_cn_legacy",
      CONTENT_REVIEW_ENABLED: "true",
      CONTENT_REVIEW_PROVIDER: "openai_moderation",
    } as EnvMap;
    assert.deepEqual(videoGenerationRuntimeReadiness({ ...base, SHUYU_API_KEY: "  configured  " }), { ok: true }, String(provider));
    assert.deepEqual(videoGenerationRuntimeReadiness({ ...base, shuyu_api_key: "configured" }), { ok: true }, String(provider));
    assert.deepEqual(
      videoGenerationRuntimeReadiness({ ...base, SHUYU_API_KEY: "  \t  " }),
      { ok: false, reason: "shuyu_key_missing" },
      String(provider),
    );
    assert.deepEqual(
      videoGenerationRuntimeReadiness({ ...base, BYTEPLUS_ARK_API_KEY: "configured", ARK_API_KEY: "configured" }),
      { ok: false, reason: "shuyu_key_missing" },
      `${String(provider)}：直连线路的密钥不算出片凭据`,
    );
  }
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

// ---------------------------------------------------------------------------
// 出片只有 Shuyu（2026-11-17 直连线路删除）：健康检查只看 Shuyu 密钥
// ---------------------------------------------------------------------------

const PROD_LIKE: EnvMap = {
  DATABASE_URL: "postgresql://x:y@host/db",
  AUTH_SECRET: "secret",
  APP_BASE_URL: "https://aivora.example",
  LLM_FORCE_MOCK: "true",
  VIDEO_ENGINE_MOCK: "false",
  /// 生产 11-17 的实际形状：这三个旧变量都还留在 Vercel 上
  VIDEO_PROVIDER: "byteplus",
  SEEDANCE_RUNTIME_PROFILE: "volcengine_cn_legacy",
  CONTENT_REVIEW_PROVIDER: "openai_moderation",
};

test("validateDeploymentEnv: 生产现状（旧变量都还在）+ Shuyu 配着 → 健康；提醒只有「改掉 VIDEO_PROVIDER」一条", () => {
  const r = validateDeploymentEnv({ ...PROD_LIKE, SHUYU_API_KEY: "shuyu-key" });
  assert.equal(r.ok, true, r.missing.join("; "));
  assert.deepEqual(r.missing, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /VIDEO_PROVIDER=byteplus/);
  assert.equal(r.warnings.some((w) => /ARK_API_KEY|中国区|CONTENT_REVIEW/.test(w)), false, "直连与审核的提醒随代码一起没了");
});

test("validateDeploymentEnv: Shuyu 没配 → fail closed（真的没有线路能出片）；别家的密钥不算", () => {
  const r = validateDeploymentEnv(PROD_LIKE);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /SHUYU_API_KEY/.test(m)));
  const blank = validateDeploymentEnv({
    ...PROD_LIKE,
    SHUYU_API_KEY: "  ",
    RUNWAYML_API_SECRET: "runway-key",
    ARK_API_KEY: "ark-key",
    BYTEPLUS_ARK_API_KEY: "byteplus-key",
  });
  assert.equal(blank.ok, false, "空白值不算配置；已下线线路的密钥不算有线路");
});
