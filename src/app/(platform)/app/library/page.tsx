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
   * 成品库按生产线业务逻辑分三段，不把半成品伪装成成片卡：
   *   生产线上 —— 正在生成的任务（planning/generating/assembling），紧凑进度行，
   *               点进详情可跟踪 / 恢复 / 取消（铁律 #7 的入口在详情页）。
   *   成片     —— ready 的真成片，海报网格 + 品牌封装 / 交付动作。
   *   需要处理 —— failed，明确给「重新生成」而不是让它混在网格里装死。
   */
  const makingRows = rows.filter(
    (row) => row.status === "planning" || row.status === "generating" || row.status === "assembling",
  );
  const readyRows = rows.filter((row) => row.status === "ready");
  const failedRows = rows.filter((row) => row.status === "failed");

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

          {readyRows.length > 0 ? (
            <section aria-label={copy.sectionReady} className="space-y-3">
              {makingRows.length > 0 || failedRows.length > 0 ? (
                <h2 className="font-heading text-subhead font-semibold">
                  {copy.sectionReady}
                  <span className="ml-2 font-mono text-meta font-normal tabular-nums text-muted-foreground">{readyRows.length}</span>
                </h2>
              ) : null}
              <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={copy.listLabel}>
                {readyRows.map((row) => {
                  const href = detailHref(row);
                  const viewLabel = row.source === "post" ? copy.viewPost : copy.view;
                  return (
                    <li key={row.id} className="min-w-0">
                      <article className="group min-w-0 overflow-hidden rounded-(--radius-lg) border border-border bg-card transition-colors hover:border-border-strong">
                        <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <div className="relative aspect-video overflow-hidden bg-secondary">
                            {row.videoUrl ? (
                              <HoverPreviewVideo
                                src={row.videoUrl}
                                poster={row.thumbnailUrl ?? undefined}
                                ariaLabel={`${row.title} ${viewLabel}`}
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
                          <h2 className="min-w-0 truncate font-heading text-subhead font-semibold">{row.title}</h2>
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
                            {viewLabel}<ArrowRight aria-hidden />
                          </Button>
                        </div>
                      </article>
                    </li>
                  );
                })}
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
