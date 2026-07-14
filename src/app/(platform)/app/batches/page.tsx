import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { BatchFilmStrip } from "@/components/batch/batch-film-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";

export const dynamic = "force-dynamic";

export default async function PlatformBatchesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/batches");
  const routeState = await getCustomerRouteRehearsalState("batches");
  const batches = routeState === "empty" ? [] : await db.batchJob.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { template: { select: { name: true, nameZh: true, coverImage: true } } },
  });
  const locale = await getServerLocale();
  const copy = getPlatformCopy(locale).batches;

  return (
    <div className="editorial-page-stack min-w-0">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl space-y-3">
          <p className="studio-label text-muted-foreground">{copy.kicker}</p>
          <h1 className="editorial-display">{copy.title}</h1>
          <p className="max-w-2xl text-body text-muted-foreground">{copy.subtitle}</p>
        </div>
        <Button render={<Link href="/app/batches/new" />}>
          <Plus aria-hidden />{copy.new}
        </Button>
      </header>

      {batches.length === 0 ? (
        <section data-route-state="empty" className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">{copy.empty}</p>
          <Button render={<Link href="/app/templates" />} className="mt-5">
            {copy.browse}<ArrowRight aria-hidden />
          </Button>
        </section>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2" aria-label={copy.listLabel}>
          {batches.map((batch) => {
            const queued = batch.queuedCount + batch.pausedCount;
            const variant = batch.status === "FAILED" ? "destructive" : batch.status === "COMPLETED" ? "success" : batch.status === "PARTIAL_FAILED" || batch.status === "PAUSED" ? "warning" : "default";
            return (
              <li key={batch.id} className="min-w-0">
                <article className="group min-w-0 h-full rounded-(--radius-lg) border border-border bg-card p-5 transition-colors hover:border-border-strong">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="studio-label text-muted-foreground">{locale === "en-US" ? batch.template.name : batch.template.nameZh}</p>
                      <h2 className="mt-2 truncate font-heading text-subhead font-semibold">{batch.productName || copy.unnamed}</h2>
                    </div>
                    <Badge variant={variant}>{copy.statuses[batch.status]}</Badge>
                  </div>
                  <BatchFilmStrip
                    className="mt-6"
                    locale={locale}
                    counts={{
                      completed: batch.completedCount,
                      generating: batch.runningCount,
                      queued,
                      failed: batch.failedCount,
                      cancelled: batch.cancelledCount,
                    }}
                  />
                  <div className="mt-5 grid grid-cols-[1fr_1fr_auto] items-end gap-4">
                    <div>
                      <p className="studio-label text-muted-foreground">{copy.completedTotal}</p>
                      <p className="mt-1 font-mono text-title font-semibold tabular-nums">{batch.completedCount}<span className="text-muted-foreground">/{batch.requestedCount}</span></p>
                    </div>
                    <div>
                      <p className="studio-label text-muted-foreground">{copy.costSnapshot}</p>
                      <p className="mt-1 font-mono text-title font-semibold tabular-nums">$—</p>
                    </div>
                    <Button render={<Link href={`/app/batches/${batch.id}`} />} variant="ghost" size="sm" aria-label={`${copy.view} ${batch.id}`}>
                      {copy.view}<ArrowRight aria-hidden />
                    </Button>
                  </div>
                  <p className="mt-4 break-all border-t border-border pt-3 font-mono text-meta text-muted-foreground">
                    {batch.id} · {batch.createdAt.toLocaleString("en-CA", { hour12: false })}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
