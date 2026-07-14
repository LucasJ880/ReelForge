import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import { verifiedTemplateSample } from "@/lib/video-generation/template-sample";

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const templates = await listActiveStyleTemplates({
    includeAcceptanceFixtures: Boolean(process.env.FINAL_ACCEPTANCE_RUN_ID),
  });
  return NextResponse.json({
    templates: templates.map((template) => ({
      ...template,
      sampleImage: verifiedTemplateSample(template.slug, template.coverImage),
    })),
  });
}
