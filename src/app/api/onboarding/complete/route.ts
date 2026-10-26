import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/contracts/customer-api";
import { completeOnboarding, isOnboardingWorkspaceMissing } from "@/lib/services/onboarding-service";

export const dynamic = "force-dynamic";

/** POST /api/onboarding/complete —— 走完或跳过上手向导（只记第一次的时间）。之后 /app 直接进创作页。 */
export async function POST() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, completedAt: await completeOnboarding(auth.session.user.id) });
  } catch (error) {
    if (isOnboardingWorkspaceMissing(error)) {
      return NextResponse.json(
        customerApiError({ code: "RESOURCE_NOT_FOUND", message: "工作台不存在", retryable: false, action: "contact_support" }),
        { status: 404 },
      );
    }
    throw error;
  }
}
