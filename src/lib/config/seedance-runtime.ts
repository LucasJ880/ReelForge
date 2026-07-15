/**
 * Seedance runtime routing is explicit and closed over two audited profiles.
 *
 * Credentials never fall back across profiles:
 * - byteplus_international -> BYTEPLUS_ARK_API_KEY
 * - volcengine_cn_legacy   -> ARK_API_KEY
 *
 * Endpoint values are exact allowlists (a trailing slash is normalized). An
 * arbitrary proxy/custom URL is deliberately unsupported.
 */

export const BYTEPLUS_ARK_BASE_URL =
  "https://ark.ap-southeast.bytepluses.com/api/v3";
export const VOLCENGINE_CN_ARK_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/v3";

export type SeedanceRuntimeProfile =
  | "byteplus_international"
  | "volcengine_cn_legacy";

export type SeedanceRuntimeProviderId =
  | "byteplus"
  | "volcengine_cn_legacy";

const PROFILE_VALUES: readonly SeedanceRuntimeProfile[] = [
  "byteplus_international",
  "volcengine_cn_legacy",
];

export function resolveSeedanceRuntimeProfile(
  raw = process.env.SEEDANCE_RUNTIME_PROFILE,
): SeedanceRuntimeProfile {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return "byteplus_international";
  if (PROFILE_VALUES.includes(normalized as SeedanceRuntimeProfile)) {
    return normalized as SeedanceRuntimeProfile;
  }
  throw new Error(
    `[env] SEEDANCE_RUNTIME_PROFILE="${raw}" 不在允许列表 [${PROFILE_VALUES.join(", ")}] 内`,
  );
}

export function seedanceExpectedBaseUrl(
  profile: SeedanceRuntimeProfile,
): string {
  return profile === "volcengine_cn_legacy"
    ? VOLCENGINE_CN_ARK_BASE_URL
    : BYTEPLUS_ARK_BASE_URL;
}

export function seedanceCredentialEnvName(
  profile: SeedanceRuntimeProfile,
): "ARK_API_KEY" | "BYTEPLUS_ARK_API_KEY" {
  return profile === "volcengine_cn_legacy"
    ? "ARK_API_KEY"
    : "BYTEPLUS_ARK_API_KEY";
}

export function seedanceRuntimeProviderId(
  profile: SeedanceRuntimeProfile,
): SeedanceRuntimeProviderId {
  return profile === "volcengine_cn_legacy"
    ? "volcengine_cn_legacy"
    : "byteplus";
}

export function seedanceApiKey(
  profile: SeedanceRuntimeProfile,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | undefined {
  // Intentionally no `||` fallback: credentials belong to different account
  // realms and must never be silently cross-wired.
  return profile === "volcengine_cn_legacy"
    ? env.ARK_API_KEY?.trim()
    : env.BYTEPLUS_ARK_API_KEY?.trim();
}

export function seedanceDefaultModel(
  profile: SeedanceRuntimeProfile,
): string {
  return profile === "volcengine_cn_legacy"
    ? "doubao-seedance-2-0-260128"
    : "dreamina-seedance-2-0-260128";
}

export function resolveSeedanceArkBaseUrl(
  raw: string | undefined,
  profile: SeedanceRuntimeProfile,
): string {
  const expected = seedanceExpectedBaseUrl(profile);
  const value = (raw || expected).trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `ARK_BASE_URL 无效；${profile} 仅允许 ${expected}`,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin + parsed.pathname.replace(/\/+$/, "") !== expected ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `拒绝不匹配 ${profile} 的 Ark 端点；允许值仅为 ${expected}`,
    );
  }
  return expected;
}
