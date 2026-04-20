import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge, briefTone, qaTone, publishTone } from "@/components/features/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ANGLE_TYPE_LABELS,
  BRIEF_LABELS,
  ON_CAMERA_LABELS,
  PUBLISH_LABELS,
  QA_LABELS,
  VIDEO_JOB_LABELS,
} from "@/lib/labels";
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

  return (
    <div>
      <PageHeader
        title={angle.title}
        description={`${round.deliveryOrder.title} · 第 ${round.roundIndex} 轮 · ${ANGLE_TYPE_LABELS[angle.type]}`}
        actions={<BriefActions brief={brief} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={briefTone(brief.status)}>{BRIEF_LABELS[brief.status]}</StatusBadge>
        <span className="text-xs text-muted-foreground">
          时长 {brief.durationSec}s · {brief.aspectRatio} · {ON_CAMERA_LABELS[brief.onCameraMode]}
        </span>
        <Link
          href={`/rounds/${round.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 返回轮次
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Angle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {angle.hook && (
              <p>
                <span className="text-xs text-muted-foreground">Hook: </span>
                {angle.hook}
              </p>
            )}
            {angle.narrative && (
              <p>
                <span className="text-xs text-muted-foreground">Narrative: </span>
                {angle.narrative}
              </p>
            )}
            {angle.explorationTheme && (
              <p className="text-xs text-muted-foreground">
                探索主题: {angle.explorationTheme}
              </p>
            )}
            <pre className="max-h-40 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">
              {JSON.stringify(angle.localeNotes, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>当前脚本 (v{currentScript?.version ?? "—"})</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {currentScript ? (
              <>
                <p className="text-[11px] text-muted-foreground">语言: {currentScript.language}</p>
                <p className="mt-2 whitespace-pre-wrap">{currentScript.fullText}</p>
                {currentScript.hook && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Hook 句: {currentScript.hook}
                  </p>
                )}
                {currentScript.cta && (
                  <p className="text-xs text-muted-foreground">CTA: {currentScript.cta}</p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">尚未生成脚本</p>
            )}
          </CardContent>
        </Card>
      </div>

      {currentScript && currentScript.scenePlans.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>分镜 + Prompt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentScript.scenePlans.map((scene) => (
              <div key={scene.id} className="rounded border border-border/60 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Scene #{scene.sceneIndex}</span>
                  <StatusBadge tone="neutral">{scene.durationSec}s</StatusBadge>
                </div>
                <p className="mt-1 text-muted-foreground">{scene.visualIntent}</p>
                {scene.videoPrompts.map((p) => (
                  <div key={p.id} className="mt-2 rounded bg-secondary/40 p-2">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{p.provider}</span>
                      {p.referenceImageUrl && <span>· 有参考图</span>}
                    </div>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">
                      {p.promptText}
                    </pre>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {brief.videoJobs.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>渲染任务</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {brief.videoJobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between rounded bg-secondary/30 p-2">
                <div>
                  <span className="font-medium">{j.provider}</span>
                  <span className="ml-2 text-muted-foreground">
                    {VIDEO_JOB_LABELS[j.status]}
                    {j.externalJobId && ` · ${j.externalJobId.slice(0, 16)}…`}
                  </span>
                </div>
                {j.outputVideoUrl && (
                  <a
                    href={j.outputVideoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    查看视频
                  </a>
                )}
                {j.errorMessage && (
                  <span className="text-destructive">{j.errorMessage}</span>
                )}
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
              className="max-h-[480px] rounded"
            />
            <p className="mt-2 text-[11px] text-muted-foreground break-all">{brief.finalVideoUrl}</p>
          </CardContent>
        </Card>
      )}

      {brief.qaReviews.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>QA 审核</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {brief.qaReviews.map((q) => (
              <div key={q.id} className="rounded border border-border/60 p-3">
                <div className="flex items-center gap-2">
                  <StatusBadge tone={qaTone(q.status)}>{QA_LABELS[q.status]}</StatusBadge>
                  {q.aiOverallScore != null && (
                    <StatusBadge tone="info">AI 分 {q.aiOverallScore}</StatusBadge>
                  )}
                  {q.aiReviewRoute && (
                    <span className="text-muted-foreground">路由 {q.aiReviewRoute}</span>
                  )}
                </div>
                {q.reviewerComment && (
                  <p className="mt-2 text-muted-foreground">{q.reviewerComment}</p>
                )}
                {q.aiScoreBreakdown && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">
                    {JSON.stringify(q.aiScoreBreakdown, null, 2)}
                  </pre>
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
          <CardContent className="space-y-3 text-xs">
            {brief.publishRecords.map((r) => (
              <div key={r.id} className="rounded border border-border/60 p-3">
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
                  <div className="mt-2 grid gap-1 text-[11px] md:grid-cols-3">
                    {r.metricsSnapshots.map((snap) => (
                      <div key={snap.id} className="rounded bg-secondary/40 p-2">
                        <div className="font-medium">+{snap.windowHours}h</div>
                        <pre className="mt-1 overflow-auto text-[10px]">
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
