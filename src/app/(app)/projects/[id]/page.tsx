import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/features/page-header";
import { db } from "@/lib/db";
import { getServerTranslator } from "@/i18n/server";
import { getClientProject } from "@/lib/services/client-project-service";
import {
  RenderProgress,
  type RenderSummaryView,
} from "@/components/features/render-progress";
import { summarizeBriefRender } from "@/lib/services/video-service";

export const dynamic = "force-dynamic";

/**
 * 客户视角的项目详情（PART 6 wizard restructure）。
 *
 * MVP 范围：
 * - 顶部展示项目基本信息（businessName / 行业 / 时长 / 选中创意方向标题）
 * - 嵌入现有 RenderProgress 组件展示进度（已是双语，无需重写）
 * - 如果有最终成片 URL，展示视频 + 下载按钮
 *
 * 严格不暴露内部词：race / round / angle / render / Seedance / Provider / job ID。
 * 反查链路只取 deliveryOrder + brief 必要字段。
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t } = await getServerTranslator();

  const project = await getClientProject(id);
  if (!project) notFound();
  const { order, brief } = project;

  /// 取该项目最新更新的 VideoBrief（DeliveryOrder → Round → ContentAngle → VideoBrief）
  const latestBrief = await db.videoBrief.findFirst({
    where: {
      contentAngle: { round: { deliveryOrderId: id } },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      finalVideoUrl: true,
      finalThumbnailUrl: true,
      contentAngle: { select: { title: true } },
      finalVideo: {
        select: { stitchedVideoUrl: true, thumbnailUrl: true },
      },
    },
  });

  const finalUrl =
    latestBrief?.finalVideo?.stitchedVideoUrl ??
    latestBrief?.finalVideoUrl ??
    null;
  const finalThumb =
    latestBrief?.finalVideo?.thumbnailUrl ??
    latestBrief?.finalThumbnailUrl ??
    null;

  const renderSummary = latestBrief
    ? serializeRenderSummary(await summarizeBriefRender(latestBrief.id))
    : null;

  const businessName = brief?.businessName ?? order.title;
  const industryKey = brief?.industry ?? null;
  const durationSec = brief?.videoLengthSec ?? null;
  const creativeDirectionTitle =
    latestBrief?.contentAngle?.title ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={businessName || t("project.card.untitled")}
        description={t("project.page.subtitle")}
        actions={
          <Link
            href="/projects"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("project.page.backToList")}
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("project.fields.businessName")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {brief?.businessName && (
              <KV
                k={t("project.fields.businessName")}
                v={brief.businessName}
              />
            )}
            {industryKey && (
              <KV
                k={t("project.fields.industry")}
                v={t(`industry.${industryKey}`)}
              />
            )}
            {durationSec && (
              <KV
                k={t("project.fields.duration")}
                v={`${durationSec}s`}
              />
            )}
            <KV
              k={t("project.fields.creativeDirection")}
              v={
                creativeDirectionTitle ??
                t("project.page.noCreativeDirection")
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("project.page.finalVideoTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {finalUrl ? (
              <>
                <div className="overflow-hidden rounded-md border border-white/10 bg-black">
                  <video
                    src={finalUrl}
                    poster={finalThumb ?? undefined}
                    controls
                    className="aspect-video w-full"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={finalUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline">
                      {t("video.actions.preview")}
                    </Button>
                  </a>
                  <a href={finalUrl} download>
                    <Button size="sm" variant="outline">
                      {t("video.actions.download")}
                    </Button>
                  </a>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("project.page.noVideoYet")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {renderSummary && latestBrief && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("project.page.progressTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RenderProgress
              briefId={latestBrief.id}
              initial={renderSummary}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right text-foreground">{v}</span>
    </div>
  );
}

function serializeRenderSummary(
  summary: Awaited<ReturnType<typeof summarizeBriefRender>>,
): RenderSummaryView {
  return {
    briefId: summary.briefId,
    briefStatus: summary.briefStatus,
    totalJobs: summary.totalJobs,
    succeeded: summary.succeeded,
    running: summary.running,
    queued: summary.queued,
    failed: summary.failed,
    cancelled: summary.cancelled,
    finalVideoUrl: summary.finalVideoUrl,
    finalThumbnailUrl: summary.finalThumbnailUrl,
    hasStuckJob: summary.hasStuckJob,
    lastCheckedAt: summary.lastCheckedAt
      ? summary.lastCheckedAt.toISOString()
      : null,
    finalVideo: summary.finalVideo,
    jobs: summary.jobs.map((j) => ({
      ...j,
      submittedAt: j.submittedAt ? j.submittedAt.toISOString() : null,
      lastCheckedAt: j.lastCheckedAt ? j.lastCheckedAt.toISOString() : null,
      finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
    })),
  };
}
