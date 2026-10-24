import { NextResponse, type NextRequest } from "next/server";
import { leadPageDisplayInputSchema, updateLeadPageDisplay } from "@/lib/services/lead-service";
import { internalError, readJson, requireLeadsWorkspace, validationFailed } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * PUT /api/leads/page —— 商家改自己询盘页的展示内容（店名、标题、介绍、服务项、电话、地区、默认语言）。
 * 地址、开通状态与允许跳转的域名只归超管（/api/leads/admin/**），这里改不到。
 */
export async function PUT(req: NextRequest) {
  const guard = await requireLeadsWorkspace();
  if (!guard.ok) return guard.response;
  const parsed = leadPageDisplayInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationFailed(parsed.error);
  try {
    await updateLeadPageDisplay(guard.workspaceId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalError("page", error);
  }
}
