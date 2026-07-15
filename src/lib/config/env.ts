/**
 * 统一环境变量解析 + 校验。
 *
 * 设计目标：
 * - 业务代码 / provider 抽象层都从这里读 region / deployment / provider 路由，
 *   不要再到处 `process.env.AI_PROVIDER ?? "openai"`。
 * - 加拿大 / 北美生产模式下缺关键 env 时给出清晰错误（避免运行到一半才报）。
 * - **绝不修改 process.env 本身**；只读 + 解析 + 缓存。
 * - 默认行为：openai / vercel_blob / BytePlus 国际 Seedance。
 *
 * 校验时机：
 * - `validateDeploymentEnv()` 由健康检查 / 部署脚本主动调用。
 * - 不在模块加载时强校验，避免本地 dev / 测试时炸全场。
 */

import {
  resolveSeedanceArkBaseUrl,
  resolveSeedanceRuntimeProfile,
  seedanceApiKey,
  seedanceCredentialEnvName,
  seedanceExpectedBaseUrl,
  type SeedanceRuntimeProfile,
} from "@/lib/config/seedance-runtime";

export type Region = "na" | "future";
export type DeploymentTarget = "vercel" | "selfhosted";
export type AiProviderId = "openai" | "volcengine";
export type StorageProviderId = "vercel_blob" | "volcengine_tos";
export type VideoProviderId = "byteplus" | "mock";
export type ContentReviewProviderId = "noop" | "openai_moderation";

export interface AppEnv {
  region: Region;
  deploymentTarget: DeploymentTarget;
  aiProvider: AiProviderId;
  storageProvider: StorageProviderId;
  videoProvider: VideoProviderId;
  seedanceRuntimeProfile: SeedanceRuntimeProfile;
  contentReviewProvider: ContentReviewProviderId;
  contentReviewEnabled: boolean;
  paymentEnabled: boolean;
  smsLoginEnabled: boolean;
  cdnBaseUrl: string | null;
  appBaseUrl: string | null;
}

export type VideoGenerationRuntimeUnavailableReason =
  | "environment_invalid"
  | "production_mock_forbidden"
  | "byteplus_key_missing"
  | "byteplus_endpoint_invalid"
  | "volcengine_legacy_key_missing"
  | "volcengine_legacy_endpoint_invalid"
  | "content_review_key_missing";

export type VideoGenerationRuntimeReadiness =
  | { ok: true }
  | { ok: false; reason: VideoGenerationRuntimeUnavailableReason };

export class VideoGenerationRuntimeUnavailableError extends Error {
  readonly code = "VIDEO_RUNTIME_UNAVAILABLE" as const;
  readonly httpStatus = 503 as const;

  constructor(readonly reason: VideoGenerationRuntimeUnavailableReason) {
    super(`video generation runtime unavailable: ${reason}`);
    this.name = "VideoGenerationRuntimeUnavailableError";
  }
}

const REGION_VALUES: Region[] = ["na", "future"];
const DEPLOYMENT_VALUES: DeploymentTarget[] = ["vercel", "selfhosted"];
const AI_PROVIDER_VALUES: AiProviderId[] = ["openai", "volcengine"];
const STORAGE_PROVIDER_VALUES: StorageProviderId[] = [
  "vercel_blob",
  "volcengine_tos",
];
const VIDEO_PROVIDER_VALUES: VideoProviderId[] = ["byteplus", "mock"];
const REVIEW_PROVIDER_VALUES: ContentReviewProviderId[] = ["noop", "openai_moderation"];

function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  varName: string,
): T {
  if (!raw || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase() as T;
  if (!allowed.includes(normalized)) {
    throw new Error(
      `[env] ${varName}="${raw}" 不在允许列表 [${allowed.join(", ")}] 内`,
    );
  }
  return normalized;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

function isExplicitRealVideoEngine(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "false" || value === "0" || value === "no";
}

/**
 * Vercel production is always a customer runtime. A local optimized server can
 * still be an explicit zero-cost rehearsal when AIVORA_DRY_RUN is enabled.
 */
export function isProductionRuntime(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === "production") return true;
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  return env.NODE_ENV === "production" && !parseBool(env.AIVORA_DRY_RUN, false);
}

/** Mirrors the provider's safe default: anything except an explicit false/0/no is mock. */
export function isMockVideoRuntime(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const app = parseAppEnv(env);
  return (
    app.videoProvider === "mock" ||
    parseBool(env.AIVORA_DRY_RUN, false) ||
    !isExplicitRealVideoEngine(env.VIDEO_ENGINE_MOCK)
  );
}

/** Runtime backstop for every mock submission/status path, not just /api/health. */
export function assertMockVideoRuntimeAllowed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  if (isProductionRuntime(env)) {
    throw new Error(
      "production runtime 禁止 mock 视频 provider；请在 preview/rehearsal 使用 mock，或显式配置真实 provider",
    );
  }
}

/**
 * Mutation-entry readiness check. It runs before quota consumption or job
 * creation so a production configuration error cannot leave billed failures.
 */
export function videoGenerationRuntimeReadiness(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): VideoGenerationRuntimeReadiness {
  let app: AppEnv;
  try {
    app = parseAppEnv(env);
  } catch {
    return { ok: false, reason: "environment_invalid" };
  }

  const mock =
    app.videoProvider === "mock" ||
    parseBool(env.AIVORA_DRY_RUN, false) ||
    !isExplicitRealVideoEngine(env.VIDEO_ENGINE_MOCK);
  if (isProductionRuntime(env) && mock) {
    return { ok: false, reason: "production_mock_forbidden" };
  }

  if (!mock && app.videoProvider === "byteplus") {
    if (!seedanceApiKey(app.seedanceRuntimeProfile, env)) {
      return {
        ok: false,
        reason:
          app.seedanceRuntimeProfile === "volcengine_cn_legacy"
            ? "volcengine_legacy_key_missing"
            : "byteplus_key_missing",
      };
    }
    try {
      resolveSeedanceArkBaseUrl(
        env.ARK_BASE_URL,
        app.seedanceRuntimeProfile,
      );
    } catch {
      return {
        ok: false,
        reason:
          app.seedanceRuntimeProfile === "volcengine_cn_legacy"
            ? "volcengine_legacy_endpoint_invalid"
            : "byteplus_endpoint_invalid",
      };
    }
  }

  const moderationMock = [env.CONTENT_REVIEW_MOCK, env.LLM_FORCE_MOCK].some(
    (value) =>
      ["1", "true", "yes"].includes(value?.toLowerCase() ?? ""),
  );
  if (
    app.contentReviewEnabled &&
    app.contentReviewProvider === "openai_moderation" &&
    !moderationMock &&
    !env.OPENAI_API_KEY?.trim()
  ) {
    return { ok: false, reason: "content_review_key_missing" };
  }

  return { ok: true };
}

export function assertVideoGenerationRuntimeReady(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const readiness = videoGenerationRuntimeReadiness(env);
  if (!readiness.ok) {
    throw new VideoGenerationRuntimeUnavailableError(readiness.reason);
  }
}

let cached: AppEnv | null = null;

/**
 * 读取并解析（带缓存）。
 * 测试代码可调 `__resetAppEnvForTests()` 让下次 getAppEnv() 重新读取 process.env。
 */
export function getAppEnv(): AppEnv {
  if (cached) return cached;
  cached = parseAppEnv(process.env);
  return cached;
}

/**
 * 纯函数版本（不读 process.env），方便单测。
 */
export function parseAppEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): AppEnv {
  const region = parseEnum<Region>(env.REGION, REGION_VALUES, "na", "REGION");
  const deploymentDefault: DeploymentTarget = "vercel";
  const deploymentTarget = parseEnum<DeploymentTarget>(
    env.DEPLOYMENT_TARGET,
    DEPLOYMENT_VALUES,
    deploymentDefault,
    "DEPLOYMENT_TARGET",
  );

  const aiDefault: AiProviderId = "openai";
  const storageDefault: StorageProviderId = "vercel_blob";
  const videoDefault: VideoProviderId = "byteplus";

  const aiProvider = parseEnum<AiProviderId>(
    env.AI_PROVIDER,
    AI_PROVIDER_VALUES,
    aiDefault,
    "AI_PROVIDER",
  );
  const storageProvider = parseEnum<StorageProviderId>(
    env.STORAGE_PROVIDER,
    STORAGE_PROVIDER_VALUES,
    storageDefault,
    "STORAGE_PROVIDER",
  );
  const videoProvider = parseEnum<VideoProviderId>(
    env.VIDEO_PROVIDER,
    VIDEO_PROVIDER_VALUES,
    videoDefault,
    "VIDEO_PROVIDER",
  );
  const seedanceRuntimeProfile = resolveSeedanceRuntimeProfile(
    env.SEEDANCE_RUNTIME_PROFILE,
  );

  const contentReviewProvider = parseEnum<ContentReviewProviderId>(
    env.CONTENT_REVIEW_PROVIDER,
    REVIEW_PROVIDER_VALUES,
    "noop",
    "CONTENT_REVIEW_PROVIDER",
  );

  return {
    region,
    deploymentTarget,
    aiProvider,
    storageProvider,
    videoProvider,
    seedanceRuntimeProfile,
    contentReviewProvider,
    contentReviewEnabled: parseBool(env.CONTENT_REVIEW_ENABLED, false),
    paymentEnabled: parseBool(env.PAYMENT_ENABLED, true),
    smsLoginEnabled: parseBool(env.SMS_LOGIN_ENABLED, false),
    cdnBaseUrl: env.CDN_BASE_URL?.trim() || null,
    appBaseUrl: (env.APP_BASE_URL || env.NEXT_PUBLIC_APP_URL)?.trim() || null,
  };
}

/**
 * 加拿大 / 北美部署校验。
 * 返回 missing 列表（空 = 校验通过）。
 *
 * 不抛错，由调用方决定是 throw 还是 warn 还是写 health endpoint。
 */
export function validateDeploymentEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { ok: boolean; missing: string[]; warnings: string[] } {
  const app = parseAppEnv(env);
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.AUTH_SECRET) missing.push("AUTH_SECRET");
  if (!env.APP_BASE_URL && !env.NEXT_PUBLIC_APP_URL) {
    missing.push("APP_BASE_URL (或 NEXT_PUBLIC_APP_URL)");
  }

  if (app.aiProvider === "volcengine") {
    if (!env.VOLCENGINE_ARK_API_KEY && !env.ARK_API_KEY) {
      missing.push("VOLCENGINE_ARK_API_KEY (或 ARK_API_KEY)");
    }
    if (!env.VOLCENGINE_ARK_MODEL_TEXT) {
      warnings.push(
        "VOLCENGINE_ARK_MODEL_TEXT 未配置，将使用默认 doubao-pro-32k",
      );
    }
  }

  if (app.storageProvider === "volcengine_tos") {
    if (!env.VOLCENGINE_ACCESS_KEY_ID) missing.push("VOLCENGINE_ACCESS_KEY_ID");
    if (!env.VOLCENGINE_SECRET_ACCESS_KEY) {
      missing.push("VOLCENGINE_SECRET_ACCESS_KEY");
    }
    if (!env.VOLCENGINE_TOS_ENDPOINT) missing.push("VOLCENGINE_TOS_ENDPOINT");
    if (!env.VOLCENGINE_TOS_BUCKET_UPLOADS) {
      missing.push("VOLCENGINE_TOS_BUCKET_UPLOADS");
    }
    if (!env.VOLCENGINE_TOS_BUCKET_RENDERS) {
      missing.push("VOLCENGINE_TOS_BUCKET_RENDERS");
    }
  }

  if (app.videoProvider === "byteplus") {
    const credentialName = seedanceCredentialEnvName(
      app.seedanceRuntimeProfile,
    );
    if (
      !seedanceApiKey(app.seedanceRuntimeProfile, env) &&
      !isMockVideoRuntime(env)
    ) {
      missing.push(
        `${credentialName}（SEEDANCE_RUNTIME_PROFILE=${app.seedanceRuntimeProfile} 且 VIDEO_ENGINE_MOCK=false 时必填；缺失会 fail closed）`,
      );
    }
    try {
      resolveSeedanceArkBaseUrl(
        env.ARK_BASE_URL,
        app.seedanceRuntimeProfile,
      );
    } catch {
      missing.push(
        `ARK_BASE_URL 必须为 ${app.seedanceRuntimeProfile} 的固定端点 ${seedanceExpectedBaseUrl(app.seedanceRuntimeProfile)}`,
      );
    }
    if (app.seedanceRuntimeProfile === "volcengine_cn_legacy") {
      warnings.push(
        "SEEDANCE_RUNTIME_PROFILE=volcengine_cn_legacy 会将生成素材发送至中国区；仅用于经人工明确批准的临时兼容窗口",
      );
    }
  }

  if (isProductionRuntime(env) && isMockVideoRuntime(env)) {
    missing.push(
      "production runtime 禁止 mock 视频 provider（VIDEO_PROVIDER=mock、VIDEO_ENGINE_MOCK 非 false 或 AIVORA_DRY_RUN）",
    );
  }

  if (app.contentReviewEnabled && app.contentReviewProvider === "noop") {
    warnings.push(
      "CONTENT_REVIEW_ENABLED=true 但 CONTENT_REVIEW_PROVIDER=noop → 等同于未启用审核",
    );
  }
  if (
    app.contentReviewEnabled &&
    app.contentReviewProvider === "openai_moderation" &&
    !env.OPENAI_API_KEY &&
    !parseBool(env.CONTENT_REVIEW_MOCK, false)
  ) {
    missing.push("OPENAI_API_KEY（OpenAI Moderation 启用时必填）");
  }

  return { ok: missing.length === 0, missing, warnings };
}

/// 仅测试用：清缓存
export function __resetAppEnvForTests(): void {
  cached = null;
}
