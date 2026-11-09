import { z } from "zod";

const RELEASE_PATTERN = /^[0-9a-f]{7,40}$/;
const MIGRATION_NAME_PATTERN = /^\d{8,14}_[a-z0-9_]+$/;

/** 库结构是否跟得上这次部署的代码：in_sync 全部迁移已执行；behind 有迁移没执行；not_checked 核对不了。 */
export const schemaSyncStatuses = ["in_sync", "behind", "not_checked"] as const;
export type SchemaSyncStatus = (typeof schemaSyncStatuses)[number];

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
    /// 「代码比库新」发布闸：这次部署带的迁移是否都已在库里执行。只报状态与条数，不报迁移名
    schema: z.enum(schemaSyncStatuses).optional(),
    pendingMigrations: z.number().int().min(0).max(999).optional(),
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

/**
 * 构建时内联的迁移名清单（next.config.ts 的 env.AIVORA_EXPECTED_MIGRATIONS）；格式不对的条目一律丢弃。
 * 默认值必须字面写 `process.env.AIVORA_EXPECTED_MIGRATIONS`：next.config 的 env 只做构建期字面替换，
 * 运行时的 process.env 里没有这个键（与 session-policy 读 AIVORA_SESSION_RELEASE 同理）。
 */
export function expectedMigrations(raw: string | undefined = process.env.AIVORA_EXPECTED_MIGRATIONS): string[] {
  return (raw ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => MIGRATION_NAME_PATTERN.test(name));
}

/**
 * 代码带的迁移 vs 库里已完成的迁移。
 * 库里多出来的行不算问题（历史迁移本地已归并）；代码带的任何一条没执行就是 behind。
 * 拿不到清单（本地构建）或查不了库（applied = null）→ not_checked，不误报。
 */
export function resolveSchemaSync(
  expected: readonly string[],
  applied: readonly string[] | null,
): { schema: SchemaSyncStatus; pendingMigrations?: number } {
  if (expected.length === 0 || applied === null) return { schema: "not_checked" };
  const done = new Set(applied);
  const pending = expected.filter((name) => !done.has(name)).length;
  return pending === 0
    ? { schema: "in_sync", pendingMigrations: 0 }
    : { schema: "behind", pendingMigrations: Math.min(pending, 999) };
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
