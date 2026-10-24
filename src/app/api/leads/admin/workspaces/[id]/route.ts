import { NextResponse, type NextRequest } from "next/server";
import {
  LeadNotFoundError,
  LeadSlugError,
  leadPageAdminInputSchema,
  updateWorkspaceLeadPageAdmin,
} from "@/lib/services/lead-service";
import { internalError, invalidState, notFound, readJson, requireSuperAdmin, validationFailed } from "../../../_shared";

export const dynamic = "force-dynamic";

/**
 * PUT /api/leads/admin/workspaces/[id] —— 超管开通 / 关闭某个工作区的询盘页，
 * 设地址（保留词表 + 唯一）与允许跳转的 https 商家域名（D4）。
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = leadPageAdminInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationFailed(parsed.error);
  try {
    const workspace = await updateWorkspaceLeadPageAdmin(id, parsed.data);
    console.info("[leads:admin] lead page updated", {
      workspaceId: id,
      by: guard.session.user.id,
      enabled: workspace.leadPageEnabled,
      slug: workspace.publicSlug,
    });
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    if (error instanceof LeadSlugError) {
      if (error.reason === "taken") return invalidState("这个地址已被占用", "slug_taken");
      return validationFailed(undefined, `slug_${error.reason}`);
    }
    if (error instanceof LeadNotFoundError) return notFound("工作台不存在");
    return internalError("admin:update", error);
  }
}
