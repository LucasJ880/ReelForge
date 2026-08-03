import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarRange, Clapperboard, Film, Layers3, Plus, Send } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { loadUnifiedLibrary, type UnifiedLibraryRow } from "@/lib/services/unified-library-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { HoverPreviewVideo } from "@/components/library/hover-preview-video";
import { BrandPackageButton } from "@/components/library/brand-package-button";
import { RenderPendingPostsButton } from "@/components/library/render-pending-posts-button";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";

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

  const workflow = [
    { icon: CalendarRange, label: copy.workflowPlan, hint: copy.workflowPlanHint, count: actionRows.length, countNeedsAction: true, href: "/app/plan" },
    { icon: Clapperboard, label: copy.workflowMaking, hint: copy.workflowMakingHint, count: makingRows.length, countNeedsAction: false, href: "/app/batches" },
    { icon: Film, label: copy.workflowReady, hint: copy.workflowReadyHint, count: readyCount, countNeedsAction: false, href: null },
    { icon: Send, label: copy.workflowDeliver, hint: copy.workflowDeliverHint, count: null, countNeedsAction: false, href: null },
  ] as const;

  return (
    <div className="editorial-page-stack min-w-0">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
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

      {/* 工作流总览：这个页面在整条生产线里的位置，一眼可读 */}
      <nav aria-label={copy.workflowHint} className="glass-well overflow-x-auto rounded-(--radius-lg)">
        <ol className="flex min-w-fit items-stretch">
          {workflow.map((stage, index) => {
            const Icon = stage.icon;
            const body = (
              <>
                <span className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-body font-medium">{stage.label}</span>
                  {stage.count !== null ? (
                    <span
                      className={`font-mono text-meta tabular-nums ${
                        stage.countNeedsAction && stage.count > 0 ? "text-accent" : "text-muted-foreground"
                      }`}
                    >
                      {stage.count}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-meta text-muted-foreground">{stage.hint}</span>
              </>
            );
            return (
              <li key={stage.label} className="flex min-w-44 flex-1 items-stretch">
                {index > 0 ? (
                  <span aria-hidden className="my-4 w-px shrink-0 bg-border" />
                ) : null}
                {stage.href ? (
                  <Link
                    href={stage.href}
                    className="block w-full px-4 py-3 transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="block w-full px-4 py-3">{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {rows.length === 0 ? (
        <section data-route-state="empty" className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">{query ? copy.noResults.replace("{query}", query) : copy.empty}</p>
          <Button render={<Link href="/app/templates" />} className="mt-5">{copy.browse}<ArrowRight aria-hidden /></Button>
        </section>
      ) : (
        <>
          {makingRows.length > 0 ? (
            <section aria-label={copy.sectionMaking} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-subhead font-semibold">
                  {copy.sectionMaking}
                  <span className="ml-2 font-mono text-meta font-normal tabular-nums text-muted-foreground">{makingRows.length}</span>
                </h2>
                <p className="text-meta text-muted-foreground">{copy.sectionMakingHint}</p>
              </div>
              <ul className="glass-well overflow-hidden rounded-(--radius-md)">
                {makingRows.map((row) => (
                  <li key={row.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={detailHref(row)}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      aria-label={`${row.title} ${copy.viewProgress}`}
                    >
                      {/* 进行中 = 当前项，accent 呼吸点 */}
                      <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">{row.title}</p>
                        <p className="font-mono text-meta tabular-nums text-muted-foreground">
                          {copy.sourceLabels[row.source]} · {copy.statuses[row.status]} · {row.updatedAt.toLocaleDateString("en-CA")}
                        </p>
                      </div>
                      <div className="hidden w-36 shrink-0 sm:block">
                        <Progress value={row.progress} aria-label={`${row.title} ${copy.progress}`} />
                      </div>
                      <span className="w-11 shrink-0 text-right font-mono text-meta tabular-nums">{row.progress}%</span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {actionRows.length > 0 ? (
            <section aria-label={copy.sectionAction} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-heading text-subhead font-semibold">
                    {copy.sectionAction}
                    {/* 需要行动的数字 —— accent 三处限额之一 */}
                    <span className="ml-2 font-mono text-meta font-normal tabular-nums text-accent">{actionRows.length}</span>
                  </h2>
                  <p className="mt-1 text-meta text-muted-foreground">{copy.sectionActionHint}</p>
                </div>
                <RenderPendingPostsButton
                  items={actionRows.map((row) => ({ planId: row.planId ?? "", postId: postIdOf(row) })).filter((item) => item.planId)}
                />
              </div>
              <ul className="overflow-hidden rounded-(--radius-md) border border-border bg-card">
                {actionRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{row.title}</p>
                      <p className="font-mono text-meta tabular-nums text-muted-foreground">
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
              <h2 className="font-heading text-subhead font-semibold">
                {copy.sectionReady}
                <span className="ml-2 font-mono text-meta font-normal tabular-nums text-muted-foreground">{readyVideoRows.length}</span>
              </h2>
              <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={copy.listLabel}>
                {readyVideoRows.map((row) => {
                  const href = detailHref(row);
                  return (
                    <li key={row.id} className="min-w-0">
                      <article className="group min-w-0 overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-border-strong">
                        <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <div className="relative aspect-video overflow-hidden bg-secondary">
                            {row.videoUrl ? (
                              <HoverPreviewVideo
                                src={row.videoUrl}
                                poster={row.thumbnailUrl ?? undefined}
                                ariaLabel={`${row.title} ${copy.view}`}
                              />
                            ) : row.thumbnailUrl ? (
                              <Image src={row.thumbnailUrl} alt="" fill unoptimized sizes="(min-width: 1280px) 30vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center px-6 text-center">
                                <span className="text-meta text-muted-foreground">{copy.statuses[row.status]}</span>
                              </div>
                            )}
                            {row.durationSec ? (
                              <span className="absolute right-3 top-3 rounded-(--radius-sm) bg-card px-2 py-1 font-mono text-meta tabular-nums">{row.durationSec}s</span>
                            ) : null}
                            {row.isShowcase ? <Badge variant="secondary" className="absolute left-3 top-3" title={copy.showcaseHint}>{copy.showcaseBadge}</Badge> : null}
                            <AiGeneratedLabel className="absolute bottom-3 left-3" />
                          </div>
                        </Link>
                        <div className="space-y-3 p-4">
                          <h3 className="min-w-0 truncate font-heading text-subhead font-semibold">{row.title}</h3>
                          <p className="font-mono text-meta tabular-nums text-muted-foreground">{row.aspectRatio ?? copy.aspectPending} · {row.updatedAt.toLocaleDateString("en-CA")}</p>
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
                          <Button render={<Link href={href} />} variant="ghost" size="sm">
                            {copy.view}<ArrowRight aria-hidden />
                          </Button>
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
              <h2 className="font-heading text-subhead font-semibold">
                {copy.sectionReadyPosts}
                <span className="ml-2 font-mono text-meta font-normal tabular-nums text-muted-foreground">{readyPostRows.length}</span>
              </h2>
              <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {readyPostRows.map((row) => (
                  <li key={row.id} className="min-w-0">
                    <article className="group flex min-w-0 flex-col overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-border-strong">
                      {row.imageUrls.length > 0 ? (
                        <Link href="/app/plan" className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <div className="relative aspect-[3/2] overflow-hidden bg-secondary">
                            <Image src={row.imageUrls[0]} alt="" fill unoptimized sizes="(min-width: 1280px) 30vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                            {row.imageUrls.length > 1 ? (
                              <span className="absolute right-3 top-3 rounded-(--radius-sm) bg-card px-2 py-1 font-mono text-meta tabular-nums">
                                {copy.carouselCount.replace("{n}", String(row.imageUrls.length))}
                              </span>
                            ) : null}
                            <AiGeneratedLabel className="absolute bottom-3 left-3" />
                          </div>
                        </Link>
                      ) : null}
                      <div className="flex flex-1 flex-col gap-3 p-4">
                        <h3 className="min-w-0 font-heading text-subhead font-semibold">{row.title}</h3>
                        <p className="mt-auto font-mono text-meta tabular-nums text-muted-foreground">{row.updatedAt.toLocaleDateString("en-CA")}</p>
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
              <h2 className="font-heading text-subhead font-semibold">
                {copy.sectionFailed}
                <span className="ml-2 font-mono text-meta font-normal tabular-nums text-muted-foreground">{failedRows.length}</span>
              </h2>
              <ul className="overflow-hidden rounded-(--radius-md) border border-border bg-card">
                {failedRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
                    <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{row.title}</p>
                      <p className="font-mono text-meta tabular-nums text-muted-foreground">
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
