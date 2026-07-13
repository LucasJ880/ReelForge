import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  Film,
  Plus,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  containsBannedPersonalTerm,
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
import { VideoActions } from "./video-actions";

export const dynamic = "force-dynamic";

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

const SCENE_STATUS_VARIANT: Record<
  SceneRow["state"],
  "default" | "secondary" | "destructive" | "success" | "warning"
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
  /// 客户视角分类，仅 4 种；后端原始 enum 不会泄漏到 UI
  state: "ready" | "generating" | "failed" | "pending";
  stateLabel: string;
  isFailed: boolean;
}

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PersonalVideoDetailPage({
  params,
}: DetailPageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) redirect(`/login?from=/personal/videos/${id}`);

  const order = await db.deliveryOrder
    .findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        createdById: true,
        updatedAt: true,
        productCategory: true,
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
                    errorMessage: true,
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

  /// Phase 6 ownership guard：personal 用户只能看自己的视频
  /// 内部 staff（OPERATOR/SUPER_ADMIN userType）可以代看任意人
  const callerType = session.user.userType;
  const isInternalStaff =
    callerType === "OPERATOR" || callerType === "SUPER_ADMIN";
  if (!isInternalStaff && order.createdById !== session.user.id) {
    notFound();
  }

  const brief = order.rounds[0]?.angles[0]?.videoBrief ?? null;
  if (!brief) notFound();

  /// 仅 PERSONAL persona 视频出现在 personal 详情页；BUSINESS 走 business 详情
  if (brief.persona !== "PERSONAL") {
    redirect("/personal/videos");
  }

  const finalVideo = brief.finalVideo;
  const jobStatuses: VideoJobStatus[] = brief.videoJobs.map((j) => j.status);
  const segmentsSucceeded = jobStatuses.filter(
    (s) => s === "SUCCEEDED",
  ).length;
  const segmentCount = finalVideo?.segmentCount ?? brief.videoJobs.length;
  const personal = derivePersonalStatus({
    briefStatus: brief.status as VideoBriefStatus | null,
    finalVideoStatus: (finalVideo?.status ?? null) as FinalVideoStatus | null,
    segmentsSucceeded,
    segmentsTotal: segmentCount,
    jobStatuses,
    /// INV-5：段内进度 = provider 真实 progress 优先，缺失时按运行时长估算
    ...summarizeRunningJobs(brief.videoJobs),
  });

  const finalUrl = customerSafeFinalVideoUrl(
    finalVideo?.stitchedVideoUrl ?? brief.finalVideoUrl ?? null,
  );
  const finalThumb =
    finalVideo?.thumbnailUrl ?? brief.finalThumbnailUrl ?? null;

  const scenes: SceneRow[] = brief.videoJobs.map((j, idx) => {
    let state: SceneRow["state"];
    let stateLabel: string;
    switch (j.status) {
      case "SUCCEEDED":
        state = "ready";
        stateLabel = "已完成";
        break;
      case "RUNNING":
      case "QUEUED":
        state = "generating";
        stateLabel = "生成中";
        break;
      case "FAILED":
      case "CANCELLED":
        state = "failed";
        stateLabel = "未通过";
        break;
      default:
        state = "pending";
        stateLabel = "等待开始";
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
  const isReady = personal.status === "ready";
  const isFailed = personal.status === "failed";
  /// 错误上浮：只展示「人话版」错误（sweep / sync 写入的用户安全文案）。
  /// 含内部术语的技术错误一律不给客户看，退回通用文案。
  const failureDetail =
    isFailed &&
    brief.errorMessage &&
    !containsBannedPersonalTerm(brief.errorMessage)
      ? brief.errorMessage
      : null;
  const showProgress =
    personal.status === "generating" || personal.status === "assembling";

  return (
    <main className="min-w-0 space-y-8 [&_svg]:stroke-[1.5]">
      <nav aria-label="视频详情导航">
        <Button
          render={<Link href="/personal/videos" />}
          variant="ghost"
          size="sm"
        >
          <ArrowLeft aria-hidden />
          返回我的视频
        </Button>
      </nav>

      <Card>
        <CardHeader className="gap-5 border-b border-border">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-meta font-semibold uppercase tracking-widest text-muted-foreground">
                  Editorial Video
                </p>
                <Badge variant={STATUS_BADGE_VARIANT[personal.status]}>
                  {personal.shortLabel}
                </Badge>
              </div>
              <h1 className="editorial-display wrap-break-word">
                {order.title}
              </h1>
              <CardDescription>{personal.label}</CardDescription>
            </div>
            <div className="shrink-0 text-meta text-muted-foreground sm:text-right">
              <span className="font-medium text-foreground">最近更新</span>
              <time
                dateTime={order.updatedAt.toISOString()}
                className="mt-1 block"
              >
                {new Date(order.updatedAt).toLocaleString()}
              </time>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <dl className="grid grid-cols-2 border-y border-border sm:grid-cols-3">
            <div className="py-3">
              <dt className="text-meta text-muted-foreground">画面比例</dt>
              <dd className="mt-1 text-body font-medium text-foreground">
                {brief.aspectRatio ?? "待确定"}
              </dd>
            </div>
            <div className="py-3">
              <dt className="text-meta text-muted-foreground">视频时长</dt>
              <dd className="mt-1 text-body font-medium text-foreground">
                {brief.durationSec ? `${brief.durationSec}s` : "待确定"}
              </dd>
            </div>
            <div className="col-span-2 border-t border-border py-3 sm:col-span-1 sm:border-t-0">
              <dt className="text-meta text-muted-foreground">分镜进度</dt>
              <dd className="mt-1 text-body font-medium tabular-nums text-foreground">
                {segmentsSucceeded}/{segmentCount}
              </dd>
            </div>
          </dl>

          {showProgress ? (
            <div className="space-y-3">
              <Progress value={Math.round(personal.progressHint * 100)}>
                <ProgressLabel>
                  {personal.progressHint_text ?? personal.label}
                </ProgressLabel>
                <ProgressValue />
              </Progress>
              <p className="text-meta text-muted-foreground">
                视频生成大约需要几分钟。可以晚点回来，或点下方按钮刷新进度。
              </p>
            </div>
          ) : null}

          {isReady && finalUrl ? (
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="mx-auto aspect-9/16 w-full max-w-sm overflow-hidden rounded-(--radius-md) border border-border bg-muted">
                <video
                  src={finalUrl}
                  controls
                  playsInline
                  poster={finalThumb ?? undefined}
                  aria-label={`${order.title} 成片`}
                  className="size-full object-contain"
                />
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-44 lg:grid-cols-1">
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
                  {personal.cta ?? "查看视频"}
                  <ArrowUpRight aria-hidden />
                </Button>
                <Button
                  render={<a href={finalUrl} download />}
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
                  <Plus aria-hidden />
                  再做一支
                </Button>
              </div>
            </div>
          ) : null}

          {isReady && !finalUrl ? (
            <p className="border-l-2 border-warning pl-4 text-body text-muted-foreground">
              视频已就绪，正在准备播放链接。请稍候点击下方「刷新进度」。
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section aria-labelledby="scene-progress-heading" className="space-y-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2
              id="scene-progress-heading"
              className="font-heading text-section font-normal text-foreground"
            >
              分镜进度
            </h2>
            <p className="text-meta text-muted-foreground">
              已完成 {segmentsSucceeded}/{segmentCount}
            </p>
          </div>
          <div className="max-w-full overflow-x-auto">
            <VideoActions
              briefId={brief.id}
              failedSceneCount={failedSceneCount}
              canRetry={isFailed || failedSceneCount > 0}
              statusKey={personal.status}
            />
          </div>
        </div>

        {scenes.length === 0 ? (
          <Card size="sm">
            <CardContent className="text-meta text-muted-foreground">
              还没有分镜数据。视频开始生成后这里会更新。
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((s) => (
              <li key={s.id}>
                <Card size="sm" className="gap-0 py-0">
                  <div className="aspect-video overflow-hidden bg-muted">
                    {s.thumbnailUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={s.thumbnailUrl}
                        alt={`分镜 ${s.index + 1} 预览图`}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-2 text-meta text-muted-foreground">
                        <Film className="size-5" aria-hidden />
                        <span>暂无预览图</span>
                      </div>
                    )}
                  </div>
                  <CardHeader className="grid-cols-[1fr_auto] py-4">
                    <div className="min-w-0">
                      <CardTitle>分镜 {s.index + 1}</CardTitle>
                      {s.durationSec ? (
                        <CardDescription>{s.durationSec}s</CardDescription>
                      ) : null}
                    </div>
                    <Badge variant={SCENE_STATUS_VARIANT[s.state]}>
                      {s.stateLabel}
                    </Badge>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isFailed ? (
        <Card size="sm" role="alert" className="border-danger">
          <CardHeader>
            <CardTitle>这次没生成出来。</CardTitle>
            <CardDescription>
              {failureDetail ??
                "换个描述、换个画面或者直接点上面的「重试失败片段」再试一次，效果通常会好很多。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/personal/create-video" />} size="sm">
              {personal.cta ?? "重新生成"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
