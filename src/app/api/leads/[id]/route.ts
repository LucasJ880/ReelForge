import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  LeadConflictError,
  LeadNotFoundError,
  archiveLead,
  setLeadVerified,
  transitionLeadStatus,
} from "@/lib/services/lead-service";
import { LEAD_STATUSES } from "@/i18n/growth-copy";
import {
  internalError,
  invalidState,
  notFound,
  readJson,
  requireLeadsWorkspace,
  validationFailed,
} from "../_shared";

export const dynamic = "force-dynamic";

/// 一次只做一件事：改状态、核实 / 取消核实、或归档（归档不可在这里撤销，记录保留）。
const leadPatchSchema = z.union([
  z.object({ status: z.enum(LEAD_STATUSES) }).strict(),
  z.object({ verified: z.boolean() }).strict(),
  z.object({ archived: z.literal(true) }).strict(),
]);

/**
 * PATCH /api/leads/[id] —— 状态流转（写 contactedAt / bookedAt / wonAt）、核实、归档。
 * 只能改本人工作区的询盘；状态写入是 CAS，并发改动回 409 让界面刷新。
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireLeadsWorkspace();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = leadPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationFailed(parsed.error);
  try {
    const body = parsed.data;
    if ("status" in body) await transitionLeadStatus(guard.workspaceId, id, body.status);
    else if ("verified" in body) await setLeadVerified(guard.workspaceId, id, body.verified);
    else await archiveLead(guard.workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return notFound("询盘不存在或已归档");
    if (error instanceof LeadConflictError) return invalidState("询盘刚被改过，请刷新后再试", "conflict");
    return internalError("patch", error);
  }
}
