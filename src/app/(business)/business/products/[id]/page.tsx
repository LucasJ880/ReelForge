import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  deriveBusinessStatus,
  type BusinessVideoStatus,
} from "@/lib/video-generation/business-status";
import type {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { VideoActions } from "./video-actions";

export const dynamic = "force-dynamic";

const STATUS_CHIP_CLASS: Record<BusinessVideoStatus, string> = {
  planning: "bg-slate-500/15 text-slate-300",
  generating: "bg-amber-500/15 text-amber-300",
  assembling: "bg-sky-500/15 text-sky-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
};

const SCENE_STATUS_CLASS: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-300",
  generating: "bg-amber-500/15 text-amber-300",
  failed: "bg-rose-500/15 text-rose-300",
  pending: "bg-slate-500/15 text-slate-300",
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
  });

  const finalUrl = customerSafeUrl(
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
  const isReady = status.status === "ready";
  const isFailed = status.status === "failed";
  const showProgress =
    status.status === "generating" || status.status === "assembling";

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <Link
            href="/business/products"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to products
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight truncate">
            {order.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              className={
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wider " +
                STATUS_CHIP_CLASS[status.status]
              }
            >
              {status.shortLabel}
            </span>
            <span>{status.label}</span>
            {brief.aspectRatio && brief.durationSec ? (
              <span className="opacity-70">
                · {brief.aspectRatio} · {brief.durationSec}s
              </span>
            ) : null}
            {order.targetPlatform ? (
              <span className="opacity-70">· {order.targetPlatform}</span>
            ) : null}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            最近更新
          </span>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(order.updatedAt).toLocaleString()}
          </p>
        </div>
      </header>

      {showProgress ? (
        <div className="rounded-xl border border-white/10 bg-card/50 p-5">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{status.label}</span>
            <span className="opacity-70">
              {Math.round(status.progressHint * 100)}%
            </span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-amber-400/70 transition-all"
              style={{ width: `${Math.round(status.progressHint * 100)}%` }}
            />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            视频生成大约需要几分钟。点下方按钮可手动刷新进度。
          </p>
        </div>
      ) : null}

      {isReady && finalUrl ? (
        <section className="rounded-xl border border-white/10 bg-card/40 p-6">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            最终视频
          </h2>
          <div className="mt-4 grid gap-5 md:grid-cols-[1fr_auto] items-start">
            <div className="aspect-9/16 max-h-[420px] overflow-hidden rounded-lg border border-white/10 bg-black">
              <video
                src={finalUrl}
                controls
                playsInline
                poster={finalThumb ?? undefined}
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex flex-col gap-2 text-xs">
              <a
                href={finalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md bg-foreground text-background px-3 py-2 text-xs font-medium hover:bg-foreground/90 transition-colors"
              >
                查看最终视频
              </a>
              <a
                href={finalUrl}
                download
                className="inline-flex items-center justify-center rounded-md border border-white/15 bg-card/60 px-3 py-2 text-xs hover:bg-card/90 transition-colors"
              >
                下载视频
              </a>
              <Link
                href="/business/create-ad-video"
                className="inline-flex items-center justify-center rounded-md border border-white/10 bg-card/40 px-3 py-2 text-xs text-muted-foreground hover:bg-card/70 hover:text-foreground transition-colors"
              >
                再生成一版
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {isReady && !finalUrl ? (
        <div className="rounded-xl border border-white/10 bg-card/40 p-5 text-sm text-muted-foreground">
          视频已就绪，正在准备播放链接。请点击下方「刷新进度」。
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            分镜进度（{segmentsSucceeded}/{segmentCount}）
          </h2>
          <VideoActions
            briefId={brief.id}
            failedSceneCount={failedSceneCount}
            canRetry={isFailed || failedSceneCount > 0}
          />
        </div>

        {scenes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            还没有分镜数据。视频开始生成后这里会更新。
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-white/10 bg-card/60 p-4"
              >
                <div className="aspect-video overflow-hidden rounded-md bg-black/40 mb-3">
                  {s.thumbnailUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-[11px] text-muted-foreground/60">
                      暂无预览图
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    分镜 {s.index + 1}
                    {s.durationSec ? (
                      <span className="ml-1.5 text-muted-foreground">
                        · {s.durationSec}s
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wider " +
                      SCENE_STATUS_CLASS[s.state]
                    }
                  >
                    {s.stateLabel}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isFailed ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5 text-sm">
          <p className="font-medium">这次没生成出来。</p>
          <p className="mt-1 text-xs text-muted-foreground">
            点上面的「重试失败片段」会只重新跑失败的部分，不会重复扣已生成的分镜额度。仍然遇到问题请联系客服。
          </p>
          <Link
            href="/business/create-ad-video"
            className="mt-3 inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            重新生成
          </Link>
        </div>
      ) : null}
    </div>
  );
}
