import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { FillBar } from "@/components/exchange/fill-bar";
import { StatusTick, batchTone } from "@/components/exchange/status-tick";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";

export const dynamic = "force-dynamic";

const LIVE = new Set(["EXPANDING", "RUNNING", "PAUSED"]);
/** 正在出片的批次才挂光束；暂停的不算「正在发生」。 */
const GENERATING = new Set(["EXPANDING", "RUNNING"]);

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
  const filled = batches.reduce((sum, batch) => sum + batch.completedCount, 0);
  const failed = batches.reduce((sum, batch) => sum + batch.failedCount, 0);
  const requested = batches.reduce((sum, batch) => sum + batch.requestedCount, 0);
  const live = batches.filter((batch) => LIVE.has(batch.status)).length;

  return (
    <div className="x-stack min-w-0">
      <QuoteHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <Button render={<Link href="/app/batches/new" />}>
            <Plus aria-hidden />{copy.new}
          </Button>
        }
        statsLabel={copy.board.label}
        stats={batches.length === 0 ? undefined : [
          { label: copy.board.live, value: live, tone: live > 0 ? "live" : "neutral" },
          { label: copy.board.filled, value: filled, tone: filled > 0 ? "filled" : "neutral" },
          { label: copy.board.failed, value: failed, tone: failed > 0 ? "fault" : "neutral" },
          { label: copy.board.rate, value: requested > 0 ? `${Math.round((filled / requested) * 100)}%` : "—" },
        ]}
        scope={batches.length > 0 ? copy.board.scope.replace("{n}", String(batches.length)) : undefined}
      />

      {batches.length === 0 ? (
        <section data-route-state="empty" className="x-panel x-frame px-6 py-12">
          <p className="max-w-[56ch] text-body text-muted-foreground">{copy.empty}</p>
          <Button render={<Link href="/app/templates" />} className="mt-5">
            {copy.browse}<ArrowRight aria-hidden />
          </Button>
        </section>
      ) : (
        <div className="x-panel min-w-0 overflow-hidden">
          <table className="block w-full table-fixed md:table" aria-label={copy.listLabel}>
            <thead className="hidden border-b border-border bg-sunken md:table-header-group">
              <tr>
                <th className="w-[30%] px-4 py-2.5 text-left x-label">{copy.columns.batch}</th>
                <th className="w-[18%] px-4 py-2.5 text-left x-label">{copy.columns.template}</th>
                <th className="w-[22%] px-4 py-2.5 text-left x-label">{copy.columns.progress}</th>
                <th className="w-[13%] px-4 py-2.5 text-left x-label">{copy.columns.status}</th>
                <th className="w-[12%] px-4 py-2.5 text-left x-label">{copy.columns.updated}</th>
                <th className="w-[5%] px-4 py-2.5 text-right x-label"><span className="sr-only">{copy.columns.action}</span></th>
              </tr>
            </thead>
            <tbody className="block divide-y divide-border md:table-row-group">
              {batches.map((batch) => {
                const counts = {
                  completed: batch.completedCount,
                  running: batch.runningCount,
                  paused: batch.pausedCount,
                  failed: batch.failedCount,
                  cancelled: batch.cancelledCount,
                };
                const name = batch.productName?.trim()
                  ? batch.productName
                  : locale === "en-US"
                    ? `${batch.template.name} × ${batch.requestedCount}`
                    : `${batch.template.nameZh} × ${batch.requestedCount} 条`;
                return (
                  <tr key={batch.id} data-beam={GENERATING.has(batch.status) ? "row" : undefined} className="group block px-4 py-3 transition-colors hover:bg-raised md:table-row md:px-0 md:py-0">
                    <td data-label={copy.columns.batch} className="block min-w-0 py-2 md:table-cell md:px-4 md:py-3.5">
                      {/* 批次身份优先级:产品名 > 模板×数量。裸 cuid 永远只当追踪码,不当标题。 */}
                      <Link href={`/app/batches/${batch.id}`} className="block min-w-0 hover:text-accent">
                        <span className="block truncate text-body font-medium">{name}</span>
                        <span className="mt-1 block truncate font-mono text-data text-tertiary">B·{batch.id.slice(-5).toUpperCase()} · {batch.id}</span>
                      </Link>
                    </td>
                    <td data-label={copy.columns.template} className="block min-w-0 py-1 text-meta text-muted-foreground before:mr-3 before:x-label before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3.5 md:before:hidden">
                      {locale === "en-US" ? batch.template.name : batch.template.nameZh}
                    </td>
                    <td data-label={copy.columns.progress} className="block py-2 md:table-cell md:px-4 md:py-3.5">
                      <div className="flex min-w-40 items-center gap-3">
                        <FillBar counts={counts} total={batch.requestedCount} className="flex-1" />
                        <span className="w-12 shrink-0 text-right font-mono text-data tabular-nums text-foreground">
                          {batch.completedCount}/{batch.requestedCount}
                        </span>
                      </div>
                    </td>
                    <td data-label={copy.columns.status} className="block py-1 md:table-cell md:px-4 md:py-3.5">
                      <StatusTick tone={batchTone(batch.status)} label={copy.statuses[batch.status]} />
                    </td>
                    <td data-label={copy.columns.updated} className="block py-1 font-mono text-data text-muted-foreground md:table-cell md:px-4 md:py-3.5">
                      {batch.updatedAt.toLocaleString(locale === "en-US" ? "en-CA" : "zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false })}
                    </td>
                    <td data-label={copy.columns.action} className="block py-1 text-right md:table-cell md:px-4 md:py-3.5">
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
