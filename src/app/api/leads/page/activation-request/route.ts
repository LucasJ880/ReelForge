import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/contracts/customer-api";
import { runAfterResponse } from "@/lib/services/notification-service";
import {
  isOnboardingWorkspaceMissing,
  notifyLeadPageActivationRequest,
  requestLeadPageActivation,
} from "@/lib/services/onboarding-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/leads/page/activation-request —— 商家申请开通询盘页。
 * 只记时间、提醒创始人；开通与地址仍归超管（/api/leads/admin/**）。重复点不重复提醒。
 */
export async function POST() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    const result = await requestLeadPageActivation(auth.session.user.id);
    if (!result.alreadyRequested && !result.alreadyEnabled) {
      const userId = auth.session.user.id;
      runAfterResponse(() => notifyLeadPageActivationRequest(userId));
    }
    return NextResponse.json({ ok: true, ...result });
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
