import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import { dispatchExternalStitchRunner } from "@/lib/services/stitch-dispatch-service";

/**
 * Vercel Pro minute cron coordinator for the external ffmpeg runner.
 * It never claims a FinalVideo itself: it only detects ready work and safely
 * dispatches the existing GitHub workflow, whose internal claim endpoint owns
 * the PENDING -> STITCHING CAS.
 */
export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  const heartbeat = startSchedulerHeartbeat("stitch-dispatch");

  try {
    const result = await dispatchExternalStitchRunner();
    if (result.outcome === "config_missing") {
      const heartbeatEvent = heartbeat.finish("error", {
        outcome: result.outcome,
        pending: result.pending,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "external stitch dispatcher unavailable",
          heartbeat: heartbeatEvent,
        },
        { status: 503 },
      );
    }
    if (result.outcome === "github_error") {
      const heartbeatEvent = heartbeat.finish("error", {
        outcome: result.outcome,
        pending: result.pending,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "external stitch dispatcher failed",
          heartbeat: heartbeatEvent,
        },
        { status: 502 },
      );
    }

    const skipped = result.outcome !== "dispatched";
    const heartbeatEvent = heartbeat.finish(skipped ? "skipped" : "ok", {
      outcome: result.outcome,
      pending: result.pending,
    });
    return NextResponse.json({
      ok: true,
      dispatched: result.outcome === "dispatched",
      outcome: result.outcome,
      pending: result.pending,
      heartbeat: heartbeatEvent,
    });
  } catch {
    const heartbeatEvent = heartbeat.finish("error", {
      outcome: "internal_error",
      pending: 0,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "external stitch dispatcher failed",
        heartbeat: heartbeatEvent,
      },
      { status: 500 },
    );
  }
}

export const POST = GET;
