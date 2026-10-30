import { z } from "zod";

const RELEASE_PATTERN = /^[0-9a-f]{7,40}$/;

const providerConfigurationSchema = z.enum([
  "configured",
  "not_configured",
]);

export const healthResponseSchema = z
  .object({
    ok: z.boolean(),
    region: z.enum(["na", "future", "unknown"]),
    deploymentTarget: z.enum(["vercel", "selfhosted", "unknown"]),
    aiProvider: z.enum(["openai", "volcengine", "unknown"]),
    storageProvider: z.enum([
      "vercel_blob",
      "volcengine_tos",
      "unknown",
    ]),
    videoProvider: z.string().min(1).max(80),
    seedanceRuntimeProfile: z.enum([
      "byteplus_international",
      "volcengine_cn_legacy",
      "unknown",
    ]),
    contentReviewProvider: z.enum([
      "noop",
      "openai_moderation",
      "unknown",
    ]),
    contentReviewEnabled: z.boolean(),
    paymentEnabled: z.boolean(),
    smsLoginEnabled: z.boolean(),
    database: z.enum(["connected", "failed", "not_checked"]),
    databaseError: z.literal("database_unreachable").optional(),
    aiProviderStatus: providerConfigurationSchema,
    storageProviderStatus: providerConfigurationSchema,
    videoProviderStatus: z.enum([
      "configured",
      "not_configured",
      "mock",
    ]),
    storage: z.enum(["reachable", "failed", "not_checked"]),
    storageError: z
      .enum(["storage_unreachable", "storage_not_configured"])
      .optional(),
    envValidation: z
      .object({
        ok: z.boolean(),
        missing: z.array(z.string().min(1).max(240)),
        warnings: z.array(z.string().min(1).max(240)),
      })
      .strict(),
    appVersion: z.string().min(1).max(80).nullable(),
    /// 正在提供服务的那次部署的 git commit：发布后冒烟据此确认生产别名已切到新部署再开测
    release: z.string().regex(RELEASE_PATTERN).nullable().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Vercel 注入的部署 commit（VERCEL_GIT_COMMIT_SHA）；本地 / 自建没有就是 null。
 * 仓库公开，commit 不算敏感信息；但只放行十六进制 SHA，别的值一律不回显。
 */
export function deploymentRelease(env: Record<string, string | undefined> = process.env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  return sha && RELEASE_PATTERN.test(sha) ? sha : null;
}

export function healthHttpStatus(body: HealthResponse): 200 | 503 {
  return body.ok ? 200 : 503;
}

/**
 * Configuration parsing can itself fail. The public health endpoint must still
 * return a schema-valid, value-free response rather than a framework 500.
 */
export function unavailableHealthResponse(now = new Date()): HealthResponse {
  return healthResponseSchema.parse({
    ok: false,
    region: "unknown",
    deploymentTarget: "unknown",
    aiProvider: "unknown",
    storageProvider: "unknown",
    videoProvider: "unknown",
    seedanceRuntimeProfile: "unknown",
    contentReviewProvider: "unknown",
    contentReviewEnabled: false,
    paymentEnabled: false,
    smsLoginEnabled: false,
    database: "not_checked",
    aiProviderStatus: "not_configured",
    storageProviderStatus: "not_configured",
    videoProviderStatus: "not_configured",
    storage: "not_checked",
    envValidation: {
      ok: false,
      missing: ["runtime_configuration"],
      warnings: [],
    },
    appVersion: process.env.npm_package_version?.slice(0, 80) || null,
    release: deploymentRelease(),
    timestamp: now.toISOString(),
  });
}
