import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { internalVideoProviderRoutesResponseSchema } from "@/lib/contracts/video-provider-routes";
import { machineAuthFailure } from "@/lib/machine-auth";
import {
  buddyVideoProviderRoute,
  discoverBuddyApiContract,
  discoverBuddyModels,
} from "@/lib/server/buddy-route-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal-only, read-only provider route discovery.
 * This endpoint never submits a video and never returns credentials or raw
 * upstream response fields.
 */
export async function GET(req: NextRequest) {
  // A valid machine credential is sufficient on its own. If machine auth is
  // absent or invalid, fall back to the staff session guard. This ordering
  // avoids session/database work for scheduled probes while still allowing an
  // operator to use the endpoint when CRON_SECRET is intentionally absent in
  // a local environment.
  const machineFailure = machineAuthFailure(req);
  if (machineFailure) {
    const auth = await requireOperator();
    if (!auth.ok) {
      return req.headers.has("authorization")
        ? machineFailure
        : auth.response;
    }
  }

  const [discovery, contract] = await Promise.all([
    discoverBuddyModels(),
    discoverBuddyApiContract(),
  ]);
  return NextResponse.json(
    internalVideoProviderRoutesResponseSchema.parse({
      ok: true,
      routes: [buddyVideoProviderRoute(discovery, contract)],
    }),
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}
