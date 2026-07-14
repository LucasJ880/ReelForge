import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Shared fail-closed guard for cron and external-runner endpoints.
 * Returns a response on failure; callers must return it before parsing input
 * or invoking any queue/database service.
 */
export function machineAuthFailure(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "service unavailable" },
      { status: 503 },
    );
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (!constantTimeEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export const __test__ = { constantTimeEqual };
