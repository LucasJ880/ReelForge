/**
 * 统一环境变量解析 + 校验。
 *
 * 设计目标：
 * - 业务代码 / provider 抽象层都从这里读 region / deployment / provider 路由，
 *   不要再到处 `process.env.AI_PROVIDER ?? "openai"`。
 * - 中国大陆模式下缺关键 env 时给出清晰错误（避免运行到一半才报）。
 * - **绝不修改 process.env 本身**；只读 + 解析 + 缓存。
 * - 海外默认行为（不设任何 PROVIDER 变量）必须等同于改造前：openai / vercel_blob / 即梦视频。
 *
 * 校验时机：
 * - `validateChinaDeploymentEnv()` 由健康检查 / 部署脚本主动调用。
 * - 不在模块加载时强校验，避免本地 dev / 测试时炸全场。
 */

export type Region = "global" | "cn";
export type DeploymentTarget = "vercel" | "china" | "selfhosted";
export type AiProviderId = "openai" | "volcengine";
export type StorageProviderId = "vercel_blob" | "volcengine_tos";
export type VideoProviderId = "volcengine" | "mock";
export type ContentReviewProviderId = "noop" | "volcengine";

export interface AppEnv {
  region: Region;
  deploymentTarget: DeploymentTarget;
  aiProvider: AiProviderId;
  storageProvider: StorageProviderId;
  videoProvider: VideoProviderId;
  contentReviewProvider: ContentReviewProviderId;
  contentReviewEnabled: boolean;
  paymentEnabled: boolean;
  smsLoginEnabled: boolean;
  chinaComplianceMode: boolean;
  cdnBaseUrl: string | null;
  appBaseUrl: string | null;
}

const REGION_VALUES: Region[] = ["global", "cn"];
const DEPLOYMENT_VALUES: DeploymentTarget[] = ["vercel", "china", "selfhosted"];
const AI_PROVIDER_VALUES: AiProviderId[] = ["openai", "volcengine"];
const STORAGE_PROVIDER_VALUES: StorageProviderId[] = [
  "vercel_blob",
  "volcengine_tos",
];
const VIDEO_PROVIDER_VALUES: VideoProviderId[] = ["volcengine", "mock"];
const REVIEW_PROVIDER_VALUES: ContentReviewProviderId[] = ["noop", "volcengine"];

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
  const region = parseEnum<Region>(env.REGION, REGION_VALUES, "global", "REGION");
  /// 默认推导：REGION=cn → china；否则 vercel
  const deploymentDefault: DeploymentTarget = region === "cn" ? "china" : "vercel";
  const deploymentTarget = parseEnum<DeploymentTarget>(
    env.DEPLOYMENT_TARGET,
    DEPLOYMENT_VALUES,
    deploymentDefault,
    "DEPLOYMENT_TARGET",
  );

  /// Provider 默认：region=cn → 全部走火山；否则保持 openai / vercel_blob
  const aiDefault: AiProviderId = region === "cn" ? "volcengine" : "openai";
  const storageDefault: StorageProviderId =
    region === "cn" ? "volcengine_tos" : "vercel_blob";
  const videoDefault: VideoProviderId = "volcengine";

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

  const contentReviewProvider = parseEnum<ContentReviewProviderId>(
    env.CONTENT_REVIEW_PROVIDER,
    REVIEW_PROVIDER_VALUES,
    "noop",
    "CONTENT_REVIEW_PROVIDER",
  );

  const chinaComplianceMode =
    region === "cn" || parseBool(env.CHINA_COMPLIANCE_MODE, false);

  return {
    region,
    deploymentTarget,
    aiProvider,
    storageProvider,
    videoProvider,
    contentReviewProvider,
    contentReviewEnabled: parseBool(env.CONTENT_REVIEW_ENABLED, false),
    paymentEnabled: parseBool(env.PAYMENT_ENABLED, !chinaComplianceMode),
    smsLoginEnabled: parseBool(env.SMS_LOGIN_ENABLED, false),
    chinaComplianceMode,
    cdnBaseUrl: env.CDN_BASE_URL?.trim() || null,
    appBaseUrl: (env.APP_BASE_URL || env.NEXT_PUBLIC_APP_URL)?.trim() || null,
  };
}

/**
 * 中国大陆部署校验：region=cn 时必须有的 env。
 * 返回 missing 列表（空 = 校验通过）。
 *
 * 不抛错，由调用方决定是 throw 还是 warn 还是写 health endpoint。
 */
export function validateChinaDeploymentEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { ok: boolean; missing: string[]; warnings: string[] } {
  const app = parseAppEnv(env);
  const missing: string[] = [];
  const warnings: string[] = [];

  if (app.region !== "cn") {
    return { ok: true, missing: [], warnings: [] };
  }

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

  if (app.videoProvider === "volcengine") {
    if (!env.ARK_API_KEY && env.VIDEO_ENGINE_MOCK !== "true") {
      warnings.push(
        "ARK_API_KEY 未配置且 VIDEO_ENGINE_MOCK 未启用 → 真实视频生成会失败（请配置 ARK_API_KEY 或设 VIDEO_ENGINE_MOCK=true）",
      );
    }
  }

  if (app.contentReviewEnabled && app.contentReviewProvider === "noop") {
    warnings.push(
      "CONTENT_REVIEW_ENABLED=true 但 CONTENT_REVIEW_PROVIDER=noop → 等同于未启用审核",
    );
  }

  return { ok: missing.length === 0, missing, warnings };
}

/// 仅测试用：清缓存
export function __resetAppEnvForTests(): void {
  cached = null;
}
