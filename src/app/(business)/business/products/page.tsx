import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerTranslator } from "@/i18n/server";
import type { TranslationKey } from "@/i18n/types";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { BriefRenderAutoRefresh } from "@/components/video-generation/brief-render-auto-refresh";
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

const STATUS_CHIP_CLASS: Record<BusinessVideoStatus, string> = {
  planning: "bg-slate-500/15 text-slate-300",
  generating: "bg-amber-500/15 text-amber-300",
  assembling: "bg-sky-500/15 text-sky-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
};

const PROGRESS_BAR_CLASS: Record<BusinessVideoStatus, string> = {
  planning: "bg-slate-400/60",
  generating: "bg-amber-400/70",
  assembling: "bg-sky-400/70",
  ready: "bg-emerald-400/80",
  failed: "bg-rose-400/60",
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
          <Link
            href="/business/create-ad-video"
            className="inline-flex items-center rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-sm transition-colors hover:bg-foreground/90"
          >
            {t("shell.productsPage.newAd")}
          </Link>
        }
      />

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-card/30 p-12 text-center">
          <h2 className="text-lg font-semibold tracking-tight">
            {t("shell.productsPage.emptyTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("shell.productsPage.emptyBody")}
          </p>
          <Link
            href="/business/create-ad-video"
            className="mt-6 inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            {t("shell.productsPage.emptyCta")}
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
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
                className={
                  "rounded-xl border p-4 transition-colors sm:p-5 " +
                  (isHighlighted
                    ? "border-emerald-400/40 bg-emerald-500/5 ring-1 ring-emerald-400/20"
                    : "border-white/10 bg-card/40 hover:border-white/20 hover:bg-card/70")
                }
              >
                <div className="flex items-start gap-4">
                  {p.finalThumbnailUrl ? (
                    <Link
                      href={`/business/products/${p.id}`}
                      className="relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.finalThumbnailUrl}
                        alt=""
                        className="h-[88px] w-[66px] object-cover"
                      />
                    </Link>
                  ) : (
                    <div className="flex h-[88px] w-[66px] shrink-0 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/5 text-[10px] text-muted-foreground">
                      9:16
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/business/products/${p.id}`}
                        className="text-base font-semibold tracking-tight truncate hover:underline underline-offset-4"
                      >
                        {p.title}
                      </Link>
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wider " +
                          STATUS_CHIP_CLASS[p.businessStatus]
                        }
                      >
                        {t(`shell.businessStatus.${statusKey}.short`)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
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
                      <div className="mt-3 h-1 w-full max-w-[260px] overflow-hidden rounded-full bg-white/5">
                        <div
                          className={
                            "h-full rounded-full transition-all " +
                            PROGRESS_BAR_CLASS[p.businessStatus]
                          }
                          style={{
                            width: `${Math.round(p.progressHint * 100)}%`,
                          }}
                        />
                      </div>
                    ) : null}

                    {isReady && p.finalVideoUrl ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Link
                          href={`/business/products/${p.id}`}
                          className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors"
                        >
                          {t("shell.productsPage.viewFinal")}
                        </Link>
                        <a
                          href={p.finalVideoUrl}
                          download
                          className="inline-flex items-center rounded-md border border-white/15 bg-card/60 px-3 py-1.5 text-xs hover:bg-card/90 transition-colors"
                        >
                          {t("shell.productsPage.download")}
                        </a>
                        <Link
                          href="/business/create-ad-video"
                          className="inline-flex items-center rounded-md border border-white/10 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-card/70 hover:text-foreground transition-colors"
                        >
                          {t("shell.productsPage.regenerate")}
                        </Link>
                      </div>
                    ) : null}

                    {!isReady && !isFailed ? (
                      <Link
                        href={`/business/products/${p.id}`}
                        className="mt-3 inline-flex items-center text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                      >
                        {t("shell.productsPage.viewProgress")}
                      </Link>
                    ) : null}

                    {isFailed ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Link
                          href={`/business/products/${p.id}`}
                          className="inline-flex items-center rounded-md bg-rose-500/10 border border-rose-500/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20 transition-colors"
                        >
                          {t("shell.productsPage.retryFailed")}
                        </Link>
                        <Link
                          href="/business/create-ad-video"
                          className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors"
                        >
                          {t("shell.productsPage.regen")}
                        </Link>
                        <span className="text-[11px] text-muted-foreground">
                          {t("shell.productsPage.supportHint")}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
