import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerTranslator } from "@/i18n/server";
import type { TranslationKey } from "@/i18n/types";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { BriefRenderAutoRefresh } from "@/components/video-generation/brief-render-auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  deriveBusinessStatus,
  summarizeRunningJobs,
  type BusinessVideoStatus,
} from "@/lib/video-generation/business-status";
import type { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ highlight?: string }>;
}

interface ProductRow {
  id: string;
  title: string;
  productCategory: string;
  updatedAt: Date;
  briefId: string | null;
  briefStatus: VideoBriefStatus | null;
  finalVideoStatus: FinalVideoStatus | null;
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  aspectRatio: string | null;
  durationSec: number | null;
  segmentCount: number;
  segmentsSucceeded: number;
  jobStatuses: VideoJobStatus[];
  businessStatus: BusinessVideoStatus;
  businessLabel: string;
  businessShortLabel: string;
  progressHint: number;
  isPersonal: boolean;
}

const STATUS_VARIANT: Record<
  BusinessVideoStatus,
  "secondary" | "warning" | "default" | "success" | "destructive"
> = {
  planning: "secondary",
  generating: "warning",
  assembling: "default",
  ready: "success",
  failed: "destructive",
};

/**
 * 客户友好的进度提示，避免使用「段」「片段」等内部术语。
 * "正在生成 2 / 3 个画面" 比 "2/3 段已完成" 更易理解，且不暗示底层多段拼接结构。
 */
function progressDescription(
  row: ProductRow,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string | null {
  if (row.businessStatus === "ready" || row.businessStatus === "failed")
    return null;
  if (row.segmentCount <= 0) return null;
  if (row.businessStatus === "generating") {
    return t("shell.productsPage.progressScenes", {
      done: row.segmentsSucceeded,
      total: row.segmentCount,
    });
  }
  if (row.businessStatus === "assembling") {
    return t("shell.productsPage.assembling");
  }
  return null;
}

async function loadProductRows(userId: string): Promise<ProductRow[]> {
  const orders = await db.deliveryOrder.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      productCategory: true,
      updatedAt: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              videoBrief: {
                select: {
                  id: true,
                  persona: true,
                  status: true,
                  aspectRatio: true,
                  durationSec: true,
                  finalVideoUrl: true,
                  finalThumbnailUrl: true,
                  finalVideo: {
                    select: {
                      status: true,
                      stitchedVideoUrl: true,
                      thumbnailUrl: true,
                      segmentCount: true,
                    },
                  },
                  videoJobs: {
                    select: {
                      status: true,
                      lastProgress: true,
                      submittedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return orders
    /// Phase 6 fix：仅展示 BUSINESS 视频，避免 PERSONAL（unified-input persona=PERSONAL）泄漏到商家面板
    .filter((o) => {
      const persona = o.rounds[0]?.angles[0]?.videoBrief?.persona ?? null;
      /// 老 brief 没标 persona（productCategory != 'unified_input' 的历史数据）也允许展示
      return persona !== "PERSONAL";
    })
    .map((o) => {
      const brief = o.rounds[0]?.angles[0]?.videoBrief ?? null;
      const finalVideo = brief?.finalVideo ?? null;
      const jobStatuses = brief?.videoJobs?.map((j) => j.status) ?? [];
      const segmentsSucceeded = jobStatuses.filter((s) => s === "SUCCEEDED").length;
      const segmentCount = finalVideo?.segmentCount ?? jobStatuses.length;
      const status = deriveBusinessStatus({
        briefStatus: brief?.status ?? null,
        finalVideoStatus: finalVideo?.status ?? null,
        segmentsSucceeded,
        segmentsTotal: segmentCount,
        jobStatuses,
        /// INV-5：段内进度 = provider 真实 progress 优先，缺失时按运行时长估算
        ...summarizeRunningJobs(brief?.videoJobs ?? []),
      });
      const finalUrl = finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl ?? null;
      /// 防御：file:// 不能直接给客户用浏览器打开（Phase 2 dev 模式才会出现），
      /// 也不应该作为 ready 视频的 link。视为「视频未就绪」。
      const customerSafeUrl =
        finalUrl && /^https?:\/\//i.test(finalUrl) ? finalUrl : null;
      return {
        id: o.id,
        title: o.title,
        productCategory: o.productCategory,
        updatedAt: o.updatedAt,
        briefId: brief?.id ?? null,
        briefStatus: brief?.status ?? null,
        finalVideoStatus: finalVideo?.status ?? null,
        finalVideoUrl: customerSafeUrl,
        finalThumbnailUrl: finalVideo?.thumbnailUrl ?? brief?.finalThumbnailUrl ?? null,
        aspectRatio: brief?.aspectRatio ?? null,
        durationSec: brief?.durationSec ?? null,
        segmentCount,
        segmentsSucceeded,
        jobStatuses,
        businessStatus: status.status,
        businessLabel: status.label,
        businessShortLabel: status.shortLabel,
        progressHint: status.progressHint,
        isPersonal: brief?.persona === "PERSONAL",
      } satisfies ProductRow;
    });
}

export default async function BusinessProductsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/products");

  const sp = await searchParams;
  const highlight = sp?.highlight ?? null;
  const { t } = await getServerTranslator();

  const products = await loadProductRows(session.user.id).catch(
    () => [] as ProductRow[],
  );

  const pollTargets = products
    .filter((p) => p.briefId)
    .map((p) => ({
      briefId: p.briefId!,
      active:
        p.businessStatus === "planning" ||
        p.businessStatus === "generating" ||
        p.businessStatus === "assembling",
    }));

  return (
    <div className="space-y-8">
      <BriefRenderAutoRefresh targets={pollTargets} />
      <BusinessPageHeader
        kicker={t("shell.productsPage.kicker")}
        title={t("shell.productsPage.title")}
        subtitle={t("shell.productsPage.subtitle")}
        action={
          <Button
            render={<Link href="/business/create-ad-video" />}
            className="w-full sm:w-auto"
          >
            {t("shell.productsPage.newAd")}
          </Button>
        }
      />

      {products.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 text-center">
          <h2 className="font-heading text-subhead font-normal">
            {t("shell.productsPage.emptyTitle")}
          </h2>
          <p className="text-body text-muted-foreground">
            {t("shell.productsPage.emptyBody")}
          </p>
          <Button
            render={<Link href="/business/create-ad-video" />}
          >
            {t("shell.productsPage.emptyCta")}
          </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {products.map((p) => {
            const isHighlighted = highlight && p.id === highlight;
            const isReady = p.businessStatus === "ready";
            const isFailed = p.businessStatus === "failed";
            const isReadyButLinkPending = isReady && !p.finalVideoUrl;
            const progressLine = progressDescription(p, t);
            const statusKey = p.businessStatus;
            const showProgressBar =
              p.businessStatus === "generating" || p.businessStatus === "assembling";

            return (
              <li
                key={p.id}
              >
                <Card className={isHighlighted ? "border-success" : undefined} size="sm">
                  <CardContent className="pt-2">
                <div className="flex min-w-0 items-start gap-4">
                  {p.finalThumbnailUrl ? (
                    <Link
                      href={`/business/products/${p.id}`}
                      className="relative shrink-0 overflow-hidden rounded-(--radius-md) border border-border bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.finalThumbnailUrl}
                        alt=""
                        className="h-[88px] w-[66px] object-cover"
                      />
                    </Link>
                  ) : (
                    <div className="flex h-[88px] w-[66px] shrink-0 items-center justify-center rounded-(--radius-md) border border-dashed border-border bg-muted text-meta text-muted-foreground">
                      9:16
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/business/products/${p.id}`}
                        className="min-w-0 truncate text-body font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {p.title}
                      </Link>
                      <Badge variant={STATUS_VARIANT[p.businessStatus]}>
                        {t(`shell.businessStatus.${statusKey}.short`)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-meta text-muted-foreground">
                      {isReadyButLinkPending
                        ? t("shell.productsPage.linkPending")
                        : t(`shell.businessStatus.${statusKey}.label`)}
                      {p.aspectRatio && p.durationSec ? (
                        <span className="ml-2 opacity-70">
                          · {p.aspectRatio} · {p.durationSec}s
                        </span>
                      ) : null}
                      {progressLine ? (
                        <span className="ml-2 opacity-70">· {progressLine}</span>
                      ) : null}
                      <span className="ml-2 opacity-50">
                        · {new Date(p.updatedAt).toLocaleDateString("zh-CN")}
                      </span>
                    </p>

                    {showProgressBar ? (
                      <Progress
                        className="mt-3 w-full max-w-xs"
                        value={Math.round(p.progressHint * 100)}
                        aria-label={t(`shell.businessStatus.${statusKey}.label`)}
                      />
                    ) : null}

                    {isReady && p.finalVideoUrl ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          render={<Link href={`/business/products/${p.id}`} />}
                          size="sm"
                        >
                          {t("shell.productsPage.viewFinal")}
                        </Button>
                        <Button
                          render={<a href={p.finalVideoUrl} download />}
                          variant="outline"
                          size="sm"
                        >
                          {t("shell.productsPage.download")}
                        </Button>
                        <Button
                          render={<Link href="/business/create-ad-video" />}
                          variant="ghost"
                          size="sm"
                        >
                          {t("shell.productsPage.regenerate")}
                        </Button>
                      </div>
                    ) : null}

                    {!isReady && !isFailed ? (
                      <Button
                        render={<Link href={`/business/products/${p.id}`} />}
                        variant="link"
                        size="sm"
                        className="mt-3 px-0"
                      >
                        {t("shell.productsPage.viewProgress")}
                      </Button>
                    ) : null}

                    {isFailed ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          render={<Link href={`/business/products/${p.id}`} />}
                          variant="destructive"
                          size="sm"
                        >
                          {t("shell.productsPage.retryFailed")}
                        </Button>
                        <Button
                          render={<Link href="/business/create-ad-video" />}
                          size="sm"
                        >
                          {t("shell.productsPage.regen")}
                        </Button>
                        <span className="text-meta text-muted-foreground">
                          {t("shell.productsPage.supportHint")}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
