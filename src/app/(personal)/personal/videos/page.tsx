import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import {
  ArrowRight,
  Download,
  Layers3,
  Plus,
  RotateCcw,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerTranslator } from "@/i18n/server";
import { PersonalVideosAutoRefresh } from "@/components/personal/personal-videos-auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  customerSafeFinalVideoUrl,
  derivePersonalStatus,
  type PersonalVideoStatus,
} from "@/lib/video-generation/personal-status";
import { summarizeRunningJobs } from "@/lib/video-generation/business-status";
import type {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";

export const dynamic = "force-dynamic";

interface PersonalVideoRow {
  id: string;
  briefId: string | null;
  title: string;
  updatedAt: Date;
  briefStatus: VideoBriefStatus | null;
  finalVideoStatus: FinalVideoStatus | null;
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  aspectRatio: string | null;
  durationSec: number | null;
  segmentCount: number;
  segmentsSucceeded: number;
  status: PersonalVideoStatus;
  label: string;
  shortLabel: string;
  progressHint: number;
  progressHintText: string | null;
  cta: string | null;
}

const STATUS_BADGE_VARIANT: Record<
  PersonalVideoStatus,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  planning: "secondary",
  generating: "warning",
  assembling: "default",
  ready: "success",
  failed: "destructive",
};

async function loadPersonalVideoRows(
  userId: string,
): Promise<PersonalVideoRow[]> {
  const orders = await db.deliveryOrder
    .findMany({
      where: {
        createdById: userId,
        productCategory: "unified_input",
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
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
    })
    .catch(() => []);

  return orders
    .filter(
      (o) => o.rounds[0]?.angles[0]?.videoBrief?.persona === "PERSONAL",
    )
    .map((o): PersonalVideoRow => {
      const brief = o.rounds[0]?.angles[0]?.videoBrief ?? null;
      const finalVideo = brief?.finalVideo ?? null;
      const jobStatuses: VideoJobStatus[] =
        brief?.videoJobs?.map((j) => j.status) ?? [];
      const segmentsSucceeded = jobStatuses.filter(
        (s) => s === "SUCCEEDED",
      ).length;
      const segmentCount = finalVideo?.segmentCount ?? jobStatuses.length;
      const personal = derivePersonalStatus({
        briefStatus: brief?.status ?? null,
        finalVideoStatus: finalVideo?.status ?? null,
        segmentsSucceeded,
        segmentsTotal: segmentCount,
        jobStatuses,
        /// INV-5：段内进度 = provider 真实 progress 优先，缺失时按运行时长估算
        ...summarizeRunningJobs(brief?.videoJobs ?? []),
      });
      const finalUrl =
        finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl ?? null;
      return {
        id: o.id,
        briefId: brief?.id ?? null,
        title: o.title,
        updatedAt: o.updatedAt,
        briefStatus: brief?.status ?? null,
        finalVideoStatus: finalVideo?.status ?? null,
        finalVideoUrl: customerSafeFinalVideoUrl(finalUrl),
        finalThumbnailUrl:
          finalVideo?.thumbnailUrl ?? brief?.finalThumbnailUrl ?? null,
        aspectRatio: brief?.aspectRatio ?? null,
        durationSec: brief?.durationSec ?? null,
        segmentCount,
        segmentsSucceeded,
        status: personal.status,
        label: personal.label,
        shortLabel: personal.shortLabel,
        progressHint: personal.progressHint,
        progressHintText: personal.progressHint_text,
        cta: personal.cta,
      };
    });
}

export default async function PersonalVideosPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/personal/videos");

  const { t } = await getServerTranslator();
  const rows = await loadPersonalVideoRows(session.user.id).catch(
    () => [] as PersonalVideoRow[],
  );

  const pollTargets = rows
    .filter((r) => r.briefId)
    .map((r) => ({
      briefId: r.briefId!,
      active:
        r.status === "planning" ||
        r.status === "generating" ||
        r.status === "assembling",
    }));

  return (
    <main className="min-w-0 space-y-10 [&_svg]:stroke-[1.5]">
      <PersonalVideosAutoRefresh targets={pollTargets} />
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <p className="text-meta font-semibold uppercase tracking-widest text-muted-foreground">
            Editorial Video Library
          </p>
          <h1 className="editorial-display">
            {t("shell.personalNav.myVideos")}
          </h1>
          <p className="max-w-2xl text-body text-muted-foreground">
            {t("shell.personalVideos.subtitle")}
          </p>
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Button
            render={<Link href="/batch-create" />}
            variant="outline"
            size="sm"
          >
            <Layers3 aria-hidden />
            批量生成
          </Button>
          <Button render={<Link href="/personal/create-video" />} size="sm">
            <Plus aria-hidden />
            {t("shell.personalHome.createTitle")}
          </Button>
          {rows.length > 0 && (
            <Button
              render={<Link href="/personal/create-video?from=last" />}
              variant="ghost"
              size="sm"
            >
              <RotateCcw aria-hidden />
              {t("shell.creative.useLastPrompt")}
            </Button>
          )}
        </div>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <h2 className="max-w-2xl font-heading text-section font-normal text-foreground">
              {t("shell.personalVideos.emptyTitle")}
            </h2>
            <p className="mt-3 max-w-xl text-body text-muted-foreground">
              {t("shell.personalVideos.emptyBody")}
            </p>
            <Button
              render={<Link href="/personal/create-video" />}
              className="mt-6"
            >
              <Plus aria-hidden />
              {t("shell.personalVideos.emptyCta")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4" aria-label="个人视频列表">
          {rows.map((r) => {
            const isReady = r.status === "ready";
            const isFailed = r.status === "failed";
            const isReadyButLinkPending = isReady && !r.finalVideoUrl;
            const showProgressBar =
              r.status === "generating" || r.status === "assembling";

            return (
              <li key={r.id}>
                <Card size="sm">
                  <CardContent className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start">
                    {r.finalThumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.finalThumbnailUrl}
                        alt={`${r.title} 视频缩略图`}
                        className="h-28 w-full shrink-0 rounded-(--radius-md) border border-border object-cover sm:w-20"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="space-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                          <Link
                            href={`/personal/videos/${r.id}`}
                            className="min-w-0 font-heading text-title font-normal text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            <span className="wrap-break-word">{r.title}</span>
                          </Link>
                          <Badge variant={STATUS_BADGE_VARIANT[r.status]}>
                            {r.shortLabel}
                          </Badge>
                        </div>
                        <p className="text-meta text-muted-foreground">
                      {isReadyButLinkPending
                        ? "正在准备视频链接，请稍候刷新"
                        : r.label}
                      {r.aspectRatio && r.durationSec ? (
                            <span className="ml-2">
                          · {r.aspectRatio} · {r.durationSec}s
                        </span>
                      ) : null}
                      {r.progressHintText ? (
                            <span className="ml-2">
                          · {r.progressHintText}
                        </span>
                      ) : null}
                    </p>
                      </div>

                    {showProgressBar ? (
                        <Progress
                          value={Math.round(r.progressHint * 100)}
                          aria-label={`${r.title} 生成进度 ${Math.round(r.progressHint * 100)}%`}
                        />
                    ) : null}

                    {isReady && r.finalVideoUrl ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                          <Button
                            render={<Link href={`/personal/videos/${r.id}`} />}
                            size="sm"
                        >
                          {r.cta ?? "查看视频"}
                            <ArrowRight aria-hidden />
                          </Button>
                          <Button
                            render={<a href={r.finalVideoUrl} download />}
                            variant="outline"
                            size="sm"
                        >
                            <Download aria-hidden />
                          下载视频
                          </Button>
                          <Button
                            render={<Link href="/personal/create-video" />}
                            variant="ghost"
                            size="sm"
                        >
                          再做一支
                          </Button>
                      </div>
                    ) : null}

                    {!isReady && !isFailed ? (
                        <Button
                          render={<Link href={`/personal/videos/${r.id}`} />}
                          variant="link"
                          size="sm"
                          className="px-0"
                      >
                          查看分镜进度
                          <ArrowRight aria-hidden />
                        </Button>
                    ) : null}

                    {isFailed ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                          <Button
                            render={<Link href={`/personal/videos/${r.id}`} />}
                            variant="destructive"
                            size="sm"
                        >
                          重试失败片段
                          </Button>
                          <Button
                            render={<Link href="/personal/create-video" />}
                            variant="outline"
                            size="sm"
                        >
                          {r.cta ?? "重新生成"}
                          </Button>
                          <span className="text-meta text-muted-foreground">
                          换个描述再试一次，效果通常会更好。
                        </span>
                      </div>
                    ) : null}
                  </div>
                    <time
                      dateTime={r.updatedAt.toISOString()}
                      className="shrink-0 text-meta text-muted-foreground sm:text-right"
                    >
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </time>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
