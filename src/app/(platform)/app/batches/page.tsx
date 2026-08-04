import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { cn } from "@/lib/utils";
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
        <div className="min-w-0 overflow-hidden rounded-(--radius-lg) border border-border bg-card">
          <table className="block w-full table-fixed md:table" aria-label={copy.listLabel}>
            <thead className="hidden border-b border-border bg-muted/35 md:table-header-group">
              <tr>
                <th className="w-[28%] px-4 py-3 text-left studio-label text-muted-foreground">{copy.columns.batch}</th>
                <th className="w-[20%] px-4 py-3 text-left studio-label text-muted-foreground">{copy.columns.template}</th>
                <th className="w-[20%] px-4 py-3 text-left studio-label text-muted-foreground">{copy.columns.progress}</th>
                <th className="w-[13%] px-4 py-3 text-left studio-label text-muted-foreground">{copy.columns.status}</th>
                <th className="w-[13%] px-4 py-3 text-left studio-label text-muted-foreground">{copy.columns.updated}</th>
                <th className="w-[6%] px-4 py-3 text-right studio-label text-muted-foreground">{copy.columns.action}</th>
              </tr>
            </thead>
            <tbody className="block divide-y divide-border md:table-row-group">
              {batches.map((batch) => {
                const variant = batch.status === "FAILED" ? "destructive" : batch.status === "COMPLETED" ? "success" : batch.status === "PARTIAL_FAILED" || batch.status === "PAUSED" ? "warning" : "default";
                const percent = batch.requestedCount > 0
                  ? Math.round((batch.completedCount / batch.requestedCount) * 100)
                  : 0;
                return (
                  <tr key={batch.id} className="group block px-4 py-3 transition-colors hover:bg-muted/30 md:table-row md:px-0 md:py-0">
                    <td data-label={copy.columns.batch} className="block min-w-0 py-2 before:mr-3 before:studio-label before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:px-4 md:py-4 md:before:hidden">
                      {/* 批次身份优先级:产品名 > 模板×数量。裸 cuid 永远只当追踪码,不当标题。 */}
                      <p className="truncate font-heading text-body font-semibold">
                        {batch.productName?.trim()
                          ? batch.productName
                          : locale === "en-US"
                            ? `${batch.template.name} × ${batch.requestedCount}`
                            : `${batch.template.nameZh} × ${batch.requestedCount} 条`}
                      </p>
                      <p className="mt-1 truncate font-mono text-meta text-muted-foreground">{batch.id}</p>
                    </td>
                    <td data-label={copy.columns.template} className="block min-w-0 py-2 text-body before:mr-3 before:studio-label before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:px-4 md:py-4 md:before:hidden">
                      {locale === "en-US" ? batch.template.name : batch.template.nameZh}
                    </td>
                    <td data-label={copy.columns.progress} className="block py-2 before:mr-3 before:studio-label before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:px-4 md:py-4 md:before:hidden">
                      <div className="inline-flex min-w-40 items-center gap-3 align-middle">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                          {/* accent 只留给进行中的批次（当前项）；完结批次退为语义色/中性 */}
                          <div
                            className={cn(
                              "h-full rounded-full",
                              variant === "destructive"
                                ? "bg-danger"
                                : variant === "warning"
                                  ? "bg-warning"
                                  : variant === "success"
                                    ? "bg-success"
                                    : "bg-primary",
                            )}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="font-mono text-meta tabular-nums">{batch.completedCount}/{batch.requestedCount}</span>
                      </div>
                    </td>
                    <td data-label={copy.columns.status} className="block py-2 before:mr-3 before:studio-label before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:px-4 md:py-4 md:before:hidden">
                      <Badge variant={variant}>{copy.statuses[batch.status]}</Badge>
                    </td>
                    <td data-label={copy.columns.updated} className="block py-2 font-mono text-meta text-muted-foreground before:mr-3 before:font-sans before:studio-label before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:px-4 md:py-4 md:before:hidden">
                      {batch.updatedAt.toLocaleString(locale === "en-US" ? "en-CA" : "zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false })}
                    </td>
                    <td data-label={copy.columns.action} className="block py-2 text-right before:mr-3 before:studio-label before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:px-4 md:py-4 md:before:hidden">
                      <Button render={<Link href={`/app/batches/${batch.id}`} />} variant="ghost" size="icon-sm" aria-label={`${copy.view} ${batch.id}`}>
                        <ArrowRight aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
