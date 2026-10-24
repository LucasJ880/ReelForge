import { NextResponse } from "next/server";
import { customerApiError } from "@/lib/contracts/customer-api";
import { RateLimitExceededError } from "@/lib/services/rate-limit-service";

/**
 * 限流超限 → 429 RATE_LIMITED（retryable + retry）。与 quotaErrorResponse 的限流分支同形，
 * 单独成文件是为了让「不计费」的入口（内容计划、出图……）只依赖限流、不依赖额度计量：
 * 限流不是收费（C2 定价门禁守着这些路由不出现任何额度 / 扣费调用）。
 */
export function rateLimitedResponse(err: unknown): NextResponse | null {
  if (!(err instanceof RateLimitExceededError)) return null;
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
