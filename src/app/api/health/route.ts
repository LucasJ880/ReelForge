import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getAppEnv,
  validateDeploymentEnv,
} from "@/lib/config/env";
import { getAiProvider } from "@/lib/ai";
import { getStorageProvider } from "@/lib/storage";
import { VolcengineTosStorageProvider } from "@/lib/storage/providers/volcengine-tos-provider";
import { getVideoProvider } from "@/lib/video-generation/providers";
import {
  healthHttpStatus,
  healthResponseSchema,
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
 *   会对 TOS bucket 做一次 `headBucket` 轻量探测，不会读写对象；失败时
 *   只返回固定错误码，不回传 SDK / connection error 文本
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

async function pingStorage(
  storage: ReturnType<typeof getStorageProvider>,
): Promise<{
  status: "reachable" | "failed";
  error?: "storage_unreachable" | "storage_not_configured";
}> {
  /// 当前仅 TOS provider 提供 pingBucket（headBucket 是免费且低延迟操作）
  /// Vercel Blob 没有等价 ping API，我们只能根据 token presence 推断 → 视为 reachable
  if (storage instanceof VolcengineTosStorageProvider) {
    const r = await storage.pingBucket();
    return r.ok
      ? { status: "reachable" }
      : { status: "failed", error: "storage_unreachable" };
  }
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

  const [dbResult, storagePing] = await Promise.all([
    checkDatabase(),
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
    region: env.region,
    deploymentTarget: env.deploymentTarget,
    aiProvider: ai.id,
    storageProvider: storage.id,
    videoProvider: video.id,
    seedanceRuntimeProfile: env.seedanceRuntimeProfile,
    contentReviewProvider: env.contentReviewProvider,
    contentReviewEnabled: env.contentReviewEnabled,
    paymentEnabled: env.paymentEnabled,
    smsLoginEnabled: env.smsLoginEnabled,

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
