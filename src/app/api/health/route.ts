import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getAppEnv,
  validateChinaDeploymentEnv,
} from "@/lib/config/env";
import { getAiProvider } from "@/lib/ai";
import { getStorageProvider } from "@/lib/storage";
import { VolcengineTosStorageProvider } from "@/lib/storage/providers/volcengine-tos-provider";
import { getVideoProvider } from "@/lib/video-generation/providers";

/**
 * 健康检查 / 系统诊断接口。
 *
 * **安全约定**：
 * - 不暴露任何密钥（DATABASE_URL / API key / Access secret）
 * - 不暴露完整的 connection string
 * - storage 默认只返回 configured / not_configured，不真实做一次上传
 * - 当查询参数 `?storage=ping` 或 env `HEALTH_STORAGE_PING=true` 时，
 *   会对 TOS bucket 做一次 `headBucket` 轻量探测，不会读写对象
 * - 数据库检查只做一次最便宜的 `SELECT 1`（不读业务数据）
 *
 * 默认无需鉴权（便于 Nginx / 监控系统直接拉）。
 * 如果未来需要敏感诊断字段，请新增 `/api/admin/system-health` 走鉴权路径。
 */

export const dynamic = "force-dynamic";

interface HealthResponse {
  ok: boolean;
  region: string;
  deploymentTarget: string;
  aiProvider: string;
  storageProvider: string;
  videoProvider: string;
  contentReviewProvider: string;
  contentReviewEnabled: boolean;
  paymentEnabled: boolean;
  smsLoginEnabled: boolean;
  chinaComplianceMode: boolean;

  database: "connected" | "failed" | "not_checked";
  databaseError?: string;

  /// 仅返回 configured / not_configured / not_checked，不返回 key
  aiProviderStatus: "configured" | "not_configured";
  storageProviderStatus: "configured" | "not_configured";
  videoProviderStatus: "configured" | "not_configured" | "mock";

  /// 实际探测结果（仅 ping 模式触发）
  /// - reachable: 真实 ping 通过（TOS headBucket / Vercel Blob token 校验）
  /// - failed: 探测失败，error 字段为脱敏后的短信息
  /// - not_checked: 当前请求未触发探测（默认）
  storage: "reachable" | "failed" | "not_checked";
  storageError?: string;

  /// 中国大陆 env 校验结果
  envValidation: {
    ok: boolean;
    missing: string[];
    warnings: string[];
  };

  appVersion: string | null;
  timestamp: string;
}

async function checkDatabase(): Promise<{
  status: "connected" | "failed";
  error?: string;
}> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "connected" };
  } catch (err) {
    return {
      status: "failed",
      /// 错误信息可能包含 host：去除任何可能的 password 字段，但保留报错代号方便排查
      error: sanitizeDbError((err as Error).message),
    };
  }
}

function sanitizeDbError(msg: string): string {
  /// 1. 去 password=XXX
  /// 2. 截断 host:port 长串
  /// 3. 限制最长 300 字符
  return msg
    .replace(/password=[^&\s]+/gi, "password=***")
    .replace(/:\/\/[^@]+@/g, "://***@")
    .slice(0, 300);
}

async function pingStorage(
  storage: ReturnType<typeof getStorageProvider>,
): Promise<{ status: "reachable" | "failed"; error?: string }> {
  /// 当前仅 TOS provider 提供 pingBucket（headBucket 是免费且低延迟操作）
  /// Vercel Blob 没有等价 ping API，我们只能根据 token presence 推断 → 视为 reachable
  if (storage instanceof VolcengineTosStorageProvider) {
    const r = await storage.pingBucket();
    return r.ok
      ? { status: "reachable" }
      : { status: "failed", error: (r.error ?? "unknown").slice(0, 120) };
  }
  return storage.isConfigured()
    ? { status: "reachable" }
    : { status: "failed", error: "not configured" };
}

export async function GET(req: NextRequest) {
  const env = getAppEnv();
  const validation = validateChinaDeploymentEnv(process.env);

  const ai = getAiProvider();
  const storage = getStorageProvider();
  const video = getVideoProvider();

  const shouldPingStorage =
    req.nextUrl.searchParams.get("storage") === "ping" ||
    process.env.HEALTH_STORAGE_PING === "true";

  const [dbResult, storagePing] = await Promise.all([
    checkDatabase(),
    shouldPingStorage
      ? pingStorage(storage).catch((err): { status: "failed"; error: string } => ({
          status: "failed",
          error: (err as Error).message.slice(0, 120),
        }))
      : Promise.resolve<{ status: "not_checked" }>({ status: "not_checked" }),
  ]);

  const body: HealthResponse = {
    ok: dbResult.status === "connected" && validation.ok,
    region: env.region,
    deploymentTarget: env.deploymentTarget,
    aiProvider: ai.id,
    storageProvider: storage.id,
    videoProvider: video.id,
    contentReviewProvider: env.contentReviewProvider,
    contentReviewEnabled: env.contentReviewEnabled,
    paymentEnabled: env.paymentEnabled,
    smsLoginEnabled: env.smsLoginEnabled,
    chinaComplianceMode: env.chinaComplianceMode,

    database: dbResult.status,
    databaseError: dbResult.error,

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
    storageError:
      storagePing.status === "failed" && "error" in storagePing
        ? storagePing.error
        : undefined,

    envValidation: {
      ok: validation.ok,
      missing: validation.missing,
      warnings: validation.warnings,
    },

    appVersion: process.env.npm_package_version ?? null,
    timestamp: new Date().toISOString(),
  };

  /// HTTP 状态：DB 通 + env 校验通过 → 200；否则 503（方便 Nginx upstream health 判定）
  const status = body.ok ? 200 : 503;
  return NextResponse.json(body, { status });
}

export const HEAD = GET;
