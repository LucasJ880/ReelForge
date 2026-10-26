import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import {
  runStitchDispatchTick,
  STITCH_DISPATCH_MAX_DURATION_SEC,
} from "@/lib/services/stitch-dispatch-service";
import {
  stitchDispatchFailure,
  stitchDispatchHeartbeatSchema,
  stitchDispatchSuccess,
} from "@/lib/contracts/stitch-dispatch";

/**
 * Vercel Pro 每分钟 cron：成片合成的唯一调度入口。
 *
 *   STITCH_RUNTIME=inprocess（生产默认，C3）：本函数就是合成器——按与 claimStitchTask
 *     相同的 CAS 认领就绪的 FinalVideo，在进程内跑应用内合成（ffmpeg-static + 打包的
 *     Noto Sans SC + BGM 由 next.config.ts 精确打进本函数），结果经 finishStitchTask 写回。
 *     时间预算见 runInprocessStitchTick（剩余 < 150s 不开始新任务）。
 *   STITCH_RUNTIME=external（回滚）：与改造前一致，只派发 GitHub workflow，
 *     由 runner 经 /api/internal/stitch/claim 认领。
 *   STITCH_RUNTIME=local：什么都不做（开发在触发请求里内联合成）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/// 字面量：Next 要求路由段配置可静态分析；与 STITCH_DISPATCH_MAX_DURATION_SEC 由测试锁一致
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const requestStartedAt = Date.now();
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  const heartbeat = startSchedulerHeartbeat("stitch-dispatch");

  try {
    const tick = await runStitchDispatchTick({
      startedAt: requestStartedAt,
      inprocess: { maxDurationMs: STITCH_DISPATCH_MAX_DURATION_SEC * 1000 },
    });

    if (tick.mode === "inprocess") {
      const result = tick.inprocess;
      const counters = {
        claimed: result.claimed,
        succeeded: result.succeeded,
        failed: result.failed,
        requeued: result.requeued,
        lost: result.lost,
      };
      const ran = result.outcome !== "no_pending";
      const heartbeatEvent = stitchDispatchHeartbeatSchema.parse(
        heartbeat.finish(result.outcome === "stitched_inprocess" ? "ok" : "skipped", {
          outcome: result.outcome,
          pending: result.pending,
          ...(ran ? counters : {}),
        }),
      );
      return NextResponse.json(
        stitchDispatchSuccess({
          ok: true,
          dispatched: false,
          outcome: result.outcome,
          pending: result.pending,
          ...(ran
            ? {
                inprocess: {
                  ...counters,
                  stoppedBecause: result.stoppedBecause,
                  elapsedMs: Math.max(0, Math.round(result.elapsedMs)),
                },
              }
            : {}),
          heartbeat: heartbeatEvent,
        }),
      );
    }

    const result = tick.dispatch;
    if (result.outcome === "config_missing") {
      const heartbeatEvent = stitchDispatchHeartbeatSchema.parse(
        heartbeat.finish("error", {
          outcome: result.outcome,
          pending: result.pending,
        }),
      );
      return NextResponse.json(
        stitchDispatchFailure({
          ok: false,
          code: "STITCH_DISPATCH_CONFIG_MISSING",
          error: "external stitch dispatcher unavailable",
          retryable: false,
          action: "contact_support",
          outcome: result.outcome,
          pending: result.pending,
          heartbeat: heartbeatEvent,
        }),
        { status: 503 },
      );
    }
    if (result.outcome === "github_error") {
      const heartbeatEvent = stitchDispatchHeartbeatSchema.parse(
        heartbeat.finish("error", {
          outcome: result.outcome,
          pending: result.pending,
        }),
      );
      return NextResponse.json(
        stitchDispatchFailure({
          ok: false,
          code: "STITCH_DISPATCH_UPSTREAM_ERROR",
          error: "external stitch dispatcher failed",
          retryable: true,
          action: "wait",
          outcome: result.outcome,
          pending: result.pending,
          heartbeat: heartbeatEvent,
        }),
        { status: 502 },
      );
    }

    const skipped = result.outcome !== "dispatched";
    const heartbeatEvent = stitchDispatchHeartbeatSchema.parse(
      heartbeat.finish(skipped ? "skipped" : "ok", {
        outcome: result.outcome,
        pending: result.pending,
      }),
    );
    return NextResponse.json(
      stitchDispatchSuccess({
        ok: true,
        dispatched: result.outcome === "dispatched",
        outcome: result.outcome,
        pending: result.pending,
        heartbeat: heartbeatEvent,
      }),
    );
  } catch {
    const heartbeatEvent = stitchDispatchHeartbeatSchema.parse(
      heartbeat.finish("error", {
        outcome: "internal_error",
        pending: 0,
      }),
    );
    return NextResponse.json(
      stitchDispatchFailure({
        ok: false,
        code: "STITCH_DISPATCH_INTERNAL_ERROR",
        error: "external stitch dispatcher failed",
        retryable: true,
        action: "wait",
        outcome: "internal_error",
        pending: 0,
        heartbeat: heartbeatEvent,
      }),
      { status: 500 },
    );
  }
}

export const POST = GET;
