import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge, briefTone } from "@/components/features/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ANGLE_TYPE_LABELS,
  BRIEF_LABELS,
  ROUND_LABELS,
  VIDEO_JOB_LABELS,
} from "@/lib/labels";
import { RoundActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function RoundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const round = await db.round.findUnique({
    where: { id },
    include: {
      deliveryOrder: true,
      baseDistillation: true,
      angles: {
        orderBy: { sortOrder: "asc" },
        include: {
          videoBrief: {
            include: {
              scripts: { where: { isCurrent: true } },
              videoJobs: { orderBy: { createdAt: "desc" }, take: 1 },
              qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
              publishRecords: { orderBy: { createdAt: "desc" }, take: 1 },
              adEditPlans: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      },
      scoreReports: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!round) notFound();

  return (
    <div>
      <PageHeader
        title={`${round.deliveryOrder.title} · 第 ${round.roundIndex} 轮`}
        description={`${ROUND_LABELS[round.status]} · ${round.angles.length} 条 angle`}
        actions={<RoundActions round={round} />}
      />

      <div className="mb-4">
        <Link
          href={`/orders/${round.deliveryOrderId}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 返回交付单
        </Link>
      </div>

      {round.baseDistillation && (
        <Card className="mb-4 bg-secondary/30">
          <CardHeader>
            <CardTitle className="text-sm">上一轮蒸馏特征（本轮 OPTIMIZATION 必须遵循）</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <p className="whitespace-pre-wrap text-muted-foreground">
              {round.baseDistillation.summary}
            </p>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-secondary/60 p-2 text-[11px]">
              {JSON.stringify(round.baseDistillation.structured, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {round.angles.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          尚未生成 angle。点击右上「生成 5 条 angle」。
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {round.angles.map((a) => {
            const brief = a.videoBrief;
            const latestJob = brief?.videoJobs[0];
            const latestPlan = brief?.adEditPlans[0];
            const qa = brief?.qaReviews[0];
            const pub = brief?.publishRecords[0];
            return (
              <Card key={a.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">#{a.sortOrder}</span>
                      <span
                        className={
                          a.type === "OPTIMIZATION"
                            ? "text-[10px] text-emerald-400"
                            : "text-[10px] text-amber-400"
                        }
                      >
                        {ANGLE_TYPE_LABELS[a.type]}
                      </span>
                      {a.explorationTheme && (
                        <span className="text-[10px] text-muted-foreground">
                          · {a.explorationTheme}
                        </span>
                      )}
                    </div>
                    {brief && (
                      <StatusBadge tone={briefTone(brief.status)}>
                        {BRIEF_LABELS[brief.status]}
                      </StatusBadge>
                    )}
                  </div>
                  <CardTitle className="text-sm">{a.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  {a.hook && <p className="line-clamp-2"><span className="text-foreground">Hook:</span> {a.hook}</p>}
                  {a.narrative && <p className="line-clamp-2">{a.narrative}</p>}
                  {brief && brief.scripts.length > 0 && (
                    <p className="rounded bg-secondary/40 p-2 line-clamp-3">
                      {brief.scripts[0].fullText.slice(0, 140)}…
                    </p>
                  )}
                  {latestJob && (
                    <div>
                      渲染: {VIDEO_JOB_LABELS[latestJob.status]}
                      {latestJob.errorMessage && (
                        <span className="text-destructive"> · {latestJob.errorMessage}</span>
                      )}
                    </div>
                  )}
                  {latestPlan && (
                    <div>
                      剪辑计划: {latestPlan.status} · {latestPlan.title}
                    </div>
                  )}
                  {qa && (
                    <div>
                      QA 分: {qa.aiOverallScore ?? "—"} · 路由 {qa.aiReviewRoute ?? "—"}
                    </div>
                  )}
                  {pub?.externalPostId && <div>TikTok post: {pub.externalPostId}</div>}
                  {brief && (
                    <Link
                      href={`/briefs/${brief.id}`}
                      className="mt-1 inline-block text-primary hover:underline"
                    >
                      打开 brief →
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {round.scoreReports.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">打分 / 排名</h2>
          <div className="space-y-3">
            {round.scoreReports.map((sr) => (
              <Card key={sr.id}>
                <CardContent className="pt-4 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {sr.videoBriefId ? `Brief ${sr.videoBriefId.slice(-6)}` : "轮次级汇总"}
                    </span>
                    {sr.contentScore != null && (
                      <StatusBadge tone="info">Content {sr.contentScore}</StatusBadge>
                    )}
                    {sr.compositeScore != null && (
                      <StatusBadge tone="success">Composite {sr.compositeScore}</StatusBadge>
                    )}
                  </div>
                  {sr.explanation && (
                    <p className="mt-1 text-muted-foreground">{sr.explanation}</p>
                  )}
                  {sr.ranking ? (
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">
                      {JSON.stringify(sr.ranking, null, 2)}
                    </pre>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
