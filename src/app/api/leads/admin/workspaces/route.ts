import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { findLeadPageWorkspaceByOwnerEmail } from "@/lib/services/lead-service";
import { internalError, notFound, requireSuperAdmin, validationFailed } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET /api/leads/admin/workspaces?email= —— 超管按账号邮箱查工作区的询盘页设置。 */
export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const parsed = z.string().trim().email().max(254).safeParse(req.nextUrl.searchParams.get("email") ?? "");
  if (!parsed.success) return validationFailed(parsed.error, "email_invalid");
  try {
    const workspace = await findLeadPageWorkspaceByOwnerEmail(parsed.data);
    if (!workspace) return notFound("没找到这个账号");
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return internalError("admin:lookup", error);
  }
}
