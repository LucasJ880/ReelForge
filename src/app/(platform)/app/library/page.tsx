import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, Layers3, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { loadUnifiedLibrary, type UnifiedLibraryRow } from "@/lib/services/unified-library-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { HoverPreviewVideo } from "@/components/library/hover-preview-video";
import { BrandPackageButton } from "@/components/library/brand-package-button";
import { RenderPendingPostsButton } from "@/components/library/render-pending-posts-button";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { SectionHead } from "@/components/exchange/section-head";
import { StatusTick } from "@/components/exchange/status-tick";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
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

export default async function PlatformLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/library");
  const query = (await searchParams).q?.trim().toLocaleLowerCase() ?? "";
  const routeState = await getCustomerRouteRehearsalState("library");
  const [allRows, brandPackages] = await Promise.all([
    routeState === "empty" ? Promise.resolve([]) : loadUnifiedLibrary(session.user.id),
    listWorkspaceBrandPackagesForUser(session.user.id),
  ]);
  const preferredBrandPackage = brandPackages.find((brandPackage) => brandPackage.isDefault)
    ?? brandPackages[0]
    ?? null;
  const rows = query
    ? allRows.filter((row) => row.title.toLocaleLowerCase().includes(query) || row.id.toLocaleLowerCase().includes(query))
    : allRows;
  const copy = getPlatformCopy(await getServerLocale()).library;

  /*
   * 成品库按「一条生产线」的业务对象与阶段组织（PRD §4.3 按业务对象 / §10.5 新 IA）：
   *   生产线上   —— 机器真在生成的视频任务（点入可跟踪/恢复/取消）。
   *   待生成配图 —— 本周内容排好的图文帖，没有任务在跑，等商家动作。
   *                 绝不伪装成「生成中 0%」（0802 Lucas 实测：会被读成卡死）。
   *   成片·视频 / 成片·图文 —— 按业务对象分区，各自的动作不同
   *                 （视频：品牌封装/下载；图文：回本周内容查看文案）。
   *   需要处理   —— 失败任务，明确给重新生成。
   * 交付/发布：成片就绪后由青砚侧 aivora-sync 自动拉取、Postiz 排期（PRD O2）。
   */
  const isPost = (row: UnifiedLibraryRow) => row.source === "post";
  const inProgress = (row: UnifiedLibraryRow) =>
    row.status === "planning" || row.status === "generating" || row.status === "assembling";
  const makingRows = rows.filter((row) => inProgress(row) && !isPost(row));
  const actionRows = rows.filter((row) => inProgress(row) && isPost(row));
  const readyVideoRows = rows.filter((row) => row.status === "ready" && !isPost(row));
  const readyPostRows = rows.filter((row) => row.status === "ready" && isPost(row));
  const failedRows = rows.filter((row) => row.status === "failed");
  const readyCount = readyVideoRows.length + readyPostRows.length;

  /* 持仓读数墙：这页在整条生产线里的位置，四格都是真实计数，可点进对应工位 */
  const workflow = [
    { code: "01", label: copy.workflowPlan, hint: copy.workflowPlanHint, count: actionRows.length, tone: actionRows.length > 0 ? "text-gold" : "text-foreground", href: "/app/plan" },
    { code: "02", label: copy.workflowMaking, hint: copy.workflowMakingHint, count: makingRows.length, tone: makingRows.length > 0 ? "text-accent" : "text-foreground", href: "/app/batches" },
    { code: "03", label: copy.workflowReady, hint: copy.workflowReadyHint, count: readyCount, tone: readyCount > 0 ? "text-success" : "text-foreground", href: null },
    { code: "04", label: copy.workflowDeliver, hint: copy.workflowDeliverHint, count: null, tone: "text-foreground", href: null },
  ] as const;

  return (
    <div className="x-stack min-w-0">
      <QuoteHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <>
            <Button render={<Link href="/app/batches/new" />} variant="outline">
              <Layers3 aria-hidden />{copy.batch}
            </Button>
            <Button render={<Link href="/app/create" />}>
              <Plus aria-hidden />{copy.create}
            </Button>
          </>
        }
      />

      <nav aria-label={copy.workflowHint}>
        <ol className="x-wall x-frame grid-cols-2 lg:grid-cols-4">
          {workflow.map((stage) => {
            const body = (
              <>
                <span className="flex items-center justify-between gap-3">
                  <span className="x-label">{stage.code} · {stage.label}</span>
                  {stage.href ? <ArrowRight className="size-3.5 text-tertiary transition-colors group-hover:text-accent" aria-hidden /> : null}
                </span>
                <span className={cn("x-figure block", stage.tone)}>{stage.count ?? "—"}</span>
                <span className="block truncate text-meta text-muted-foreground">{stage.hint}</span>
              </>
            );
            return (
              <li key={stage.code} className="min-w-0">
                {stage.href ? (
                  <Link
                    href={stage.href}
                    className="group flex h-full flex-col gap-2.5 px-5 py-4 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="flex h-full flex-col gap-2.5 px-5 py-4">{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {rows.length === 0 ? (
        <section data-route-state="empty" className="x-panel x-frame px-6 py-12">
          <p className="max-w-[56ch] text-body text-muted-foreground">{query ? copy.noResults.replace("{query}", query) : copy.empty}</p>
          <Button render={<Link href="/app/templates" />} className="mt-5">{copy.browse}<ArrowRight aria-hidden /></Button>
        </section>
      ) : (
        <>
          {makingRows.length > 0 ? (
            <section aria-label={copy.sectionMaking} className="space-y-3">
              <SectionHead title={copy.sectionMaking} count={makingRows.length} countTone="live" hint={copy.sectionMakingHint} />
              <ul className="x-panel overflow-hidden">
                {makingRows.map((row) => (
                  <li key={row.id} data-beam="row" className="border-b border-border last:border-b-0">
                    <Link
                      href={detailHref(row)}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      aria-label={`${row.title} ${copy.viewProgress}`}
                    >
                      <span className="x-live" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">{row.title}</p>
                        <p className="font-mono text-data tabular-nums text-muted-foreground">
                          {copy.sourceLabels[row.source]} · {copy.statuses[row.status]} · {row.updatedAt.toLocaleDateString("en-CA")}
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
                        {copy.sourceLabels.post} · {row.updatedAt.toLocaleDateString("en-CA")}
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

          {readyVideoRows.length > 0 ? (
            <section aria-label={copy.sectionReady} className="space-y-3">
              <SectionHead title={copy.sectionReady} count={readyVideoRows.length} />
              {/* 成片是舞台：竖版 9:16 原比例展示，不裁成横版缩略图 */}
              <ul className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" aria-label={copy.listLabel}>
                {readyVideoRows.map((row) => {
                  const href = detailHref(row);
                  return (
                    <li key={row.id} className="min-w-0">
                      <article className="group min-w-0 overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-accent-line">
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
                            <span>{row.aspectRatio ?? copy.aspectPending}</span>
                            <span>{row.updatedAt.toLocaleDateString("en-CA")}</span>
                          </p>
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
                        <p className="mt-auto font-mono text-data tabular-nums text-muted-foreground">{row.updatedAt.toLocaleDateString("en-CA")}</p>
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

          {failedRows.length > 0 ? (
            <section aria-label={copy.sectionFailed} className="space-y-3">
              <SectionHead title={copy.sectionFailed} count={failedRows.length} countTone="fault" />
              <ul className="x-panel overflow-hidden">
                {failedRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
                    <StatusTick tone="fault" label={copy.statuses.failed} className="w-28 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{row.title}</p>
                      <p className="font-mono text-data tabular-nums text-muted-foreground">
                        {copy.sourceLabels[row.source]} · {row.updatedAt.toLocaleDateString("en-CA")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {row.source === "order" ? (
                        <Button render={<Link href={`/app/create?retry=${encodeURIComponent(row.id)}`} />} variant="outline" size="sm">
                          {copy.regenerate}
                        </Button>
                      ) : null}
                      <Button render={<Link href={detailHref(row)} />} variant="ghost" size="sm">
                        {row.source === "post" ? copy.viewPost : copy.view}<ArrowRight aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-meta text-muted-foreground">{copy.failed}</p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
