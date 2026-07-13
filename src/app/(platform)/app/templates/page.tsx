import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import {
  TemplateLibraryGrid,
  type TemplateLibraryItem,
} from "@/components/templates/template-library-grid";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function PlatformTemplatesPage() {
  const templates = await listActiveStyleTemplates().catch(() => []);
  return (
    <div className="editorial-page-stack">
      <header className="max-w-3xl space-y-3">
        <p className="studio-label text-muted-foreground">Template library</p>
        <h1 className="editorial-display">模板库</h1>
        <p className="text-body text-muted-foreground">从原创、版本冻结的镜头方案开始；参考图真实性锁、负面约束与固定参数共同降低批量跑偏。</p>
      </header>
      {templates.length > 0 ? <div className="flex justify-end"><Button render={<Link href={`/app/batches/new?template=${encodeURIComponent(templates[0].id)}`} />} variant="outline">使用推荐模板<ArrowRight aria-hidden /></Button></div> : null}
      {templates.length === 0 ? (
        <section className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">模板正在准备中。先从单条创作开始。</p>
          <Button render={<Link href="/app/create" />} className="mt-5">开始创作<ArrowRight aria-hidden /></Button>
        </section>
      ) : <div className="min-w-0 grid grid-cols-1"><TemplateLibraryGrid templates={templates.map((template) => ({
        id: template.id,
        name: template.name,
        nameZh: template.nameZh,
        category: template.category,
        coverImage: template.coverImage,
        version: template.version,
        lockedParams: template.lockedParams as TemplateLibraryItem["lockedParams"],
      }))} /></div>}
    </div>
  );
}
