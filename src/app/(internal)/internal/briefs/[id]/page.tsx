import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge, briefTone, qaTone, publishTone } from "@/components/features/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ON_CAMERA_LABELS,
  PUBLISH_LABELS,
} from "@/lib/labels";
import {
  ANGLE_TYPE_USER_LABELS,
  BRIEF_USER_LABELS,
  COMMON_USER_TERMS,
  QA_USER_LABELS,
  QA_ROUTE_USER_LABELS,
} from "@/lib/labels-user";
import {
  RenderProgress,
  type RenderSummaryView,
} from "@/components/features/render-progress";
import { summarizeBriefRender } from "@/lib/services/video-service";
import { BriefActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brief = await db.videoBrief.findUnique({
    where: { id },
    include: {
      contentAngle: {
        include: { round: { include: { deliveryOrder: true } } },
      },
      scripts: {
        orderBy: { version: "desc" },
        include: {
          scenePlans: {
            orderBy: { sceneIndex: "asc" },
            include: { videoPrompts: true },
          },
        },
      },
      videoJobs: { orderBy: { createdAt: "desc" } },
      adEditPlans: { orderBy: [{ version: "desc" }, { createdAt: "desc" }] },
      qaReviews: { orderBy: { createdAt: "desc" } },
      publishRecords: {
        orderBy: { createdAt: "desc" },
        include: { metricsSnapshots: true },
      },
    },
  });
  if (!brief) notFound();

  const angle = brief.contentAngle;
  const round = angle.round;
  const currentScript = brief.scripts.find((s) => s.isCurrent);
  const renderSummary = serializeRenderSummary(
    await summarizeBriefRender(brief.id),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={angle.title}
        description={`${round.deliveryOrder.title} · 第 ${round.roundIndex} 组创意 · ${ANGLE_TYPE_USER_LABELS[angle.type]}`}
        actions={<BriefActions brief={brief} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={briefTone(brief.status)}>{BRIEF_USER_LABELS[brief.status]}</StatusBadge>
        <span className="text-meta text-muted-foreground">
          时长 {brief.durationSec}s · {brief.aspectRatio} · {ON_CAMERA_LABELS[brief.onCameraMode]}
        </span>
        <Link
          href={`/rounds/${round.id}`}
          className="text-meta text-muted-foreground hover:text-foreground"
        >
          ← 返回创意版本组
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{COMMON_USER_TERMS.angle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-body">
            {angle.hook && (
              <p>
                <span className="text-meta text-muted-foreground">开场钩子：</span>
                {angle.hook}
              </p>
            )}
            {angle.narrative && (
              <p>
                <span className="text-meta text-muted-foreground">叙事：</span>
                {angle.narrative}
              </p>
            )}
            {angle.explorationTheme && (
              <p className="text-meta text-muted-foreground">
                探索主题：{angle.explorationTheme}
              </p>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-meta text-muted-foreground">开发者信息（locale_notes）</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded-(--radius-md) bg-secondary p-3 font-mono text-meta">
                {JSON.stringify(angle.localeNotes, null, 2)}
              </pre>
            </details>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{COMMON_USER_TERMS.currentScript} (v{currentScript?.version ?? "—"})</CardTitle>
          </CardHeader>
          <CardContent className="text-body">
            {currentScript ? (
              <>
                <p className="text-meta text-muted-foreground">语言：{currentScript.language}</p>
                <p className="mt-2 whitespace-pre-wrap">{currentScript.fullText}</p>
                {currentScript.hook && (
                  <p className="mt-3 text-meta text-muted-foreground">
                    开场钩子：{currentScript.hook}
                  </p>
                )}
                {currentScript.cta && (
                  <p className="text-meta text-muted-foreground">行动号召：{currentScript.cta}</p>
                )}
              </>
            ) : (
              <p className="text-meta text-muted-foreground">尚未生成视频脚本</p>
            )}
          </CardContent>
        </Card>
      </div>

      {currentScript && currentScript.scenePlans.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>分镜与画面 Prompt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentScript.scenePlans.map((scene) => (
              <div key={scene.id} className="rounded-(--radius-md) border border-border p-3 text-meta">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">分镜 #{scene.sceneIndex}</span>
                  <StatusBadge tone="neutral">{scene.durationSec}s</StatusBadge>
                </div>
                <p className="mt-1 text-muted-foreground">{scene.visualIntent}</p>
                {scene.videoPrompts.map((p) => (
                  <details key={p.id} className="mt-2 rounded-(--radius-md) bg-secondary p-3">
                    <summary className="cursor-pointer text-meta text-muted-foreground">
                      画面 Prompt（开发者信息）{p.referenceImageUrl ? " · 含参考图" : ""}
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-meta">
                      {p.promptText}
                    </pre>
                  </details>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(brief.videoJobs.length > 0 ||
        ["RENDER_QUEUED", "RENDERING", "RENDER_FAILED", "RENDER_SUCCEEDED"].includes(
          brief.status,
        )) && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{COMMON_USER_TERMS.videoJobsSection}</CardTitle>
          </CardHeader>
          <CardContent>
            <RenderProgress
              briefId={brief.id}
              initial={renderSummary}
            />
          </CardContent>
        </Card>
      )}

      {brief.adEditPlans.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>真实素材剪辑计划</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-meta">
            {brief.adEditPlans.map((plan) => (
              <div key={plan.id} className="rounded-(--radius-md) border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="info">v{plan.version}</StatusBadge>
                  <span className="font-medium">{plan.title}</span>
                  <span className="text-muted-foreground">{plan.status}</span>
                  {plan.outputVideoUrl && (
                    <a href={plan.outputVideoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      输出
                    </a>
                  )}
                </div>
                {plan.objective && (
                  <p className="mt-1 text-muted-foreground">{plan.objective}</p>
                )}
                {plan.reviewSummary && (
                  <p className="mt-2 rounded-(--radius-md) bg-secondary p-3">{plan.reviewSummary}</p>
                )}
                <pre className="mt-2 max-h-48 overflow-auto rounded-(--radius-md) bg-secondary p-3 font-mono text-meta">
                  {JSON.stringify(plan.timeline, null, 2)}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {brief.finalVideoUrl && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>成片</CardTitle>
          </CardHeader>
          <CardContent>
            <video
              src={brief.finalVideoUrl}
              controls
              poster={brief.finalThumbnailUrl ?? undefined}
              className="max-h-120 rounded-(--radius-md)"
            />
            <p className="mt-2 break-all text-meta text-muted-foreground">{brief.finalVideoUrl}</p>
          </CardContent>
        </Card>
      )}

      {brief.qaReviews.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>质量检查</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-meta">
            {brief.qaReviews.map((q) => (
              <div key={q.id} className="rounded-(--radius-md) border border-border p-3">
                <div className="flex items-center gap-2">
                  <StatusBadge tone={qaTone(q.status)}>{QA_USER_LABELS[q.status]}</StatusBadge>
                  {q.aiOverallScore != null && (
                    <StatusBadge tone="info">综合评分 {q.aiOverallScore}</StatusBadge>
                  )}
                  {q.aiReviewRoute && (
                    <span className="text-muted-foreground">
                      推荐路径：{QA_ROUTE_USER_LABELS[q.aiReviewRoute] ?? q.aiReviewRoute}
                    </span>
                  )}
                </div>
                {q.reviewerComment && (
                  <p className="mt-2 text-muted-foreground">{q.reviewerComment}</p>
                )}
                {q.aiScoreBreakdown && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-meta text-muted-foreground">
                      详细打分（开发者信息）
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto rounded-(--radius-md) bg-secondary p-3 font-mono text-meta">
                      {JSON.stringify(q.aiScoreBreakdown, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {brief.publishRecords.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>发布 + 数据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-meta">
            {brief.publishRecords.map((r) => (
              <div key={r.id} className="rounded-(--radius-md) border border-border p-3">
                <div className="flex items-center gap-2">
                  <StatusBadge tone={publishTone(r.status)}>
                    {PUBLISH_LABELS[r.status]}
                  </StatusBadge>
                  {r.externalPostId && <span>post_id: {r.externalPostId}</span>}
                  {r.publishUrl && (
                    <a href={r.publishUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      TikTok 链接
                    </a>
                  )}
                </div>
                {r.metricsSnapshots.length > 0 && (
                  <div className="mt-2 grid gap-1 text-meta md:grid-cols-3">
                    {r.metricsSnapshots.map((snap) => (
                      <div key={snap.id} className="rounded-(--radius-md) bg-secondary p-3">
                        <div className="font-medium">+{snap.windowHours}h</div>
                        <pre className="mt-1 overflow-auto font-mono text-meta">
                          {JSON.stringify(snap.metrics, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/// 把后端 BriefRenderSummary 序列化成前端 client component 友好的形态（Date → string）。
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
    jobs: summary.jobs.map((j) => ({
      ...j,
      submittedAt: j.submittedAt ? j.submittedAt.toISOString() : null,
      lastCheckedAt: j.lastCheckedAt ? j.lastCheckedAt.toISOString() : null,
      finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
    })),
  };
}
