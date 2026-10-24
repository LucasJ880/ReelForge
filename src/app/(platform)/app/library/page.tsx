import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, Layers3, Music, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { loadUnifiedLibrary, type UnifiedLibraryRow } from "@/lib/services/unified-library-service";
import {
  countFinished,
  loadNeedsAttention,
  loadProductionCounts,
  type NeedsAttentionItem,
} from "@/lib/services/exchange-readings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { HoverPreviewVideo } from "@/components/library/hover-preview-video";
import { BrandPackageButton } from "@/components/library/brand-package-button";
import { FailuresAckButton } from "@/components/library/failures-ack-button";
import { LibraryHighlight } from "@/components/library/library-highlight";
import { RenderPendingPostsButton } from "@/components/library/render-pending-posts-button";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { LocalTime } from "@/components/exchange/local-time";
import type { QuoteStat } from "@/components/exchange/quote-header";
import { WorkspacePage } from "@/components/exchange/workspace-page";
import { EmptyState } from "@/components/exchange/empty-state";
import { SectionHead } from "@/components/exchange/section-head";
import { StatusTick } from "@/components/exchange/status-tick";
import { getPlatformCopy, type PlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { readingFormula, readingName } from "@/lib/exchange/readings-registry";
import { libraryRowState } from "@/lib/exchange/state-vocab";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/// 图文帖的家是「本周内容」——它没有可播放的成片，
/// 链到视频详情页只会 404（0802 录屏抓到的真实事故）。
function detailHref(row: UnifiedLibraryRow): string {
  return row.source === "batch"
    ? `/app/batches/${row.batchId}`
    : row.source === "post"
      ? "/app/plan"
      : `/app/library/${row.id}`;
}

function postIdOf(row: UnifiedLibraryRow): string {
  return row.id.replace(/^post-/, "");
}

/** 英文界面的失败原因按 code 取译文（服务端 classify 给的是中文客户文案）。 */
function failureReason(item: NeedsAttentionItem, english: boolean, failures: PlatformCopy["batches"]["monitor"]["failures"]): string {
  if (!english) return item.reason;
  switch (item.code) {
    case "SUBMISSION_ACK_UNKNOWN":
      return failures.acknowledgementUnknown;
    case "ASSET_MISSING":
      return failures.assetMissing;
    case "PROVIDER_TIMEOUT":
      return failures.providerTimeout;
    default:
      return failures.providerError;
  }
}

const EMPTY_PRODUCTION = { generating: 0, queued: 0, activeBatches: 0, pausedBatches: 0, awaitingImages: 0 };

export default async function PlatformLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; highlight?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/library");
  const userId = session.user.id;
  const params = await searchParams;
  const query = params.q?.trim().toLocaleLowerCase() ?? "";
  const highlight = typeof params.highlight === "string" && params.highlight ? params.highlight : null;
  const routeState = await getCustomerRouteRehearsalState("library");
  const empty = routeState === "empty";
  const [library, attention, production, finished, brandPackages, locale] = await Promise.all([
    empty ? Promise.resolve({ rows: [] as UnifiedLibraryRow[], truncated: false, perSourceLimit: 0 }) : loadUnifiedLibrary(userId),
    empty ? Promise.resolve({ items: [] as NeedsAttentionItem[], total: 0 }) : loadNeedsAttention(userId),
    empty ? Promise.resolve(EMPTY_PRODUCTION) : loadProductionCounts(userId),
    empty ? Promise.resolve(0) : countFinished(userId),
    listWorkspaceBrandPackagesForUser(userId),
    getServerLocale(),
  ]);
  const preferredBrandPackage = brandPackages.find((brandPackage) => brandPackage.isDefault)
    ?? brandPackages[0]
    ?? null;
  const matches = (title: string, id: string) =>
    !query || title.toLocaleLowerCase().includes(query) || id.toLocaleLowerCase().includes(query);
  const rows = library.rows.filter((row) => matches(row.title, row.id));
  const failures = attention.items.filter((item) => matches(item.title, item.rowId));
  const allCopy = getPlatformCopy(locale);
  const copy = allCopy.library;
  const english = locale === "en-US";
  const supportEmail = process.env.AIVORA_CONTACT_EMAIL?.trim() || process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || null;
  const isHighlighted = (rowId: string) => (highlight === rowId ? "true" : undefined);

  /*
   * 成品库按「一条生产线」的业务对象与阶段组织（PRD §4.3 按业务对象 / §10.5 新 IA）：
   *   需要处理   —— 近 7 天失败、未重试成功、没看过的视频（与导轨红色徽标同一个查询）。
   *   生产线上   —— 供应商侧真在生成的视频（点入可跟踪/取消）。只有这里挂光束。
   *   排队与暂停 —— 还没开始或已暂停的视频：不挂光束、不写 0%。
   *   待生成配图 —— 本周内容排好的图文帖，没有任务在跑，等商家动作。
   *   待生产     —— 短视频帖只有脚本，不是成片。
   *   成片·视频 / 成片·图文 —— 按业务对象分区，各自的动作不同。
   * 交付/发布：成片就绪后由青砚侧 aivora-sync 自动拉取、Postiz 排期（PRD O2）。
   */
  const isPost = (row: UnifiedLibraryRow) => row.source === "post";
  const makingRows = rows.filter((row) => !isPost(row) && (row.status === "generating" || row.status === "assembling"));
  const waitingRows = rows.filter((row) => !isPost(row) && (row.status === "planning" || row.status === "paused"));
  const actionRows = rows.filter((row) => isPost(row) && row.status === "planning" && row.postFormat !== "VIDEO");
  const toProduceRows = rows.filter((row) => isPost(row) && row.status === "planning" && row.postFormat === "VIDEO");
  /// 失败但还留着可播放媒体的行（可恢复的输出）照样放在成片墙上，客户不丢媒体。
  const readyVideoRows = rows.filter(
    (row) => (row.status === "ready" && !isPost(row)) || (row.status === "failed" && !isPost(row) && Boolean(row.videoUrl)),
  );
  const readyPostRows = rows.filter((row) => row.status === "ready" && isPost(row));
  const nothing = rows.length === 0 && failures.length === 0;

  /* 持仓读数墙：这页在整条生产线里的位置，名字与口径来自读数注册表，与壳层同源；能去的格子整格可点 */
  const workflow: QuoteStat[] = [
    { label: `01 · ${readingName("awaitingImages", locale)}`, caption: readingFormula("awaitingImages", locale), value: production.awaitingImages, tone: production.awaitingImages > 0 ? "winner" : "neutral", href: "/app/plan" },
    { label: `02 · ${readingName("generating", locale)}`, caption: readingFormula("generating", locale), value: production.generating, tone: production.generating > 0 ? "live" : "neutral", href: "/app/batches" },
    { label: `03 · ${readingName("finished", locale)}`, caption: readingFormula("finished", locale), value: finished, tone: finished > 0 ? "filled" : "neutral" },
    { label: `04 · ${copy.workflowDeliver}`, caption: copy.workflowDeliverHint, value: "—" },
  ];

  return (
    <WorkspacePage
      nav="library"
      locale={locale}
      subtitle={copy.subtitle}
      secondaryActions={
        <Button render={<Link href="/app/batches/new" />} variant="outline">
          <Layers3 aria-hidden />{copy.batch}
        </Button>
      }
      primaryAction={
        <Button render={<Link href="/app/create" />}>
          <Plus aria-hidden />{copy.create}
        </Button>
      }
      readingsLabel={copy.workflowHint}
      readings={workflow}
      scope={copy.scope}
    >
      {highlight ? <LibraryHighlight rowId={highlight} /> : null}
      {library.truncated ? (
        <p className="-mt-6 font-mono text-data text-tertiary" data-testid="library-truncated">
          {copy.truncated.replace("{n}", String(library.perSourceLimit))}
        </p>
      ) : null}

      {nothing ? (
        <EmptyState
          data-route-state="empty"
          body={query ? copy.noResults.replace("{query}", query) : copy.empty}
          action={{ label: copy.browse, href: "/app/templates", icon: <ArrowRight aria-hidden /> }}
        />
      ) : (
        <>
          {failures.length > 0 ? (
            <section aria-label={copy.sectionFailed} className="space-y-3" data-testid="needs-attention">
              <SectionHead
                title={copy.sectionFailed}
                count={attention.total}
                countTone="fault"
                hint={copy.sectionFailedHint}
                action={<FailuresAckButton copy={{ acknowledge: copy.acknowledge, acknowledging: copy.acknowledging, acknowledgeFailed: copy.acknowledgeFailed }} />}
              />
              <ul className="x-panel overflow-hidden">
                {failures.map((item) => (
                  <li
                    key={item.rowId}
                    data-library-row={item.rowId}
                    data-highlighted={isHighlighted(item.rowId)}
                    className="grid gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <StatusTick entity="item" state="failed" locale={locale} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{item.title}</p>
                      <p className="text-meta text-muted-foreground">{failureReason(item, english, allCopy.batches.monitor.failures)}</p>
                      <p className="font-mono text-data tabular-nums text-tertiary">
                        {copy.sourceLabels[item.kind]} · <LocalTime iso={item.at.toISOString()} locale={locale} variant="relative" />
                        {item.action === "contact_support" && !supportEmail ? <> · {copy.supportHint} {item.rowId}</> : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.action === "contact_support" ? (
                        supportEmail ? (
                          <Button
                            render={<a href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Aivora support · ${item.rowId}`)}`} />}
                            variant="outline"
                            size="sm"
                          >
                            {copy.contactSupport}
                          </Button>
                        ) : null
                      ) : item.retryHref ? (
                        <Button render={<Link href={item.retryHref} />} variant="outline" size="sm">
                          {copy.regenerate}
                        </Button>
                      ) : (
                        <Button render={<Link href={item.href} />} variant="outline" size="sm">
                          {copy.retryInBatch}
                        </Button>
                      )}
                      {/* 批量失败的主按钮已链到批次详情；单条与「联系支持」类再给一个详情入口 */}
                      {item.kind === "order" || item.action === "contact_support" ? (
                        <Button render={<Link href={item.href} />} variant="ghost" size="sm">
                          {copy.viewDetail}<ArrowRight aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {attention.total > failures.length && !query ? (
                <p className="text-meta text-muted-foreground">{copy.failedMore.replace("{n}", String(attention.total - failures.length))}</p>
              ) : null}
            </section>
          ) : null}

          {makingRows.length > 0 ? (
            <section aria-label={copy.sectionMaking} className="space-y-3">
              <SectionHead title={copy.sectionMaking} count={makingRows.length} countTone="live" hint={copy.sectionMakingHint} />
              <ul className="x-panel overflow-hidden">
                {makingRows.map((row) => (
                  <li
                    key={row.id}
                    data-beam="row"
                    data-library-row={row.id}
                    data-highlighted={isHighlighted(row.id)}
                    className="border-b border-border last:border-b-0"
                  >
                    <Link
                      href={detailHref(row)}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      aria-label={`${row.title} ${copy.viewProgress}`}
                    >
                      <span className="x-live" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">{row.title}</p>
                        <p className="font-mono text-data tabular-nums text-muted-foreground">
                          {copy.sourceLabels[row.source]} · {copy.statuses[row.status]} · <LocalTime iso={row.updatedAt.toISOString()} locale={locale} variant="relative" />
                        </p>
                      </div>
                      <div className="hidden w-40 shrink-0 sm:block">
                        <Progress value={row.progress} aria-label={`${row.title} ${copy.progress}`} />
                      </div>
                      <span className="w-11 shrink-0 text-right font-mono text-data tabular-nums text-accent">{row.progress}%</span>
                      <ArrowRight className="size-4 shrink-0 text-tertiary" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {waitingRows.length > 0 ? (
            <section aria-label={copy.sectionQueued} className="space-y-3">
              <SectionHead title={copy.sectionQueued} count={waitingRows.length} hint={copy.sectionQueuedHint} />
              {/* 排队与暂停：不挂光束、不写 0%、不放实时点（DESIGN：暂停的不挂） */}
              <ul className="x-panel overflow-hidden">
                {waitingRows.map((row) => (
                  <li
                    key={row.id}
                    data-library-row={row.id}
                    data-highlighted={isHighlighted(row.id)}
                    className="border-b border-border last:border-b-0"
                  >
                    <Link
                      href={detailHref(row)}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      aria-label={`${row.title} ${copy.viewProgress}`}
                    >
                      <StatusTick entity="item" state={libraryRowState(row.status)} locale={locale} className="w-20 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">{row.title}</p>
                        <p className="font-mono text-data tabular-nums text-muted-foreground">
                          {copy.sourceLabels[row.source]} · <LocalTime iso={row.updatedAt.toISOString()} locale={locale} variant="relative" />
                        </p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-tertiary" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {actionRows.length > 0 ? (
            <section aria-label={copy.sectionAction} className="space-y-3">
              <SectionHead
                title={copy.sectionAction}
                count={actionRows.length}
                countTone="winner"
                hint={copy.sectionActionHint}
                action={
                  <RenderPendingPostsButton
                    items={actionRows.map((row) => ({ planId: row.planId ?? "", postId: postIdOf(row) })).filter((item) => item.planId)}
                  />
                }
              />
              <ul className="x-panel overflow-hidden">
                {actionRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{row.title}</p>
                      <p className="font-mono text-data tabular-nums text-muted-foreground">
                        {copy.sourceLabels.post} · <LocalTime iso={row.updatedAt.toISOString()} locale={locale} variant="date" />
                      </p>
                    </div>
                    <Button render={<Link href="/app/plan" />} variant="outline" size="sm" className="shrink-0">
                      {copy.goRender}<ArrowRight aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {toProduceRows.length > 0 ? (
            <section aria-label={copy.sectionToProduce} className="space-y-3">
              <SectionHead title={copy.sectionToProduce} count={toProduceRows.length} hint={copy.sectionToProduceHint} />
              <ul className="x-panel overflow-hidden">
                {toProduceRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{row.title}</p>
                      <p className="font-mono text-data tabular-nums text-muted-foreground">
                        {copy.sourceLabels.post} · <LocalTime iso={row.updatedAt.toISOString()} locale={locale} variant="date" />
                      </p>
                    </div>
                    <Button render={<Link href="/app/plan" />} variant="ghost" size="sm" className="shrink-0">
                      {copy.viewPost}<ArrowRight aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {readyVideoRows.length > 0 ? (
            <section aria-label={copy.sectionReady} className="space-y-3">
              <SectionHead title={copy.sectionReady} count={readyVideoRows.length} />
              {/* 成片是舞台：竖版 9:16 原比例展示，不裁成横版缩略图 */}
              <ul className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" aria-label={copy.listLabel}>
                {readyVideoRows.map((row) => {
                  const href = detailHref(row);
                  return (
                    <li key={row.id} className="min-w-0" data-library-row={row.id}>
                      <article
                        data-highlighted={isHighlighted(row.id)}
                        className="group min-w-0 overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-accent-line"
                      >
                        <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <div className={cn("relative overflow-hidden bg-sunken", row.aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]")}>
                            {row.videoUrl ? (
                              <HoverPreviewVideo
                                src={row.videoUrl}
                                poster={row.thumbnailUrl ?? undefined}
                                ariaLabel={`${row.title} ${copy.view}`}
                              />
                            ) : row.thumbnailUrl ? (
                              <Image src={row.thumbnailUrl} alt="" fill unoptimized sizes="(min-width: 1280px) 22vw, (min-width: 768px) 33vw, 50vw" className="object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center px-6 text-center">
                                <span className="text-meta text-muted-foreground">{copy.statuses[row.status]}</span>
                              </div>
                            )}
                            <div className="pointer-events-none absolute inset-0 bg-(image:--scrim)" aria-hidden />
                            {row.durationSec ? (
                              <span className="absolute right-2 top-2 rounded-(--radius-sm) bg-sunken/90 px-1.5 py-0.5 font-mono text-data tabular-nums">{row.durationSec}s</span>
                            ) : null}
                            {row.isShowcase ? <Badge variant="secondary" className="absolute left-2 top-2 rounded-(--radius-sm) bg-sunken/90 px-1.5 py-0.5" title={copy.showcaseHint}>{copy.showcaseBadge}</Badge> : null}
                            <AiGeneratedLabel className="absolute bottom-2 left-2" compact />
                          </div>
                        </Link>
                        <div className="space-y-2 p-3">
                          <h3 className="min-w-0 truncate text-body font-medium">{row.title}</h3>
                          <p className="flex items-center justify-between gap-2 font-mono text-data tabular-nums text-muted-foreground">
                            {row.status === "failed" ? (
                              <StatusTick entity="item" state="failed" locale={locale} />
                            ) : (
                              <span>{row.aspectRatio ?? copy.aspectPending}</span>
                            )}
                            <LocalTime iso={row.updatedAt.toISOString()} locale={locale} variant="date" />
                          </p>
                          {row.bgmAttribution ? (
                            /* CC BY 配乐：署名随交付给客户（截断显示，选中复制得到全文） */
                            <p className="flex min-w-0 items-center gap-1.5 text-micro text-tertiary" title={row.bgmAttribution}>
                              <Music className="size-3 shrink-0" aria-label={copy.musicCredit} />
                              <span className="truncate">{row.bgmAttribution}</span>
                            </p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {row.videoUrl && !row.isShowcase ? (
                              <BrandPackageButton
                                videoJobId={row.videoJobId}
                                briefId={row.briefId}
                                brandPackageId={preferredBrandPackage?.id ?? null}
                                brandedVideoUrl={row.brandedVideoUrl}
                                aspectRatio={row.aspectRatio}
                                copy={{
                                  package: copy.brandPackage,
                                  packaging: copy.brandPackaging,
                                  packaged: copy.brandPackaged,
                                  download: copy.downloadDelivery,
                                  failed: copy.brandPackageFailed,
                                }}
                              />
                            ) : null}
                            <Button render={<Link href={href} />} variant="ghost" size="sm" className="ml-auto">
                              {copy.view}<ArrowRight aria-hidden />
                            </Button>
                          </div>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {readyPostRows.length > 0 ? (
            <section aria-label={copy.sectionReadyPosts} className="space-y-3">
              <SectionHead title={copy.sectionReadyPosts} count={readyPostRows.length} />
              <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {readyPostRows.map((row) => (
                  <li key={row.id} className="min-w-0">
                    <article className="group flex min-w-0 flex-col overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-accent-line">
                      {row.imageUrls.length > 0 ? (
                        <Link href="/app/plan" className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <div className="relative aspect-[3/2] overflow-hidden bg-sunken">
                            <Image src={row.imageUrls[0]} alt="" fill unoptimized sizes="(min-width: 1280px) 30vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                            {row.imageUrls.length > 1 ? (
                              <span className="absolute right-2 top-2 rounded-(--radius-sm) bg-sunken/90 px-1.5 py-0.5 font-mono text-data tabular-nums">
                                {copy.carouselCount.replace("{n}", String(row.imageUrls.length))}
                              </span>
                            ) : null}
                            <AiGeneratedLabel className="absolute bottom-2 left-2" />
                          </div>
                        </Link>
                      ) : null}
                      <div className="flex flex-1 flex-col gap-2 p-4">
                        <h3 className="min-w-0 text-body font-medium">{row.title}</h3>
                        <p className="mt-auto font-mono text-data tabular-nums text-muted-foreground">
                          <LocalTime iso={row.updatedAt.toISOString()} locale={locale} variant="date" />
                        </p>
                        <Button render={<Link href="/app/plan" />} variant="ghost" size="sm" className="self-start">
                          {copy.viewPost}<ArrowRight aria-hidden />
                        </Button>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </WorkspacePage>
  );
}
