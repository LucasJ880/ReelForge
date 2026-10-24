"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TemplateRecipeDialog } from "@/components/templates/template-recipe-dialog";
import { TemplateShotTimeline, type TemplateShot } from "@/components/templates/template-shot-timeline";
import { TEMPLATE_LIBRARY_COPY, fillCount } from "@/components/templates/template-library-copy";
import { HoverPreviewVideo } from "@/components/library/hover-preview-video";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

export type TemplateLibraryItem = {
  id: string;
  slug: string;
  name: string;
  nameZh: string;
  category: string;
  sampleImage: string | null;
  sampleVideo: string | null;
  summary: string | null;
  promptSkeleton: string;
  negativePrompt: string;
  version: number;
  lockedParams: {
    stability?: "high" | "balanced";
    humanInteraction?: "none" | "controlled";
    duration?: number;
    aspectRatio?: string;
  };
  /// 这一版配方冻结的分镜（promptSkeleton 的 TIMED STORYBOARD），样片待补时画成时间线
  shots: TemplateShot[];
  /// 本工作区近 30 天用这个模板（同 slug 的各个版本）建的批次数
  recentBatchCount: number;
};

export function TemplateLibraryGrid({ templates }: { templates: TemplateLibraryItem[] }) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).templates;
  const libraryCopy = TEMPLATE_LIBRARY_COPY[locale];
  const english = locale === "en-US";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("__all__");
  const categories = useMemo(
    () => ["__all__", ...Array.from(new Set(templates.map((template) => template.category))).sort((a, b) => a.localeCompare(b, locale))],
    [locale, templates],
  );
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return templates.filter((template) =>
      (category === "__all__" || template.category === category) &&
      (!normalized || `${template.nameZh} ${template.name} ${template.category} ${template.slug}`.toLocaleLowerCase().includes(normalized)),
    );
  }, [category, query, templates]);
  /// 跟着筛选走：总数已经在行情头里，这里回答「筛出来的里有几条能看样片」
  const visibleSampleCount = visible.filter((template) => template.sampleImage || template.sampleVideo).length;

  return (
    <div className="space-y-5">
      <section className="x-panel p-4" aria-label={copy.filterLabel}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <span className="sr-only">{copy.searchLabel}</span>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} className="pl-9" />
          </label>
          <div className="flex flex-wrap items-center gap-3 font-mono text-data tabular-nums text-muted-foreground" aria-live="polite">
            <span>{copy.lockedCount.replace("{visible}", String(visible.length)).replace("{total}", String(templates.length))}</span>
            <span aria-hidden>·</span>
            <span>{visibleSampleCount} {english ? "verified samples" : "个独立样片"}</span>
          </div>
        </div>
        <div data-template-filters className="mt-4 flex flex-wrap gap-2" role="group" aria-label={copy.categoryLabel}>
          {categories.map((item) => (
            <Button key={item} type="button" size="sm" variant={category === item ? "default" : "outline"} aria-pressed={category === item} onClick={() => setCategory(item)} className="shrink-0">{item === "__all__" ? copy.all : categoryLabel(copy, item)}</Button>
          ))}
        </div>
      </section>

      {visible.length === 0 ? (
        <section className="x-panel px-6 py-10">
          <p className="text-body text-muted-foreground">{copy.empty}</p>
          <Button type="button" variant="outline" onClick={() => { setCategory("__all__"); setQuery(""); }} className="mt-4">{copy.clear}</Button>
        </section>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label={copy.listLabel}>
          {visible.map((template) => {
            const locked = template.lockedParams;
            const title = english ? template.name : template.nameZh;
            const hasSample = Boolean(template.sampleImage || template.sampleVideo);
            return (
              <li key={template.id} className="min-w-0 h-full">
                <article data-template-card className="x-panel group flex h-full min-w-0 flex-col overflow-hidden transition-colors hover:border-border-strong">
                  {/* 每张卡同一个 16:9 媒体位：有验收样片放样片，没有就画这份配方的分镜时间线，不编图 */}
                  <div className="relative aspect-video overflow-hidden bg-sunken">
                    {template.sampleVideo ? (
                      <HoverPreviewVideo
                        src={template.sampleVideo}
                        poster={template.sampleImage ?? undefined}
                        ariaLabel={`${title} ${copy.sample}`}
                      />
                    ) : template.sampleImage ? (
                      <Image src={template.sampleImage} alt={`${title} ${copy.sample}`} fill unoptimized sizes="(min-width: 1536px) 22vw, (min-width: 1280px) 30vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-base group-hover:scale-[1.02] motion-reduce:transition-none" />
                    ) : (
                      <TemplateShotTimeline
                        shots={template.shots}
                        duration={locked.duration}
                        aspectRatio={locked.aspectRatio}
                        locale={locale}
                      />
                    )}
                    {hasSample ? (
                      <span className="absolute bottom-2 left-2 rounded-(--radius-sm) bg-overlay px-2 py-1 text-meta text-foreground">{copy.sample}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-subhead font-medium">{title}</h2>
                        <p className="mt-0.5 truncate text-meta text-tertiary">{english ? template.slug : template.name}</p>
                        {template.summary ? <p className="mt-2 line-clamp-2 text-meta leading-relaxed text-muted-foreground">{template.summary}</p> : null}
                      </div>
                      <Badge variant="secondary">{categoryLabel(copy, template.category)}</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-meta text-muted-foreground">
                      <span className="flex items-center gap-1"><ShieldCheck className="size-3.5 text-tertiary" aria-hidden />{locked.stability === "high" ? copy.stable : copy.balanced}</span>
                      <span className="font-mono tabular-nums">{locked.duration ?? 10}s</span>
                      <span className="font-mono tabular-nums">{locked.aspectRatio ?? "9:16"}</span>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <p className="font-mono text-data tabular-nums text-muted-foreground">
                        v{template.version} · {locked.humanInteraction === "none" ? copy.noHuman : copy.controlledHuman}
                        {template.recentBatchCount > 0 ? (
                          <span className="text-foreground"> · {fillCount(libraryCopy.recentBatches, template.recentBatchCount)}</span>
                        ) : null}
                      </p>
                      <TemplateRecipeDialog name={title} version={template.version} promptSkeleton={template.promptSkeleton} negativePrompt={template.negativePrompt} english={english} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button render={<Link href={`/app/create?styleTemplate=${encodeURIComponent(template.slug)}&prompt=${encodeURIComponent(templateStarterPrompt(template, english))}`} />} variant="ghost" size="sm">{copy.useSingle}</Button>
                      <Button render={<Link href={`/app/batches/new?template=${encodeURIComponent(template.slug)}`} />} variant="outline" size="sm">{copy.useBatch}<ArrowRight aria-hidden /></Button>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function categoryLabel(copy: ReturnType<typeof getPlatformCopy>["templates"], value: string): string {
  return copy.categories[value as keyof typeof copy.categories] ?? value;
}

function templateStarterPrompt(
  template: TemplateLibraryItem,
  english: boolean,
): string {
  const direction = template.summary
    ?? (english
      ? `Use the ${template.name} structure with one visible proof point.`
      : `使用「${template.nameZh}」结构，只证明一个可见卖点。`);
  return english
    ? `Create a 15-second ecommerce video. ${direction} Preserve the exact referenced product, avoid unsupported claims, and finish on a clear spoken action.`
    : `请制作一条 15 秒电商短视频。${direction} 保持参考产品完全一致，不虚构功能或效果，结尾给出清晰的口播行动指引。`;
}
