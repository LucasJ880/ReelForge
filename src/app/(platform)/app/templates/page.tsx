import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import {
  TemplateLibraryGrid,
  type TemplateLibraryItem,
} from "@/components/templates/template-library-grid";
import { parseTemplateShots } from "@/components/templates/template-shot-timeline";
import { TEMPLATE_LIBRARY_COPY, fillCount } from "@/components/templates/template-library-copy";
import { QuoteHeader } from "@/components/exchange/quote-header";
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

const USAGE_WINDOW_DAYS = 30;

type TemplateUsage = {
  /// slug → 批次数：同一个模板的历史版本（已归档）也算在这个 slug 上
  bySlug: Map<string, number>;
  batches: number;
  requested: number;
  completed: number;
};

const NO_USAGE: TemplateUsage = { bySlug: new Map(), batches: 0, requested: 0, completed: 0 };

function usageWindowStart(): Date {
  return new Date(Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** 本人近 30 天按模板建了多少批次、下单与成交多少条（只读本工作区，不含样片库）。 */
async function loadTemplateUsage(userId: string): Promise<TemplateUsage> {
  const groups = await db.batchJob.groupBy({
    by: ["templateId"],
    where: { userId, createdAt: { gte: usageWindowStart() } },
    _count: { _all: true },
    _sum: { requestedCount: true, completedCount: true },
  });
  if (groups.length === 0) return NO_USAGE;
  const templates = await db.styleTemplate.findMany({
    where: { id: { in: groups.map((group) => group.templateId) } },
    select: { id: true, slug: true },
  });
  const slugById = new Map(templates.map((template) => [template.id, template.slug]));
  const bySlug = new Map<string, number>();
  for (const group of groups) {
    const slug = slugById.get(group.templateId);
    if (slug) bySlug.set(slug, (bySlug.get(slug) ?? 0) + group._count._all);
  }
  return {
    bySlug,
    batches: groups.reduce((sum, group) => sum + group._count._all, 0),
    requested: groups.reduce((sum, group) => sum + (group._sum.requestedCount ?? 0), 0),
    completed: groups.reduce((sum, group) => sum + (group._sum.completedCount ?? 0), 0),
  };
}

export default async function PlatformTemplatesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/templates");
  const [routeState, locale] = await Promise.all([
    getCustomerRouteRehearsalState("templates"),
    getServerLocale(),
  ]);
  const empty = routeState === "empty";
  const [templates, usage] = await Promise.all([
    empty ? Promise.resolve([]) : listActiveStyleTemplates(),
    empty ? Promise.resolve(NO_USAGE) : loadTemplateUsage(session.user.id),
  ]);
  const copy = getPlatformCopy(locale).templates;
  const board = TEMPLATE_LIBRARY_COPY[locale].board;
  const items: TemplateLibraryItem[] = templates.map((template) => ({
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
    shots: parseTemplateShots(template.promptSkeleton),
    recentBatchCount: usage.bySlug.get(template.slug) ?? 0,
  }));
  const sampleCount = items.filter((item) => item.sampleImage || item.sampleVideo).length;
  const categoryCount = new Set(items.map((item) => item.category)).size;

  return (
    <div className="x-stack min-w-0">
      <QuoteHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={templates.length > 0 ? (
          <Button
            render={<Link href={`/app/batches/new?template=${encodeURIComponent(templates[0].slug)}`} />}
            variant="outline"
          >
            {copy.recommended}
            <ArrowRight aria-hidden />
          </Button>
        ) : undefined}
        statsLabel={board.label}
        stats={[
          { label: board.recipes, value: items.length, caption: fillCount(board.recipesCaption, categoryCount) },
          { label: board.samples, value: sampleCount, caption: fillCount(board.samplesCaption, items.length - sampleCount) },
          { label: board.used, value: usage.batches, caption: fillCount(board.usedCaption, usage.bySlug.size) },
          {
            label: board.filled,
            value: usage.completed,
            caption: fillCount(board.filledCaption, usage.requested),
            tone: usage.completed > 0 ? "filled" : "neutral",
          },
        ]}
        scope={board.scope}
      />
      {templates.length === 0 ? (
        <section data-route-state="empty" className="x-panel x-frame px-6 py-12">
          <p className="max-w-[56ch] text-body text-muted-foreground">{copy.preparing}</p>
          <Button render={<Link href="/app/create" />} className="mt-5">{copy.start}<ArrowRight aria-hidden /></Button>
        </section>
      ) : (
        <div className="min-w-0 grid grid-cols-1">
          <TemplateLibraryGrid templates={items} />
        </div>
      )}
    </div>
  );
}
