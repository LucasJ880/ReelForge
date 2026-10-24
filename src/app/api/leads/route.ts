import { NextResponse, type NextRequest } from "next/server";
import { createManualLead, manualLeadInputSchema } from "@/lib/services/lead-service";
import { internalError, readJson, requireLeadsWorkspace, validationFailed } from "./_shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/leads —— 手工登记一条询盘（电话、到店、熟人介绍），source=manual。
 * 与公开表单同一套 7 天去重：同一联系方式合并到原询盘，读数不被重复登记刷高。
 */
export async function POST(req: NextRequest) {
  const guard = await requireLeadsWorkspace();
  if (!guard.ok) return guard.response;
  const parsed = manualLeadInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationFailed(parsed.error);
  try {
    const result = await createManualLead(guard.workspaceId, parsed.data);
    return NextResponse.json({ ok: true, ...result }, { status: result.deduped ? 200 : 201 });
  } catch (error) {
    return internalError("manual", error);
  }
}
