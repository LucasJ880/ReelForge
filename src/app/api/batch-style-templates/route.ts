import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  batchStyleTemplateDto,
  batchStyleTemplatesSuccessSchema,
} from "@/lib/contracts/batch-style-templates";
import { customerApiError } from "@/lib/contracts/customer-api";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import { verifiedTemplateSample } from "@/lib/video-generation/template-sample";

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  try {
    const templates = await listActiveStyleTemplates({
      includeAcceptanceFixtures: Boolean(process.env.FINAL_ACCEPTANCE_RUN_ID),
    });
    return NextResponse.json(
      batchStyleTemplatesSuccessSchema.parse({
        ok: true,
        templates: templates.map((template) =>
          batchStyleTemplateDto(
            template,
            verifiedTemplateSample(template.slug, template.coverImage),
          ),
        ),
      }),
    );
  } catch (error) {
    console.error("[batch-style-templates] list failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      customerApiError({
        code: "SERVICE_UNAVAILABLE",
        message: "风格模板暂时无法加载，请稍后重试。",
        retryable: true,
        action: "retry",
      }),
      { status: 503 },
    );
  }
}
