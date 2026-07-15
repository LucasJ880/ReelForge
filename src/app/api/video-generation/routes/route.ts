import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { isMockVideoRuntime } from "@/lib/config/env";
import { resolveSeedanceRuntimeProfile } from "@/lib/config/seedance-runtime";
import { publicVideoRouteOptionsResponseSchema } from "@/lib/contracts/video-route-options";
import {
  SHUYU_VIDEO_MODEL,
  SHUYU_VIDEO_POINTS_PER_SECOND,
  SHUYU_VIDEO_RESOLUTION,
} from "@/lib/providers/shuyu";
import {
  createVideoRouteSnapshot,
  getVideoRouteContract,
} from "@/lib/video-generation/video-route-registry";
import {
  isVideoRouteSnapshotRuntimeReady,
} from "@/lib/video-generation/video-route-selection";
import { getShuyuRouteRuntimeAvailability } from "@/lib/video-generation/shuyu-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated, sanitized selector data. Raw provider balance is never sent. */
export async function GET(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const directRouteId = resolveSeedanceRuntimeProfile(
    process.env.SEEDANCE_RUNTIME_PROFILE,
  );
  const mockMode = isMockVideoRuntime();
  const directRouteIds = isInternalRole(guard.session.user.role)
    ? (["byteplus_international", "volcengine_cn_legacy"] as const)
    : [directRouteId];
  const directRoutes = directRouteIds.map((routeId) => {
    const contract = getVideoRouteContract(routeId);
    const available = routeId === directRouteId && mockMode
      ? true
      : isVideoRouteSnapshotRuntimeReady(createVideoRouteSnapshot(routeId));
    return {
      id: routeId,
      provider: "direct" as const,
      displayName: routeId === "volcengine_cn_legacy"
        ? "火山北京 Seedance 直连"
        : "BytePlus Seedance 直连",
      model: contract.model,
      resolution: null,
      configured: available,
      funded: null,
      available,
      unavailableReason: available ? null : "not_configured" as const,
    };
  });
  const requestedDuration = Number(req.nextUrl.searchParams.get("duration"));
  const duration = [15, 30, 60].includes(requestedDuration)
    ? requestedDuration
    : 15;
  const shuyu = await getShuyuRouteRuntimeAvailability({
    timeoutMs: 3_000,
    requiredPoints: duration * SHUYU_VIDEO_POINTS_PER_SECOND,
  });

  return NextResponse.json(
    publicVideoRouteOptionsResponseSchema.parse({
      ok: true,
      defaultRouteId: directRouteId,
      routes: [
        ...directRoutes,
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
