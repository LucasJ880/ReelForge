import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TrackedLinkError, archiveTrackedLink } from "@/lib/services/tracked-link-service";
import { internalError, notFound, readJson, requireLeadsWorkspace, validationFailed } from "../../_shared";

export const dynamic = "force-dynamic";

const patchLinkSchema = z.object({ archived: z.literal(true) }).strict();

/** PATCH /api/leads/links/[id] —— 停用（归档）一条追踪链接；点击记录保留。 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireLeadsWorkspace();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = patchLinkSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationFailed(parsed.error);
  try {
    await archiveTrackedLink(guard.workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TrackedLinkError && error.code === "NOT_FOUND") return notFound(error.message);
    return internalError("links:archive", error);
  }
}
