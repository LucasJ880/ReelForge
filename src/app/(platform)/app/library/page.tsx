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
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";

export const dynamic = "force-dynamic";

export default async function PlatformLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/library");
  const query = (await searchParams).q?.trim().toLocaleLowerCase() ?? "";
  const routeState = await getCustomerRouteRehearsalState("library");
  const allRows = routeState === "empty" ? [] : await loadUnifiedLibrary(session.user.id);
  const rows = query
    ? allRows.filter((row) => row.title.toLocaleLowerCase().includes(query) || row.id.toLocaleLowerCase().includes(query))
    : allRows;
  const copy = getPlatformCopy(await getServerLocale()).library;
  return (
    <div className="editorial-page-stack min-w-0">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <p className="studio-label text-muted-foreground">{copy.kicker}</p>
          <h1 className="editorial-display">{copy.title}</h1>
          <p className="text-body text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button render={<Link href="/app/batches/new" />} variant="outline">
            <Layers3 aria-hidden />{copy.batch}
          </Button>
          <Button render={<Link href="/app/create" />}>
            <Plus aria-hidden />{copy.create}
          </Button>
        </div>
      </header>
      {rows.length === 0 ? (
        <section data-route-state="empty" className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">{query ? copy.noResults.replace("{query}", query) : copy.empty}</p>
          <Button render={<Link href="/app/templates" />} className="mt-5">{copy.browse}<ArrowRight aria-hidden /></Button>
        </section>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={copy.listLabel}>
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
                        <span className="studio-label text-muted-foreground">{copy.statuses[row.status]}</span>
                        <span className="font-mono text-title font-semibold tabular-nums">{row.progress}%</span>
                      </div>
                    )}
                    <span className="absolute right-3 top-3 rounded-(--radius-sm) bg-card px-2 py-1 font-mono text-meta tabular-nums">{row.durationSec ? `${row.durationSec}s` : "—"}</span>
                    <AiGeneratedLabel className="absolute bottom-3 left-3" />
                  </div>
                </Link>
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 truncate font-heading text-subhead font-semibold">{row.title}</h2><Badge variant={row.status === "ready" ? "success" : row.status === "failed" ? "destructive" : "secondary"}>{copy.statuses[row.status]}</Badge></div>
                    {(row.status === "generating" || row.status === "assembling") && <Progress value={row.progress} aria-label={`${row.title} ${copy.progress}`} />}
                    {row.status === "failed" ? <p className="text-meta text-muted-foreground">{copy.failed}</p> : null}
                    <p className="font-mono text-meta tabular-nums text-muted-foreground">{row.aspectRatio ?? copy.aspectPending} · {row.updatedAt.toLocaleDateString("en-CA")}</p>
                    <Button render={<Link href={row.status === "failed" ? `/app/create?retry=${encodeURIComponent(row.id)}` : `/app/library/${row.id}`} />} variant={row.status === "failed" ? "outline" : "ghost"} size="sm">
                      {row.status === "failed" ? copy.regenerate : copy.view}<ArrowRight aria-hidden />
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
