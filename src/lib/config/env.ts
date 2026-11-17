/**
 * 统一环境变量解析 + 校验。
 *
 * 设计目标：
 * - 业务代码 / provider 抽象层都从这里读 provider 路由，
 *   不要再到处 `process.env.AI_PROVIDER ?? "openai"`。
 * - 加拿大 / 北美生产模式下缺关键 env 时给出清晰错误（避免运行到一半才报）。
 * - **绝不修改 process.env 本身**；只读 + 解析 + 缓存。
 * - 默认行为：openai / vercel_blob / Shuyu 出片。
 * - 直连出片线路（BytePlus / 火山 Ark）与内容审核 2026-11-17 第 4 批删除：VIDEO_PROVIDER 只认 shuyu（缺省）
 *   与 mock（本地联调 / 测试；生产被拦）。写成别的值在解析时报错，不静默退回默认。
 *   唯一的例外是旧值 byteplus：删这批代码时生产的 Vercel 上还明写着 VIDEO_PROVIDER=byteplus
 *  （11-17 实查：健康接口报 byteplus、变量确实存在），直接报错会让下一次部署整站出不了片。
 *   所以它按 shuyu 处理并在 validateDeploymentEnv 里挂一条提醒（见 LEGACY_VIDEO_PROVIDER_ALIAS）；
 *   Vercel 上改掉之后把这个例外删了。
 *   SEEDANCE_RUNTIME_PROFILE / ARK_* / BYTEPLUS_ARK_API_KEY / CONTENT_REVIEW_* 不再读取。
 * - 国内版部署 2026-11-16 决定不做，代码已删：AI 只有 openai、存储只有 vercel_blob。
 *   AI_PROVIDER / STORAGE_PROVIDER 写成别的值（含旧的 volcengine / volcengine_tos）一律在解析时报错，
 *   不静默退回默认。REGION / DEPLOYMENT_TARGET / SMS_LOGIN_ENABLED / PAYMENT_ENABLED 不再读取。
 *
 * 校验时机：
 * - `validateDeploymentEnv()` 由健康检查 / 部署脚本主动调用。
 * - 不在模块加载时强校验，避免本地 dev / 测试时炸全场。
 */

import { shuyuApiKey } from "@/lib/providers/shuyu";

export type AiProviderId = "openai";
export type StorageProviderId = "vercel_blob";
export type VideoProviderId = "shuyu" | "mock";

export interface AppEnv {
  aiProvider: AiProviderId;
  storageProvider: StorageProviderId;
  videoProvider: VideoProviderId;
  appBaseUrl: string | null;
}

export type VideoGenerationRuntimeUnavailableReason =
  | "environment_invalid"
  | "production_mock_forbidden"
  | "shuyu_key_missing"
  | "shuyu_insufficient_balance"
  | "shuyu_unavailable";

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

const AI_PROVIDER_VALUES: AiProviderId[] = ["openai"];
const STORAGE_PROVIDER_VALUES: StorageProviderId[] = ["vercel_blob"];
const VIDEO_PROVIDER_VALUES: VideoProviderId[] = ["shuyu", "mock"];
/**
 * 已删除的直连线路留在线上的旧值。客户出片本来就只走 Shuyu（旧值在位时 buddy 线路照样放行），
 * 所以它等同于 shuyu：行为与删除前对客户完全一样，只是不再有那条没配密钥的直连默认线路。
 */
const LEGACY_VIDEO_PROVIDER_ALIAS = "byteplus";

function isLegacyVideoProviderValue(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === LEGACY_VIDEO_PROVIDER_ALIAS;
}

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

  if (!mock && app.videoProvider === "shuyu" && !shuyuApiKey(env)) {
    return { ok: false, reason: "shuyu_key_missing" };
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
  const aiDefault: AiProviderId = "openai";
  const storageDefault: StorageProviderId = "vercel_blob";
  const videoDefault: VideoProviderId = "shuyu";

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
    isLegacyVideoProviderValue(env.VIDEO_PROVIDER) ? "shuyu" : env.VIDEO_PROVIDER,
    VIDEO_PROVIDER_VALUES,
    videoDefault,
    "VIDEO_PROVIDER",
  );

  return {
    aiProvider,
    storageProvider,
    videoProvider,
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

  if (isLegacyVideoProviderValue(env.VIDEO_PROVIDER)) {
    warnings.push(
      "VIDEO_PROVIDER=byteplus 是已删除的直连线路的旧值，现在按 shuyu 处理；请在部署环境里删掉它或改成 shuyu",
    );
  }

  if (
    app.videoProvider === "shuyu" &&
    !shuyuApiKey(env) &&
    !isMockVideoRuntime(env)
  ) {
    missing.push("SHUYU_API_KEY（兼容现有 shuyu_api_key）");
  }

  if (isProductionRuntime(env) && isMockVideoRuntime(env)) {
    missing.push(
      "production runtime 禁止 mock 视频 provider（VIDEO_PROVIDER=mock、VIDEO_ENGINE_MOCK 非 false 或 AIVORA_DRY_RUN）",
    );
  }

  return { ok: missing.length === 0, missing, warnings };
}

/// 仅测试用：清缓存
export function __resetAppEnvForTests(): void {
  cached = null;
}
