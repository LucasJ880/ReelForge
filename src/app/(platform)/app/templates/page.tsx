import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import {
  TemplateLibraryGrid,
  type TemplateLibraryItem,
} from "@/components/templates/template-library-grid";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import {
  verifiedTemplateSample,
  verifiedTemplateVideo,
} from "@/lib/video-generation/template-sample";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";
import { commerceTemplateSummary } from "@/lib/video-generation/commerce-template-catalog";

export const dynamic = "force-dynamic";

export default async function PlatformTemplatesPage() {
  const [routeState, locale] = await Promise.all([
    getCustomerRouteRehearsalState("templates"),
    getServerLocale(),
  ]);
  const templates = routeState === "empty" ? [] : await listActiveStyleTemplates();
  const copy = getPlatformCopy(locale).templates;
  return (
    <div className="editorial-page-stack">
      {/* 主操作与标题同排：此前它单独占一行，白白吃掉一整屏高度。 */}
      <header className="studio-hero flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <p className="studio-label text-muted-foreground">{copy.kicker}</p>
          <h1 className="editorial-display">{copy.title}</h1>
          <p className="text-body text-muted-foreground">{copy.subtitle}</p>
        </div>
        {templates.length > 0 ? (
          <Button
            render={<Link href={`/app/batches/new?template=${encodeURIComponent(templates[0].slug)}`} />}
            variant="outline"
            className="shrink-0"
          >
            {copy.recommended}
            <ArrowRight aria-hidden />
          </Button>
        ) : null}
      </header>
      {templates.length === 0 ? (
        <section data-route-state="empty" className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">{copy.preparing}</p>
          <Button render={<Link href="/app/create" />} className="mt-5">{copy.start}<ArrowRight aria-hidden /></Button>
        </section>
      ) : <div className="min-w-0 grid grid-cols-1"><TemplateLibraryGrid templates={templates.map((template) => ({
        id: template.id,
        name: template.name,
        nameZh: template.nameZh,
        slug: template.slug,
        category: template.category,
        sampleImage: verifiedTemplateSample(template.slug, template.coverImage),
        sampleVideo: verifiedTemplateVideo(template.slug, `/template-previews/${template.slug}.mp4`),
        summary: commerceTemplateSummary(template.slug, locale),
        promptSkeleton: template.promptSkeleton,
        negativePrompt: template.negativePrompt,
        version: template.version,
        lockedParams: template.lockedParams as TemplateLibraryItem["lockedParams"],
      }))} /></div>}
    </div>
  );
}
