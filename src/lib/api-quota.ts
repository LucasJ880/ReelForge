import { NextResponse } from "next/server";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "@/lib/services/quota-service";
import { customerApiError } from "@/lib/contracts/customer-api";

export function quotaErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof QuotaExceededError) {
    const customerResource =
      err.resource === "VIDEO_DISPATCH" || err.resource === "SEEDANCE_SEGMENT"
        ? "VIDEO_GENERATION"
        : err.resource;
    return NextResponse.json(
      {
        ...customerApiError({
          code: "QUOTA_EXCEEDED",
          message: err.message,
          retryable: false,
          action: "view_usage",
        }),
        resource: customerResource,
        used: err.used,
        limit: err.limit,
        periodKey: err.periodKey,
      },
      { status: 429 },
    );
  }
  if (err instanceof RateLimitExceededError) {
    return NextResponse.json(
      customerApiError({
        code: "RATE_LIMITED",
        message: err.message,
        retryable: true,
        action: "retry",
      }),
      { status: 429 },
    );
  }
  return null;
}
