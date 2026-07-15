import { z } from "zod";

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
    timestamp: z.string().datetime(),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
    timestamp: now.toISOString(),
  });
}
