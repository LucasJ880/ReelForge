import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/contracts/customer-api";
import { getServerLocale } from "@/i18n/server";
import {
  businessProfileInputSchema,
  isOnboardingWorkspaceMissing,
  loadOnboardingState,
  updateBusinessProfile,
} from "@/lib/services/onboarding-service";

export const dynamic = "force-dynamic";

function workspaceMissing() {
  return NextResponse.json(
    customerApiError({ code: "RESOURCE_NOT_FOUND", message: "工作台不存在", retryable: false, action: "contact_support" }),
    { status: 404 },
  );
}

/** GET /api/onboarding —— 上手向导四步的真实状态（从档案、品牌包、成片、询盘页推出来）。 */
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ state: await loadOnboardingState(auth.session.user.id, await getServerLocale()) });
  } catch (error) {
    if (isOnboardingWorkspaceMissing(error)) return workspaceMissing();
    throw error;
  }
}

/** PUT /api/onboarding —— 第 1 步：店名、行业、城市、网站、一句话介绍。 */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const parsed = businessProfileInputSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json(
      customerApiError({ code: "VALIDATION_FAILED", message: "参数不合法", retryable: false, action: "fix_request" }),
      { status: 400 },
    );
  }
  try {
    const profile = await updateBusinessProfile(auth.session.user.id, parsed.data);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (isOnboardingWorkspaceMissing(error)) return workspaceMissing();
    throw error;
  }
}
