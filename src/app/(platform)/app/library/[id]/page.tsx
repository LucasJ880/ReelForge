import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Music } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { contactEmail } from "@/lib/config/contact";
import { getUnifiedLibraryItem } from "@/lib/services/unified-library-service";
import { Button } from "@/components/ui/button";
import { VideoActions } from "@/components/library/video-actions";
import { CancelVideoButton } from "@/components/library/cancel-video-button";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { ReportContentButton } from "@/components/library/report-content-button";
import { VideoDownloadLink } from "@/components/library/video-download-link";
import { SubtitleDownloadLink } from "@/components/library/subtitle-download-link";
import { MakingProcessTimeline } from "@/components/library/making-process-timeline";
import { LocalTime } from "@/components/exchange/local-time";
import { MonoTag } from "@/components/exchange/mono-tag";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { StatusTick } from "@/components/exchange/status-tick";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { libraryRowState } from "@/lib/exchange/state-vocab";

export const dynamic = "force-dynamic";

/**
 * 成片详情（1025 · B2.1）：成片是舞台。
 * 行情头（标题 + 状态记号 + 读数 + 口径）→ 舞台（竖版原比例成片，旁边是下载与处置）→ 制作过程时间线。
 * 之前成片被压在制作时间线下面，状态是 Badge 圆点而不是状态记号。
 */
export default async function PlatformLibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?from=/app/library/${id}`);
  /// 图文帖没有视频详情页；老链接/直达 URL 一律送回它的家（本周内容），不 404。
  if (id.startsWith("post-")) redirect("/app/plan");
  const item = await getUnifiedLibraryItem(session.user.id, id);
  if (!item) notFound();
  const locale = await getServerLocale();
  const copy = getPlatformCopy(locale).library;
  const canAct = Boolean(item.briefId) && !item.isShowcase;
  /// 还在生成 / 暂停的单条可以取消（铁律 #7）：成品库写着「点进去可以看进度或取消」
  const canCancel = !item.isShowcase && (item.status === "generating" || item.status === "paused");
  return (
    <div className="x-stack min-w-0">
      <Button render={<Link href="/app/library" />} variant="ghost" size="sm" className="self-start">
        <ArrowLeft aria-hidden />{copy.back}
      </Button>
      <QuoteHeader
        title={item.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusTick entity="item" state={libraryRowState(item.status)} locale={locale} />
            {item.isShowcase ? <MonoTag>{copy.showcaseBadge}</MonoTag> : null}
          </span>
        }
        subtitle={
          item.isShowcase
            ? copy.showcaseHint
            : item.status === "failed"
              ? copy.detailFailure
              : item.status === "cancelled"
                ? copy.detailCancelled
                : undefined
        }
        /// 下载与处置跟着成片走（舞台旁边），行情头不另放主钮
        primaryAction={null}
        readingsLabel={copy.detailReadings}
        readings={[
          { label: copy.detailDuration, value: item.durationSec ? `${item.durationSec}s` : "—", caption: item.durationSec ? undefined : copy.durationPending },
          { label: copy.detailAspect, value: item.aspectRatio ?? "—", caption: item.aspectRatio ? undefined : copy.aspectPending },
          {
            label: copy.detailFailedScenes,
            value: item.failedSceneCount,
            tone: item.failedSceneCount > 0 ? "fault" : "neutral",
            caption: item.failedSceneCount > 0 && canAct ? copy.detailFailedScenesHint : undefined,
          },
          {
            label: copy.detailUpdated,
            value: <LocalTime iso={item.updatedAt.toISOString()} locale={locale} variant="date" />,
            caption: <LocalTime iso={item.updatedAt.toISOString()} locale={locale} variant="time" className="font-mono" />,
          },
        ]}
        scope={copy.detailScope.replace("{id}", item.id)}
      />

      <section aria-label={copy.view} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="x-panel flex min-w-0 justify-center p-4 sm:p-6">
          {item.videoUrl ? (
            <div className="relative w-fit max-w-full">
              <video
                controls
                preload="metadata"
                poster={item.thumbnailUrl ?? undefined}
                className="max-h-[72vh] w-auto max-w-full rounded-(--radius-md)"
                src={item.videoUrl}
              >
                {copy.cannotPlay}
              </video>
              <AiGeneratedLabel className="pointer-events-none absolute left-3 top-3" />
            </div>
          ) : (
            <p className="py-16 text-center text-body text-muted-foreground">
              {item.status === "cancelled" ? copy.detailCancelled : copy.processing}
            </p>
          )}
        </div>

        {item.videoUrl || item.subtitleFileUrl || canAct || canCancel || item.bgmAttribution ? (
          <aside className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {item.videoUrl ? (
                <VideoDownloadLink videoUrl={item.videoUrl} filename={`aivora-${item.id}.mp4`} label={copy.download} />
              ) : null}
              {item.subtitleFileUrl && !item.isShowcase ? (
                <SubtitleDownloadLink subtitleFileUrl={item.subtitleFileUrl} filename={`aivora-${item.id}.srt`} label={copy.downloadSubtitles} />
              ) : null}
            </div>
            {/* 授权配乐（CC BY）的署名跟着交付走：紧挨下载按钮，发布时照抄即可 */}
            {item.bgmAttribution ? (
              <p className="x-well flex items-start gap-2 rounded-(--radius-md) px-3 py-2 text-meta text-muted-foreground" data-testid="bgm-attribution">
                <Music className="mt-0.5 size-3.5 shrink-0 text-tertiary" aria-hidden />
                <span className="min-w-0">
                  <span className="x-label mr-2">{copy.musicCredit}</span>
                  <span className="break-words">{item.bgmAttribution}</span>
                </span>
              </p>
            ) : null}
            {canCancel ? (
              <CancelVideoButton
                orderId={item.id}
                copy={{
                  cancelVideo: copy.cancelVideo,
                  cancelConfirm: copy.cancelConfirm,
                  cancelKeep: copy.cancelKeep,
                  cancelConfirmHint: copy.cancelConfirmHint,
                  cancelling: copy.cancelling,
                  cancelFailed: copy.cancelFailed,
                }}
              />
            ) : null}
            {canAct && item.briefId ? (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <VideoActions briefId={item.briefId} failedSceneCount={item.failedSceneCount} canRetry={item.canRetry} contactEmail={contactEmail()} />
                <ReportContentButton briefId={item.briefId} />
              </div>
            ) : null}
          </aside>
        ) : null}
      </section>

      <MakingProcessTimeline steps={item.makingProcess} english={locale === "en-US"} />
    </div>
  );
}
