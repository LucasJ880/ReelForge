import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TRACKED_LINK_CHANNELS } from "@/i18n/growth-copy";
import { TrackedLinkError, createTrackedLink } from "@/lib/services/tracked-link-service";
import { internalError, invalidState, readJson, requireLeadsWorkspace, validationFailed } from "../_shared";

export const dynamic = "force-dynamic";

const createLinkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  channel: z.enum(TRACKED_LINK_CHANNELS),
  destinationUrl: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => (value ? value : null)),
});

/**
 * POST /api/leads/links —— 按渠道建一条追踪链接。
 * 询盘页未开通 → 409；外部目标不在超管登记的 https 域名里 → 400（不做开放跳转）。
 */
export async function POST(req: NextRequest) {
  const guard = await requireLeadsWorkspace();
  if (!guard.ok) return guard.response;
  const parsed = createLinkSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationFailed(parsed.error);
  try {
    const link = await createTrackedLink(guard.workspaceId, parsed.data);
    return NextResponse.json(
      {
        ok: true,
        link: {
          id: link.id,
          code: link.code,
          label: link.label,
          channel: link.channel,
          destinationUrl: link.destinationUrl,
          clickCount: link.clickCount,
          createdAt: link.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof TrackedLinkError && error.code === "LEAD_PAGE_DISABLED") {
      return invalidState(error.message, "lead_page_disabled");
    }
    if (error instanceof TrackedLinkError && error.code === "DESTINATION_NOT_ALLOWED") {
      return validationFailed(undefined, "destination_not_allowed");
    }
    return internalError("links:create", error);
  }
}
