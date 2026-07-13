/**
 * Dispatch Breaker —— 生成入口熔断器（针对「provider 整体僵死/拥堵」场景）。
 *
 * 背景（2026-07 事故）：Seedance 侧连续多小时所有任务僵死，用户额度
 * 持续被必死任务消耗。熔断器在 dispatch 前检查最近窗口内已提交任务的
 * 僵死率，超阈值时直接拒绝新任务（不扣配额、不产生计费）。
 *
 * 无状态设计：每次从 DB 现算，不依赖进程内存（Vercel serverless 多实例友好）。
 *
 * 状态机：
 *   closed          僵死率未超阈值 → 放行
 *   open            超阈值且已有在飞探测任务 → 拒绝
 *   half_open_probe 超阈值但当前无任何在飞任务 → 放行恰好 1 个探测任务；
 *                   探测成功 → 窗口内出现成功样本 → 自动回 closed；
 *                   探测再僵死 → 继续 open。
 *
 * 环境变量：
 *   DISPATCH_BREAKER_ENABLED     默认 true；显式 false 关闭（测试/演示用）
 *   DISPATCH_BREAKER_WINDOW_MIN  统计窗口，默认 60 分钟
 *   DISPATCH_BREAKER_STALL_RATE  僵死率阈值，默认 0.8
 *   DISPATCH_BREAKER_MIN_SAMPLES 最小终态样本数，默认 3
 */

import { VideoJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { WATCHDOG_FAIL_PREFIXES } from "./video-watchdog";

/// sweep-service 时代的旧超时前缀，同样计入僵死样本
const LEGACY_SWEEP_TIMEOUT_PREFIX = "sweep: job timed out";

export const BREAKER_USER_MESSAGE =
  "生成服务暂时拥堵，请稍后再试。您的额度不会被扣除。";

export type BreakerState = "closed" | "open" | "half_open_probe";

export interface BreakerDecision {
  state: BreakerState;
  allowed: boolean;
  /// 统计快照（结构化日志 & 测试断言用）
  sample: {
    windowMin: number;
    terminal: number;
    stalled: number;
    providerFailed: number;
    succeeded: number;
    inflight: number;
    stallRate: number;
    unhealthyRate: number;
  };
  reason: string;
}

function breakerEnabled(): boolean {
  const flag = process.env.DISPATCH_BREAKER_ENABLED?.toLowerCase();
  return !(flag === "0" || flag === "false" || flag === "no");
}
function windowMin(): number {
  return Number(process.env.DISPATCH_BREAKER_WINDOW_MIN ?? "60");
}
function stallRateThreshold(): number {
  return Number(
    process.env.DISPATCH_BREAKER_UNHEALTHY_RATE ??
      process.env.DISPATCH_BREAKER_STALL_RATE ??
      "0.8",
  );
}
function minSamples(): number {
  return Number(process.env.DISPATCH_BREAKER_MIN_SAMPLES ?? "3");
}

function isStalledFailure(job: {
  status: VideoJobStatus;
  errorMessage: string | null;
}): boolean {
  if (job.status !== VideoJobStatus.FAILED) return false;
  const msg = job.errorMessage ?? "";
  return (
    WATCHDOG_FAIL_PREFIXES.some((p) => msg.startsWith(p)) ||
    msg.startsWith(LEGACY_SWEEP_TIMEOUT_PREFIX)
  );
}

/**
 * dispatch 入口调用：决定是否放行本次生成请求。
 * 半开探测的并发竞态（两个请求同时看到 inflight=0）可接受——
 * 最多多放行一两个探测任务，不影响正确性，日志可追溯。
 */
export async function evaluateDispatchBreaker(
  now: Date = new Date(),
): Promise<BreakerDecision> {
  const win = windowMin();
  if (!breakerEnabled()) {
    return {
      state: "closed",
      allowed: true,
      sample: {
        windowMin: win,
        terminal: 0,
        stalled: 0,
        providerFailed: 0,
        succeeded: 0,
        inflight: 0,
        stallRate: 0,
        unhealthyRate: 0,
      },
      reason: "breaker disabled by env",
    };
  }

  const since = new Date(now.getTime() - win * 60_000);
  const recent = await db.videoJob.findMany({
    where: {
      submittedAt: { gte: since },
      externalJobId: { not: null },
    },
    select: { status: true, errorMessage: true },
    take: 200,
  });

  const terminalJobs = recent.filter(
    (j) =>
      j.status === VideoJobStatus.SUCCEEDED ||
      j.status === VideoJobStatus.FAILED,
  );
  const stalled = terminalJobs.filter(isStalledFailure).length;
  const providerFailed = terminalJobs.filter(
    (job) => job.errorMessage?.startsWith("[provider:failed]") ?? false,
  ).length;
  const succeeded = recent.filter(
    (j) => j.status === VideoJobStatus.SUCCEEDED,
  ).length;
  const inflight = recent.filter(
    (j) =>
      j.status === VideoJobStatus.QUEUED || j.status === VideoJobStatus.RUNNING,
  ).length;
  const terminal = terminalJobs.length;
  const stallRate = terminal > 0 ? stalled / terminal : 0;
  const unhealthyRate =
    terminal > 0 ? (stalled + providerFailed) / terminal : 0;

  const sample = {
    windowMin: win,
    terminal,
    stalled,
    providerFailed,
    succeeded,
    inflight,
    stallRate,
    unhealthyRate,
  };

  let decision: BreakerDecision;
  if (terminal < minSamples() || unhealthyRate < stallRateThreshold()) {
    decision = {
      state: "closed",
      allowed: true,
      sample,
      reason: `unhealthyRate=${unhealthyRate.toFixed(2)} < ${stallRateThreshold()} 或样本不足(${terminal}/${minSamples()})`,
    };
  } else if (inflight === 0) {
    decision = {
      state: "half_open_probe",
      allowed: true,
      sample,
      reason: `异常率 ${unhealthyRate.toFixed(2)} 超阈值但无在飞任务 → 放行 1 个探测任务`,
    };
  } else {
    decision = {
      state: "open",
      allowed: false,
      sample,
      reason: `异常率 ${unhealthyRate.toFixed(2)} 超阈值且已有 ${inflight} 个在飞任务（含探测）→ 拒绝`,
    };
  }

  /// 结构化日志：closed 且无异常样本时静默，避免每次 dispatch 刷屏
  if (decision.state !== "closed" || stalled > 0) {
    console.log(
      JSON.stringify({
        evt: "dispatch_breaker",
        state: decision.state,
        allowed: decision.allowed,
        ...decision.sample,
        reason: decision.reason,
        ts: now.toISOString(),
      }),
    );
  }
  return decision;
}
