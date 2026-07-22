import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { publicVideoRouteOptionsResponseSchema } from "@/lib/contracts/video-route-options";
import {
  SHUYU_VIDEO_MODEL,
  SHUYU_VIDEO_POINTS_PER_GENERATION,
  SHUYU_VIDEO_RESOLUTION,
} from "@/lib/providers/shuyu";
import { getShuyuRouteRuntimeAvailability } from "@/lib/video-generation/shuyu-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated, sanitized selector data. Raw provider balance is never sent. */
export async function GET(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  void req;
  const shuyu = await getShuyuRouteRuntimeAvailability({
    timeoutMs: 3_000,
    requiredPoints: SHUYU_VIDEO_POINTS_PER_GENERATION,
  });

  return NextResponse.json(
    publicVideoRouteOptionsResponseSchema.parse({
      ok: true,
      defaultRouteId: "buddy",
      routes: [
        {
          id: "buddy",
          provider: "shuyu",
          displayName: "合作方 Shuyu · Seedance 720P",
          model: SHUYU_VIDEO_MODEL,
          resolution: SHUYU_VIDEO_RESOLUTION,
          configured: shuyu.configured,
          funded: shuyu.funded,
          available: shuyu.available,
          unavailableReason: shuyu.reason,
        },
      ],
    }),
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
