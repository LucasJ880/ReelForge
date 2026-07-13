import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, Layers3, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { loadUnifiedLibrary } from "@/lib/services/unified-library-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { HoverPreviewVideo } from "@/components/library/hover-preview-video";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";

export const dynamic = "force-dynamic";

export default async function PlatformLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/library");
  const query = (await searchParams).q?.trim().toLocaleLowerCase() ?? "";
  const allRows = await loadUnifiedLibrary(session.user.id).catch(() => []);
  const rows = query
    ? allRows.filter((row) => row.title.toLocaleLowerCase().includes(query) || row.id.toLocaleLowerCase().includes(query))
    : allRows;
  return (
    <div className="editorial-page-stack min-w-0">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <p className="studio-label text-muted-foreground">Video library</p>
          <h1 className="editorial-display">成品库</h1>
          <p className="text-body text-muted-foreground">单条创作与批量生产的结果都汇总在这里。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button render={<Link href="/app/batches/new" />} variant="outline">
            <Layers3 aria-hidden />批量生成
          </Button>
          <Button render={<Link href="/app/create" />}>
            <Plus aria-hidden />创建视频
          </Button>
        </div>
      </header>
      {rows.length === 0 ? (
        <section className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">{query ? `没有找到“${query}”。换个关键词，或开始一支新视频。` : "还没有成片。从模板库选一个风格开始。"}</p>
          <Button render={<Link href="/app/templates" />} className="mt-5">浏览模板库<ArrowRight aria-hidden /></Button>
        </section>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="成品列表">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0">
              <article className="group min-w-0 overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-border-strong">
                <Link href={`/app/library/${row.id}`} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <div className="relative aspect-video overflow-hidden bg-secondary">
                    {row.videoUrl ? (
                      <HoverPreviewVideo src={row.videoUrl} poster={row.thumbnailUrl ?? undefined} />
                    ) : row.thumbnailUrl ? (
                      <Image src={row.thumbnailUrl} alt="" fill unoptimized sizes="(min-width: 1280px) 30vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center">
                        <span className="studio-label text-muted-foreground">{row.label}</span>
                        <span className="font-mono text-title font-semibold tabular-nums">{row.progress}%</span>
                      </div>
                    )}
                    <span className="absolute right-3 top-3 rounded-(--radius-sm) bg-card px-2 py-1 font-mono text-meta tabular-nums">{row.durationSec ? `${row.durationSec}s` : "—"}</span>
                    <AiGeneratedLabel className="absolute bottom-3 left-3" />
                  </div>
                </Link>
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 truncate font-heading text-subhead font-semibold">{row.title}</h2><Badge variant={row.status === "ready" ? "success" : row.status === "failed" ? "destructive" : "secondary"}>{row.label}</Badge></div>
                    {(row.status === "generating" || row.status === "assembling") && <Progress value={row.progress} aria-label={`${row.title} 进度`} />}
                    {row.status === "failed" ? <p className="text-meta text-muted-foreground">生成没有完成。可以调整描述重新生成；如持续失败，请联系支持。</p> : null}
                    <p className="font-mono text-meta tabular-nums text-muted-foreground">{row.aspectRatio ?? "画幅待定"} · {row.updatedAt.toLocaleDateString("en-CA")}</p>
                    <Button render={<Link href={row.status === "failed" ? `/app/create?retry=${encodeURIComponent(row.id)}` : `/app/library/${row.id}`} />} variant={row.status === "failed" ? "outline" : "ghost"} size="sm">
                      {row.status === "failed" ? "重新生成" : "查看成片"}<ArrowRight aria-hidden />
                    </Button>
                  </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
