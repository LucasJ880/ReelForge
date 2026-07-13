import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  deriveBusinessStatus,
  summarizeRunningJobs,
  type BusinessVideoStatus,
} from "@/lib/video-generation/business-status";
import type {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getServerTranslator } from "@/i18n/server";
import type { TranslationKey } from "@/i18n/types";
import { VideoActions } from "./video-actions";

export const dynamic = "force-dynamic";

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

const SCENE_STATUS_VARIANT: Record<
  string,
  "success" | "warning" | "destructive" | "secondary"
> = {
  ready: "success",
  generating: "warning",
  failed: "destructive",
  pending: "secondary",
};

interface SceneRow {
  id: string;
  index: number;
  durationSec: number | null;
  thumbnailUrl: string | null;
  state: "ready" | "generating" | "failed" | "pending";
  stateLabel: string;
  isFailed: boolean;
}

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

function customerSafeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export default async function BusinessProductDetailPage({
  params,
}: DetailPageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) redirect(`/login?from=/business/products/${id}`);

  const { t } = await getServerTranslator();

  const order = await db.deliveryOrder
    .findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        productCategory: true,
        targetPlatform: true,
        createdById: true,
        updatedAt: true,
        rounds: {
          orderBy: { roundIndex: "desc" },
          take: 1,
          select: {
            angles: {
              orderBy: { sortOrder: "asc" },
              take: 1,
              select: {
                hook: true,
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
                      orderBy: [
                        { segmentIndex: "asc" },
                        { createdAt: "asc" },
                      ],
                      select: {
                        id: true,
                        segmentIndex: true,
                        segmentDurationSec: true,
                        status: true,
                        outputThumbUrl: true,
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
    })
    .catch(() => null);

  if (!order) notFound();

  /// Phase 6 ownership：商家用户只能看自己创建的；内部 staff 可代看
  const callerType = session.user.userType;
  const isInternalStaff =
    callerType === "OPERATOR" || callerType === "SUPER_ADMIN";
  if (!isInternalStaff && order.createdById !== session.user.id) {
    notFound();
  }

  const brief = order.rounds[0]?.angles[0]?.videoBrief ?? null;
  if (!brief) notFound();

  /// 仅 BUSINESS persona 视频出现在 business 详情页；PERSONAL 应跳回 personal 详情
  if (brief.persona === "PERSONAL") {
    redirect(`/personal/videos/${order.id}`);
  }

  const finalVideo = brief.finalVideo;
  const jobStatuses: VideoJobStatus[] = brief.videoJobs.map((j) => j.status);
  const segmentsSucceeded = jobStatuses.filter(
    (s) => s === "SUCCEEDED",
  ).length;
  const segmentCount = finalVideo?.segmentCount ?? brief.videoJobs.length;
  const status = deriveBusinessStatus({
    briefStatus: brief.status as VideoBriefStatus | null,
    finalVideoStatus: (finalVideo?.status ?? null) as FinalVideoStatus | null,
    segmentsSucceeded,
    segmentsTotal: segmentCount,
    jobStatuses,
    /// INV-5：段内进度 = provider 真实 progress 优先，缺失时按运行时长估算
    ...summarizeRunningJobs(brief.videoJobs),
  });

  const finalUrl = customerSafeUrl(
    finalVideo?.stitchedVideoUrl ?? brief.finalVideoUrl ?? null,
  );
  const finalThumb =
    finalVideo?.thumbnailUrl ?? brief.finalThumbnailUrl ?? null;

  const sceneLabel = (key: TranslationKey) => t(key);

  const scenes: SceneRow[] = brief.videoJobs.map((j, idx) => {
    let state: SceneRow["state"];
    let stateLabel: string;
    switch (j.status) {
      case "SUCCEEDED":
        state = "ready";
        stateLabel = sceneLabel("shell.productDetail.sceneReady");
        break;
      case "RUNNING":
      case "QUEUED":
        state = "generating";
        stateLabel = sceneLabel("shell.productDetail.sceneGenerating");
        break;
      case "FAILED":
      case "CANCELLED":
        state = "failed";
        stateLabel = sceneLabel("shell.productDetail.sceneFailed");
        break;
      default:
        state = "pending";
        stateLabel = sceneLabel("shell.productDetail.scenePending");
    }
    return {
      id: j.id,
      index: j.segmentIndex ?? idx,
      durationSec: j.segmentDurationSec ?? null,
      thumbnailUrl: j.outputThumbUrl ?? null,
      state,
      stateLabel,
      isFailed: j.status === "FAILED",
    };
  });

  const failedSceneCount = scenes.filter((s) => s.isFailed).length;
  const isReady = status.status === "ready";
  const isFailed = status.status === "failed";
  const showProgress =
    status.status === "generating" || status.status === "assembling";

  const metaParts: string[] = [];
  if (brief.aspectRatio && brief.durationSec) {
    metaParts.push(`${brief.aspectRatio} · ${brief.durationSec}s`);
  }
  if (order.targetPlatform) metaParts.push(order.targetPlatform);

  return (
    <div className="space-y-8">
      <BusinessPageHeader
        backLink={{
          href: "/business/products",
          label: t("shell.productDetail.backToProducts"),
        }}
        kicker={t("shell.productDetail.kicker")}
        title={order.title}
        meta={
          <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
            <Badge variant={STATUS_VARIANT[status.status]}>
              {t(`shell.businessStatus.${status.status}.short`)}
            </Badge>
            <span>{t(`shell.businessStatus.${status.status}.label`)}</span>
            {metaParts.length > 0 ? (
              <span className="opacity-70">· {metaParts.join(" · ")}</span>
            ) : null}
          </div>
        }
        action={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            {isReady ? (
              <Button
                render={
                  <Link
                    href={`/business/create-ad-video?from=${encodeURIComponent(order.id)}`}
                  />
                }
                variant="outline"
                size="sm"
              >
                {t("shell.productDetail.variantCta")} →
              </Button>
            ) : null}
            <div>
              <span className="text-meta text-muted-foreground">
                {t("shell.productDetail.lastUpdated")}
              </span>
              <p className="mt-1 text-meta tabular-nums text-muted-foreground">
                {new Date(order.updatedAt).toLocaleString("zh-CN")}
              </p>
            </div>
          </div>
        }
      />

      {showProgress ? (
        <Card size="sm">
          <CardContent className="space-y-3 pt-2">
          <div className="flex items-center justify-between gap-3 text-meta text-muted-foreground">
            <span>{t(`shell.businessStatus.${status.status}.label`)}</span>
            <span className="opacity-70">
              {Math.round(status.progressHint * 100)}%
            </span>
          </div>
          <Progress
            value={Math.round(status.progressHint * 100)}
            aria-label={t(`shell.businessStatus.${status.status}.label`)}
          />
          <p className="text-meta text-muted-foreground">
            {t("shell.productDetail.progressRefreshHint")}
          </p>
          </CardContent>
        </Card>
      ) : null}

      {isReady && finalUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("shell.productDetail.finalVideo")}</CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-5 md:grid-cols-[1fr_auto]">
            <div className="aspect-9/16 max-h-[420px] overflow-hidden rounded-(--radius-md) border border-border bg-muted">
              <video
                src={finalUrl}
                controls
                playsInline
                poster={finalThumb ?? undefined}
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button
                render={
                  <a
                    href={finalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                size="sm"
              >
                {t("shell.productDetail.viewFinal")}
              </Button>
              <Button
                render={<a href={finalUrl} download />}
                variant="outline"
                size="sm"
              >
                {t("shell.productDetail.download")}
              </Button>
              <Button
                render={<Link href="/business/create-ad-video" />}
                variant="ghost"
                size="sm"
              >
                {t("shell.productDetail.regenerate")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isReady && !finalUrl ? (
        <Card size="sm">
          <CardContent className="pt-2 text-body text-muted-foreground">
            {t("shell.productDetail.linkPending")}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-heading text-subhead font-normal">
            {t("shell.productDetail.scenesTitle", {
              done: segmentsSucceeded,
              total: segmentCount,
            })}
          </h2>
          <VideoActions
            briefId={brief.id}
            failedSceneCount={failedSceneCount}
            canRetry={isFailed || failedSceneCount > 0}
          />
        </div>

        {scenes.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            {t("shell.productDetail.scenesEmpty")}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((s) => (
              <li
                key={s.id}
                className="rounded-(--radius-md) border border-border bg-card p-4"
              >
                <div className="mb-3 aspect-video overflow-hidden rounded-(--radius-sm) bg-muted">
                  {s.thumbnailUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-meta text-muted-foreground">
                      {t("shell.productDetail.sceneNoThumb")}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-meta font-medium">
                    {t("shell.productDetail.sceneIndex", { index: s.index + 1 })}
                    {s.durationSec ? (
                      <span className="ml-1.5 text-muted-foreground">
                        · {s.durationSec}s
                      </span>
                    ) : null}
                  </span>
                  <Badge variant={SCENE_STATUS_VARIANT[s.state] ?? "secondary"}>
                    {s.stateLabel}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
        </CardContent>
      </Card>

      {isFailed ? (
        <Card className="border-danger" size="sm">
          <CardContent className="space-y-3 pt-2 text-body">
          <p className="font-medium text-danger">{t("shell.productDetail.failedTitle")}</p>
          <p className="text-meta text-muted-foreground">
            {t("shell.productDetail.failedBody")}
          </p>
          <Button
            render={<Link href="/business/create-ad-video" />}
            size="sm"
          >
            {t("shell.productDetail.failedRegenerate")}
          </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
