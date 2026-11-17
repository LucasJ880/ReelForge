import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getAppEnv,
  validateDeploymentEnv,
} from "@/lib/config/env";
import { getAiProvider } from "@/lib/ai";
import { getStorageProvider } from "@/lib/storage";
import { getVideoProvider } from "@/lib/video-generation/providers";
import {
  deploymentRelease,
  expectedMigrations,
  healthHttpStatus,
  healthResponseSchema,
  resolveSchemaSync,
  unavailableHealthResponse,
  type HealthResponse,
} from "@/lib/contracts/health";

/**
 * 健康检查 / 系统诊断接口。
 *
 * **安全约定**：
 * - 不暴露任何密钥（DATABASE_URL / API key / Access secret）
 * - 不暴露完整的 connection string
 * - storage 默认只返回 configured / not_configured，不真实做一次上传
 * - 当查询参数 `?storage=ping` 或 env `HEALTH_STORAGE_PING=true` 时，
 *   只按存储凭证是否配置回报 reachable / failed（Vercel Blob 没有免费的探测接口），
 *   不读写对象；失败时只返回固定错误码
 * - 数据库检查只做一次最便宜的 `SELECT 1`（不读业务数据）
 *
 * 默认无需鉴权（便于 Nginx / 监控系统直接拉）。
 * 如果未来需要敏感诊断字段，请新增 `/api/admin/system-health` 走鉴权路径。
 */

export const dynamic = "force-dynamic";

async function checkDatabase(): Promise<{
  status: "connected" | "failed";
}> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "connected" };
  } catch {
    return { status: "failed" };
  }
}

/**
 * 「代码比库新」核对：这次部署带的迁移是否都在 `_prisma_migrations` 里完成了。
 * 只读一列迁移名；查不了（表不存在、无权限、库不通）一律 not_checked，不拖垮健康检查。
 */
async function checkSchemaSync() {
  const expected = expectedMigrations();
  if (expected.length === 0) return resolveSchemaSync(expected, null);
  try {
    const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    return resolveSchemaSync(expected, rows.map((row) => row.migration_name));
  } catch {
    return resolveSchemaSync(expected, null);
  }
}

async function pingStorage(
  storage: ReturnType<typeof getStorageProvider>,
): Promise<{
  status: "reachable" | "failed";
  error?: "storage_unreachable" | "storage_not_configured";
}> {
  /// Vercel Blob 没有等价 ping API，只能根据 token presence 推断 → 视为 reachable
  return storage.isConfigured()
    ? { status: "reachable" }
    : { status: "failed", error: "storage_not_configured" };
}

async function resolveHealth(req: NextRequest): Promise<HealthResponse> {
  const env = getAppEnv();
  const validation = validateDeploymentEnv(process.env);

  const ai = getAiProvider();
  const storage = getStorageProvider();
  const video = getVideoProvider();

  const shouldPingStorage =
    req.nextUrl.searchParams.get("storage") === "ping" ||
    process.env.HEALTH_STORAGE_PING === "true";

  const [dbResult, schemaSync, storagePing] = await Promise.all([
    checkDatabase(),
    checkSchemaSync(),
    shouldPingStorage
      ? pingStorage(storage).catch((): {
          status: "failed";
          error: "storage_unreachable";
        } => ({
          status: "failed",
          error: "storage_unreachable",
        }))
      : Promise.resolve<{ status: "not_checked" }>({ status: "not_checked" }),
  ]);

  return healthResponseSchema.parse({
    ok: dbResult.status === "connected" && validation.ok,
    aiProvider: ai.id,
    storageProvider: storage.id,
    videoProvider: video.id,
    seedanceRuntimeProfile: env.seedanceRuntimeProfile,
    contentReviewProvider: env.contentReviewProvider,
    contentReviewEnabled: env.contentReviewEnabled,

    database: dbResult.status,
    ...(dbResult.status === "failed"
      ? { databaseError: "database_unreachable" as const }
      : {}),

    aiProviderStatus: ai.isConfigured() ? "configured" : "not_configured",
    storageProviderStatus: storage.isConfigured() ? "configured" : "not_configured",
    videoProviderStatus: video.isMockMode()
      ? "mock"
      : video.isConfigured()
        ? "configured"
        : "not_configured",

    storage:
      "status" in storagePing
        ? storagePing.status
        : ("not_checked" as const),
    ...(storagePing.status === "failed" && "error" in storagePing
      ? {
          storageError: storagePing.error,
        }
      : {}),

    envValidation: {
      ok: validation.ok,
      missing: validation.missing,
      warnings: validation.warnings,
    },

    appVersion: process.env.npm_package_version?.slice(0, 80) || null,
    release: deploymentRelease(),
    ...schemaSync,
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  let body: HealthResponse;
  try {
    body = await resolveHealth(req);
  } catch (error) {
    console.error("[health] probe failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    body = unavailableHealthResponse();
  }

  /// HTTP 状态：DB 通 + env 校验通过 → 200；否则 503（方便 Nginx upstream health 判定）
  const status = healthHttpStatus(body);
  return NextResponse.json(body, { status });
}

export const HEAD = GET;
