/**
 * Video Watchdog —— 生成任务 deadline 的双信号判定（纯逻辑层，无 DB 依赖）。
 *
 * 背景（2026-07 卡死事故）：deadline 执行器此前只挂在 GitHub Actions cron 上，
 * 实际调度间隔 1~2.5 小时，导致 provider 侧僵死任务永远停在 RUNNING。
 * 本模块把判定逻辑抽成纯函数，内联进 reconcileVideoJob 的**每一次**执行路径
 * （前端 15s 轮询 / cron / 重试前检查都会经过），系统正确性不再依赖外部 cron 精度。
 * GitHub Actions cron + sweep-service 降级为纯兜底。
 *
 * 双信号（INV-1）：
 *   信号 A（硬超时）  ：now > timeoutAt + 宽限        → FAILED reason=timeout
 *   信号 B（provider 僵死）：provider 仍报 running，但其 updated_at 距 created_at
 *     从未推进，且任务已存在超过 N 分钟                → FAILED reason=provider_stalled
 *
 * 环境变量（分钟，均可配置）：
 *   VIDEO_JOB_DEADLINE_MIN   全局 deadline，默认 10（兼容旧 SEEDANCE_TIMEOUT_MIN）
 *   WATCHDOG_GRACE_MIN       信号 A 的宽限期，默认 2
 *   PROVIDER_STALL_MIN       信号 B 的僵死阈值，默认 8
 */

import type { SeedanceJobResult } from "@/lib/providers/seedance";

/// 机器可读的失败原因前缀 —— 写进 VideoJob.errorMessage 开头，
/// dispatch-breaker 与存量修复脚本按前缀识别 watchdog 失败，不再需要 schema 迁移。
export const WATCHDOG_TIMEOUT_PREFIX = "[watchdog:timeout]";
export const WATCHDOG_STALLED_PREFIX = "[watchdog:provider_stalled]";
export const WATCHDOG_FAIL_PREFIXES = [
  WATCHDOG_TIMEOUT_PREFIX,
  WATCHDOG_STALLED_PREFIX,
] as const;

export type WatchdogFailReason = "timeout" | "provider_stalled";

/// 用户可见文案（不含内部术语，测试守门）
export const WATCHDOG_TIMEOUT_USER_ERROR =
  "视频生成超时，已自动停止。点击「重试」可继续（不会重复扣费）。";
export const WATCHDOG_STALLED_USER_ERROR =
  "视频生成服务长时间无响应，已自动停止。点击「重试」重新生成。";

export function videoJobDeadlineMin(): number {
  return Number(
    process.env.VIDEO_JOB_DEADLINE_MIN ??
      process.env.SEEDANCE_TIMEOUT_MIN ??
      "10",
  );
}

export function watchdogGraceMin(): number {
  return Number(process.env.WATCHDOG_GRACE_MIN ?? "2");
}

export function providerStallMin(): number {
  return Number(process.env.PROVIDER_STALL_MIN ?? "8");
}

/**
 * 信号 A：硬超时。timeoutAt + 宽限已过仍非终态。
 * timeoutAt 为 null 的旧任务由 sweep 的 createdAt 兜底路径处理（保持既有行为）。
 */
export function isPastHardDeadline(
  job: { timeoutAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!job.timeoutAt) return false;
  return now.getTime() > job.timeoutAt.getTime() + watchdogGraceMin() * 60_000;
}

export interface ProviderStallVerdict {
  stalled: boolean;
  /// 判定依据（日志用）；stalled=false 时为 null
  detail: string | null;
}

/**
 * 信号 B：provider 僵死。
 * Seedance 原始响应里 created_at / updated_at 为 unix 秒。生产取证显示：
 * 僵死任务 status=running 且 updated_at 恒等于 created_at（从未推进）。
 * 判定：非终态 && updated_at <= created_at && 任务已存在超过 PROVIDER_STALL_MIN。
 * 原始响应快照由调用方随日志保留。
 */
export function detectProviderStall(
  result: Pick<SeedanceJobResult, "status" | "rawProviderResponse">,
  now: Date = new Date(),
): ProviderStallVerdict {
  if (result.status !== "processing" && result.status !== "pending") {
    return { stalled: false, detail: null };
  }
  const raw = result.rawProviderResponse as
    | { created_at?: unknown; updated_at?: unknown; status?: unknown }
    | null
    | undefined;
  const createdAt = typeof raw?.created_at === "number" ? raw.created_at : null;
  const updatedAt = typeof raw?.updated_at === "number" ? raw.updated_at : null;
  if (createdAt == null || updatedAt == null) {
    return { stalled: false, detail: null };
  }
  if (updatedAt > createdAt) return { stalled: false, detail: null };

  const ageSec = now.getTime() / 1000 - createdAt;
  const thresholdSec = providerStallMin() * 60;
  if (ageSec <= thresholdSec) return { stalled: false, detail: null };

  return {
    stalled: true,
    detail: `provider status=${String(raw?.status)} 已存在 ${Math.round(ageSec / 60)} 分钟且 updated_at(${updatedAt}) 从未推进(created_at=${createdAt})`,
  };
}

/**
 * AC-5 结构化状态迁移日志：(task_id, from, to, reason, ts)。
 * 单行 JSON，方便 Vercel log drain / grep evt=video_job_status_transition。
 */
export function logStatusTransition(entry: {
  taskId: string;
  from: string;
  to: string;
  reason: string;
  /// 附加上下文（如 provider 原始响应快照），会被截断到 2000 字符
  snapshot?: unknown;
}): void {
  const payload: Record<string, unknown> = {
    evt: "video_job_status_transition",
    task_id: entry.taskId,
    from: entry.from,
    to: entry.to,
    reason: entry.reason,
    ts: new Date().toISOString(),
  };
  if (entry.snapshot !== undefined) {
    try {
      payload.snapshot = JSON.stringify(entry.snapshot).slice(0, 2000);
    } catch {
      payload.snapshot = "[unserializable]";
    }
  }
  console.log(JSON.stringify(payload));
}
