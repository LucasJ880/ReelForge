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

export const dynamic = "force-dynamic";

export default async function PlatformTemplatesPage() {
  const [templates, locale] = await Promise.all([listActiveStyleTemplates().catch(() => []), getServerLocale()]);
  const copy = getPlatformCopy(locale).templates;
  return (
    <div className="editorial-page-stack">
      <header className="studio-hero max-w-5xl space-y-3">
        <p className="studio-label text-muted-foreground">{copy.kicker}</p>
        <h1 className="editorial-display">{copy.title}</h1>
        <p className="max-w-3xl text-body text-muted-foreground">{copy.subtitle}</p>
      </header>
      {templates.length > 0 ? <div className="flex justify-end"><Button render={<Link href={`/app/batches/new?template=${encodeURIComponent(templates[0].id)}`} />} variant="outline">{copy.recommended}<ArrowRight aria-hidden /></Button></div> : null}
      {templates.length === 0 ? (
        <section className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">{copy.preparing}</p>
          <Button render={<Link href="/app/create" />} className="mt-5">{copy.start}<ArrowRight aria-hidden /></Button>
        </section>
      ) : <div className="min-w-0 grid grid-cols-1"><TemplateLibraryGrid templates={templates.map((template) => ({
        id: template.id,
        name: template.name,
        nameZh: template.nameZh,
        slug: template.slug,
        category: template.category,
        coverImage: template.coverImage,
        version: template.version,
        lockedParams: template.lockedParams as TemplateLibraryItem["lockedParams"],
      }))} /></div>}
    </div>
  );
}
