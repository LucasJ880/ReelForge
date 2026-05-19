import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerTranslator } from "@/i18n/server";
import { PersonalVideosAutoRefresh } from "@/components/personal/personal-videos-auto-refresh";
import {
  customerSafeFinalVideoUrl,
  derivePersonalStatus,
  type PersonalVideoStatus,
} from "@/lib/video-generation/personal-status";
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

const STATUS_CHIP_CLASS: Record<PersonalVideoStatus, string> = {
  planning: "bg-slate-500/15 text-slate-300",
  generating: "bg-amber-500/15 text-amber-300",
  assembling: "bg-sky-500/15 text-sky-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
};

const PROGRESS_BAR_CLASS: Record<PersonalVideoStatus, string> = {
  planning: "bg-slate-400/60",
  generating: "bg-amber-400/70",
  assembling: "bg-sky-400/70",
  ready: "bg-emerald-400/80",
  failed: "bg-rose-400/60",
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
                    videoJobs: { select: { status: true } },
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
    <div className="space-y-8">
      <PersonalVideosAutoRefresh targets={pollTargets} />
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("shell.personalNav.myVideos")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("shell.personalVideos.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/personal/create-video"
            className="inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            {t("shell.personalHome.createTitle")}
          </Link>
          {rows.length > 0 && (
            <Link
              href="/personal/create-video?from=last"
              className="inline-flex items-center rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
              {t("shell.creative.useLastPrompt")}
            </Link>
          )}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-card/30 p-12 text-center">
          <h2 className="text-lg font-semibold tracking-tight">
            {t("shell.personalVideos.emptyTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("shell.personalVideos.emptyBody")}
          </p>
          <Link
            href="/personal/create-video"
            className="mt-6 inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            {t("shell.personalVideos.emptyCta")}
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const isReady = r.status === "ready";
            const isFailed = r.status === "failed";
            const isReadyButLinkPending = isReady && !r.finalVideoUrl;
            const showProgressBar =
              r.status === "generating" || r.status === "assembling";

            return (
              <li
                key={r.id}
                className="rounded-lg border border-white/10 bg-card p-5 hover:bg-card/80 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/personal/videos/${r.id}`}
                        className="text-base font-semibold tracking-tight truncate hover:underline underline-offset-4"
                      >
                        {r.title}
                      </Link>
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wider " +
                          STATUS_CHIP_CLASS[r.status]
                        }
                      >
                        {r.shortLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isReadyButLinkPending
                        ? "正在准备视频链接，请稍候刷新"
                        : r.label}
                      {r.aspectRatio && r.durationSec ? (
                        <span className="ml-2 opacity-70">
                          · {r.aspectRatio} · {r.durationSec}s
                        </span>
                      ) : null}
                      {r.progressHintText ? (
                        <span className="ml-2 opacity-70">
                          · {r.progressHintText}
                        </span>
                      ) : null}
                    </p>

                    {showProgressBar ? (
                      <div className="mt-3 h-1 w-full max-w-[260px] overflow-hidden rounded-full bg-white/5">
                        <div
                          className={
                            "h-full rounded-full transition-all " +
                            PROGRESS_BAR_CLASS[r.status]
                          }
                          style={{
                            width: `${Math.round(r.progressHint * 100)}%`,
                          }}
                        />
                      </div>
                    ) : null}

                    {isReady && r.finalVideoUrl ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Link
                          href={`/personal/videos/${r.id}`}
                          className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors"
                        >
                          {r.cta ?? "查看视频"}
                        </Link>
                        <a
                          href={r.finalVideoUrl}
                          download
                          className="inline-flex items-center rounded-md border border-white/15 bg-card/60 px-3 py-1.5 text-xs hover:bg-card/90 transition-colors"
                        >
                          下载视频
                        </a>
                        <Link
                          href="/personal/create-video"
                          className="inline-flex items-center rounded-md border border-white/10 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-card/70 hover:text-foreground transition-colors"
                        >
                          再做一支
                        </Link>
                      </div>
                    ) : null}

                    {!isReady && !isFailed ? (
                      <Link
                        href={`/personal/videos/${r.id}`}
                        className="mt-3 inline-flex items-center text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                      >
                        查看分镜进度 →
                      </Link>
                    ) : null}

                    {isFailed ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Link
                          href={`/personal/videos/${r.id}`}
                          className="inline-flex items-center rounded-md bg-rose-500/10 border border-rose-500/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20 transition-colors"
                        >
                          重试失败片段
                        </Link>
                        <Link
                          href="/personal/create-video"
                          className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors"
                        >
                          {r.cta ?? "重新生成"}
                        </Link>
                        <span className="text-[11px] text-muted-foreground">
                          换个描述再试一次，效果通常会更好。
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    {r.finalThumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.finalThumbnailUrl}
                        alt=""
                        className="h-16 w-12 rounded object-cover border border-white/10"
                      />
                    ) : null}
                    <span className="mt-2 block text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </span>
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
