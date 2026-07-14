import { NextResponse } from "next/server";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "@/lib/services/quota-service";

export function quotaErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof QuotaExceededError) {
    const customerResource =
      err.resource === "VIDEO_DISPATCH" || err.resource === "SEEDANCE_SEGMENT"
        ? "VIDEO_GENERATION"
        : err.resource;
    return NextResponse.json(
      {
        ok: false,
        code: err.code,
        error: err.message,
        resource: customerResource,
        used: err.used,
        limit: err.limit,
        periodKey: err.periodKey,
        retryable: false,
        action: "view_usage",
      },
      { status: 429 },
    );
  }
  if (err instanceof RateLimitExceededError) {
    return NextResponse.json(
      {
        ok: false,
        code: err.code,
        error: err.message,
        retryable: true,
        action: "retry",
      },
      { status: 429 },
    );
  }
  return null;
}
