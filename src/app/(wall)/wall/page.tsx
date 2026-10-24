import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadExchangeReadings, loadProductionCounts } from "@/lib/services/exchange-readings";
import type { UnifiedLibraryRow } from "@/lib/contracts/unified-library";
import { formatRate, readingName } from "@/lib/exchange/readings-registry";
import { batchState, libraryRowState, stateTone, stateWord } from "@/lib/exchange/state-vocab";
import { Logo } from "@/components/ui/logo";
import { FillBar } from "@/components/exchange/fill-bar";
import { StatusTick } from "@/components/exchange/status-tick";
import { ExchangeTape, type TapeItem } from "@/components/exchange/exchange-tape";
import { Delta } from "@/components/exchange/delta";
import { TickerFigure } from "@/components/exchange/ticker-figure";
import { WallAutoRefresh, WallClock, WallFullscreenButton, WallVideo } from "@/components/exchange/wall-controls";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function rowHref(row: UnifiedLibraryRow): string {
  return row.source === "batch" && row.batchId ? `/app/batches/${row.batchId}` : `/app/library/${row.id}`;
}

/**
 * 行情大屏：同一个交易大厅，放大到 3–5 米外可读。
 * 只读本工作区的真实数据（成品库样片 isShowcase 一律不计、不上墙）；零就写零。
 * xl 以上（电视、展位屏、笔记本全屏）整屏定格不滚动；更窄时按页面自然滚动。
 */
export default async function ExchangeWallPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/wall");
  const userId = session.user.id;
  const locale = await getServerLocale();
  const copy = getPlatformCopy(locale);

  const [workspace, batches, readings, production] = await Promise.all([
    db.workspace.findUnique({ where: { ownerId: userId }, select: { name: true } }),
    db.batchJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        productName: true,
        status: true,
        requestedCount: true,
        completedCount: true,
        runningCount: true,
        pausedCount: true,
        failedCount: true,
        cancelledCount: true,
        template: { select: { nameZh: true, name: true } },
      },
    }),
    loadExchangeReadings(userId, { mediaLimit: 6, recentLimit: 16, locale }),
    loadProductionCounts(userId),
  ]);

  /// 市场状态与壳层同口径：真在生成的视频条数（排队、暂停不算）。
  const live = production.generating;
  const rate = readings.successRate7d;
  const cells: Array<{
    label: string;
    value: number;
    display?: string;
    tone: string;
    delta?: { previous: number; label: string; upIsGood: boolean };
  }> = [
    { label: readingName("generating", locale), value: live, tone: live > 0 ? "text-accent" : "text-foreground" },
    {
      label: readingName("filled24h", locale),
      value: readings.filled24h,
      tone: readings.filled24h > 0 ? "text-success" : "text-foreground",
      delta: { previous: readings.previous.filled24h, label: copy.wall.vsPrev24, upIsGood: true },
    },
    {
      label: readingName("filled7d", locale),
      value: readings.filled7d,
      tone: readings.filled7d > 0 ? "text-success" : "text-foreground",
      delta: { previous: readings.previous.filled7d, label: copy.wall.vsPrev7, upIsGood: true },
    },
    {
      label: readingName("failed7d", locale),
      value: readings.failed7d,
      tone: readings.failed7d > 0 ? "text-danger" : "text-foreground",
      delta: { previous: readings.previous.failed7d, label: copy.wall.vsPrev7, upIsGood: false },
    },
    { label: readingName("successRate7d", locale), value: rate ?? -1, display: formatRate(rate), tone: "text-foreground" },
  ];
  /// 生产回报：词与记号从状态词典取；暂停 / 排队不写「0%」（之前被读成卡死）。
  const report: TapeItem[] = readings.recent.map((row) => {
    const state = libraryRowState(row.status);
    return {
      id: row.id,
      href: rowHref(row),
      code: `#${(row.videoJobId ?? row.id).slice(-5).toUpperCase()}`,
      name: row.title,
      tone: stateTone("item", state),
      state: stateWord("item", state, locale),
      figure: state === "generating" ? `${row.progress}%` : state === "done" && row.durationSec ? `${row.durationSec}s` : undefined,
      at: row.updatedAt.toISOString(),
    };
  });

  return (
    <div className="desk-theme desk-canvas flex min-h-dvh flex-col gap-[clamp(14px,1.6vw,28px)] bg-background px-[clamp(16px,2.2vw,44px)] py-[clamp(14px,1.6vw,28px)] text-foreground xl:grid xl:h-dvh xl:grid-rows-[auto_auto_minmax(0,1fr)_auto] xl:overflow-hidden">
      <WallAutoRefresh />
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex items-center gap-3">
          <Logo size={44} />
          <span className="flex flex-col">
            <span className="font-heading text-[18px] font-semibold tracking-[0.16em]">AIVORA</span>
            <span className="font-mono text-data uppercase tracking-wider text-muted-foreground">{workspace?.name ?? ""}</span>
          </span>
        </span>
        <h1 className="x-display text-[clamp(28px,2.8vw,54px)]">{copy.wall.title}</h1>
        <span className="flex items-center gap-2 rounded-(--radius-md) border border-border px-3 py-1.5" role="status">
          <span className="x-live" data-tone={live > 0 ? "live" : "idle"} aria-hidden />
          <span className={cn("font-mono text-meta uppercase tracking-wider", live > 0 ? "text-accent" : "text-muted-foreground")}>
            {live > 0 ? copy.shell.marketLive : copy.shell.marketIdle}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-4">
          <WallFullscreenButton label={copy.wall.fullscreen} />
          <Link href="/app/batches" className="flex h-8 items-center gap-2 rounded-(--radius-md) border border-border px-3 text-meta text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            {copy.wall.exit}
          </Link>
          <WallClock locale={locale} />
        </span>
      </header>

      <dl className="x-wall x-frame grid-cols-2 md:grid-cols-5">
        {cells.map((cell) => (
          <div key={cell.label} className="flex min-w-0 flex-col gap-[clamp(8px,0.8vw,14px)] px-[clamp(14px,1.5vw,26px)] py-[clamp(12px,1.4vw,24px)] last:col-span-2 md:last:col-span-1">
            <dt className="font-mono text-[clamp(11px,0.8vw,15px)] uppercase tracking-wider text-muted-foreground">{cell.label}</dt>
            <dd className={cn("font-heading text-[clamp(44px,min(5.2vw,9.5vh),108px)] font-extralight leading-none tracking-[-0.03em] tabular-nums", cell.tone)}>
              <TickerFigure value={cell.value}>{cell.display ?? cell.value}</TickerFigure>
            </dd>
            {cell.delta ? (
              <dd className="font-mono text-[clamp(11px,0.8vw,15px)]">
                <Delta current={cell.value} previous={cell.delta.previous} label={cell.delta.label} flatLabel={copy.wall.flat} upIsGood={cell.delta.upIsGood} />
              </dd>
            ) : null}
          </div>
        ))}
      </dl>

      <div className="grid gap-[clamp(14px,1.6vw,28px)] xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section aria-label={copy.wall.tape} className="x-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          <h2 className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="font-mono text-[clamp(11px,0.8vw,15px)] uppercase tracking-wider text-muted-foreground">{copy.wall.tape}</span>
            <span className="font-mono text-data tabular-nums text-tertiary">{batches.length}</span>
          </h2>
          {batches.length === 0 ? (
            <p className="px-5 py-10 text-[clamp(14px,1.1vw,20px)] text-muted-foreground">{copy.wall.tapeEmpty}</p>
          ) : (
            <ul className="grid divide-y divide-border xl:min-h-0 xl:flex-1 xl:auto-rows-fr">
              {batches.map((batch) => (
                <li
                  key={batch.id}
                  data-beam={batchState(batch.status) === "generating" ? "row" : undefined}
                  className="grid grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-4 gap-y-2 px-5 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[clamp(15px,1.15vw,22px)] font-medium">
                      {batch.productName ?? (locale === "en-US" ? batch.template.name : batch.template.nameZh)}
                    </span>
                    <span className="font-mono text-data text-tertiary">B·{batch.id.slice(-5).toUpperCase()}</span>
                  </span>
                  <StatusTick entity="batch" state={batchState(batch.status)} locale={locale} className="text-[clamp(11px,0.85vw,15px)]" />
                  <FillBar
                    counts={{
                      completed: batch.completedCount,
                      running: batch.runningCount,
                      paused: batch.pausedCount,
                      failed: batch.failedCount,
                      cancelled: batch.cancelledCount,
                    }}
                    total={batch.requestedCount}
                    className="h-2"
                  />
                  <span className="font-mono text-[clamp(13px,1vw,18px)] tabular-nums">
                    {batch.completedCount}<span className="text-tertiary">/{batch.requestedCount}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={copy.wall.media} className="x-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          <h2 className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="font-mono text-[clamp(11px,0.8vw,15px)] uppercase tracking-wider text-muted-foreground">{copy.wall.media}</span>
            <span className="font-mono text-data tabular-nums text-tertiary">{readings.media.length}</span>
          </h2>
          {readings.media.length === 0 ? (
            <p className="px-5 py-10 text-[clamp(14px,1.1vw,20px)] text-muted-foreground">{copy.wall.mediaEmpty}</p>
          ) : (
            // 成片是舞台：竖版原比例；大屏上一排三条占满高度，第 4 条起留给窄屏
            <ul className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:min-h-0 xl:flex-1 xl:grid-rows-1 xl:[&>li:nth-child(n+4)]:hidden">
              {readings.media.map((row) => (
                <li key={row.id} className="relative min-w-0 bg-sunken">
                  <div className="relative aspect-[9/16] w-full overflow-hidden xl:aspect-auto xl:h-full">
                    <WallVideo src={row.videoUrl as string} poster={row.thumbnailUrl ?? undefined} label={row.title} />
                    <div className="pointer-events-none absolute inset-0 bg-(image:--scrim)" aria-hidden />
                    <AiGeneratedLabel compact className="absolute left-2 top-2" />
                    <span className="absolute inset-x-3 bottom-3 truncate text-[clamp(12px,0.95vw,17px)] font-medium">{row.title}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="min-w-0 border-t border-border pt-[clamp(8px,0.8vw,14px)]">
        {report.length > 0 ? (
          <ExchangeTape
            items={report}
            locale={locale}
            label={copy.wall.report}
            trailing={copy.wall.source}
            className="h-[clamp(28px,2.2vw,40px)]"
            itemClassName="text-[clamp(11px,0.85vw,15px)]"
          />
        ) : (
          <p className="font-mono text-data uppercase tracking-wider text-tertiary">{copy.wall.source}</p>
        )}
      </footer>
    </div>
  );
}
