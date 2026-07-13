"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TemplateLibraryItem = {
  id: string;
  name: string;
  nameZh: string;
  category: string;
  coverImage: string;
  version: number;
  lockedParams: {
    stability?: "high" | "balanced";
    humanInteraction?: "none" | "controlled";
    duration?: number;
    aspectRatio?: string;
  };
};

export function TemplateLibraryGrid({ templates }: { templates: TemplateLibraryItem[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(templates.map((template) => template.category))).sort((a, b) => a.localeCompare(b, "zh-CN"))],
    [templates],
  );
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return templates.filter((template) =>
      (category === "全部" || template.category === category) &&
      (!normalized || `${template.nameZh} ${template.name} ${template.category}`.toLocaleLowerCase().includes(normalized)),
    );
  }, [category, query, templates]);

  return (
    <div className="space-y-5">
      <section className="rounded-(--radius-lg) border border-border bg-card p-4" aria-label="筛选模板">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <span className="sr-only">搜索模板</span>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索场景、行业或镜头风格" className="pl-9" />
          </label>
          <p className="font-mono text-meta tabular-nums text-muted-foreground">{visible.length} / {templates.length} QUALITY-LOCKED</p>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="模板分类">
          {categories.map((item) => (
            <Button key={item} type="button" size="sm" variant={category === item ? "default" : "outline"} onClick={() => setCategory(item)} className="shrink-0">{item}</Button>
          ))}
        </div>
      </section>

      {visible.length === 0 ? (
        <section className="rounded-(--radius-lg) border border-border bg-card px-6 py-10">
          <p className="text-body text-muted-foreground">没有匹配的模板。清除筛选后继续浏览。</p>
          <Button type="button" variant="outline" onClick={() => { setCategory("全部"); setQuery(""); }} className="mt-4">清除筛选</Button>
        </section>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="风格模板">
          {visible.map((template) => {
            const locked = template.lockedParams;
            return (
              <li key={template.id} className="min-w-0">
                <article className="group min-w-0 overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-border-strong">
                  <div className="relative aspect-video overflow-hidden bg-secondary">
                    <Image src={template.coverImage} alt={`${template.nameZh} 样例截帧`} fill unoptimized sizes="(min-width: 1280px) 30vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-base group-hover:scale-[1.02] motion-reduce:transition-none" />
                    <span className="absolute bottom-3 left-3 rounded-(--radius-sm) bg-card px-2 py-1 text-meta text-foreground">Aivora 生成样例帧</span>
                  </div>
                  <div className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h2 className="truncate font-heading text-subhead font-semibold">{template.nameZh}</h2><p className="mt-1 truncate text-meta text-muted-foreground">{template.name}</p></div>
                      <Badge variant="secondary">{template.category}</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-meta text-muted-foreground">
                      <span className="flex items-center gap-1"><ShieldCheck className="size-3.5 text-success" aria-hidden />{locked.stability === "high" ? "稳定优先" : "创意均衡"}</span>
                      <span className="font-mono tabular-nums">{locked.duration ?? 10}s</span>
                      <span className="font-mono tabular-nums">{locked.aspectRatio ?? "9:16"}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-3">
                      <p className="font-mono text-meta tabular-nums text-muted-foreground">v{template.version} · {locked.humanInteraction === "none" ? "无真人" : "交互受控"}</p>
                      <Button render={<Link href={`/app/batches/new?template=${encodeURIComponent(template.id)}`} />} variant="ghost" size="sm">一键套用<ArrowRight aria-hidden /></Button>
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
