import { NextResponse } from "next/server";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "@/lib/services/quota-service";

export function quotaErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof QuotaExceededError) {
    return NextResponse.json(
      {
        ok: false,
        code: err.code,
        error: err.message,
        resource: err.resource,
        used: err.used,
        limit: err.limit,
        periodKey: err.periodKey,
      },
      { status: 429 },
    );
  }
  if (err instanceof RateLimitExceededError) {
    return NextResponse.json(
      { ok: false, code: err.code, error: err.message },
      { status: 429 },
    );
  }
  return null;
}
