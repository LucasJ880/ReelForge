import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge, briefTone } from "@/components/features/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUND_LABELS } from "@/lib/labels";
import {
  ANGLE_TYPE_USER_LABELS,
  BRIEF_USER_LABELS,
  bucketBriefForParentSummary,
  COMMON_USER_TERMS,
} from "@/lib/labels-user";
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

  /// 父级聚合：5 个 angle 的视频生成进度
  const briefs = round.angles.map((a) => a.videoBrief).filter((b): b is NonNullable<typeof b> => !!b);
  const summaryCounts = briefs.reduce(
    (acc, b) => {
      const bucket = bucketBriefForParentSummary(b.status);
      acc[bucket] += 1;
      return acc;
    },
    { ready: 0, generating: 0, failed: 0, waiting: 0 },
  );
  const totalAngles = round.angles.length;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${round.deliveryOrder.title} · 第 ${round.roundIndex} 组创意`}
        description={`${ROUND_LABELS[round.status]} · ${round.angles.length} 个${COMMON_USER_TERMS.angle}`}
        actions={<RoundActions round={round} />}
      />

      <div className="mb-4">
        <Link
          href={`/orders/${round.deliveryOrderId}`}
          className="text-meta text-muted-foreground hover:text-foreground"
        >
          ← 返回交付单
        </Link>
      </div>

      {totalAngles > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>视频生成进度</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-meta">
            <StatusBadge tone="success">{summaryCounts.ready}/{totalAngles} 视频已生成</StatusBadge>
            {summaryCounts.generating > 0 && (
              <StatusBadge tone="info">{summaryCounts.generating}/{totalAngles} 正在生成</StatusBadge>
            )}
            {summaryCounts.failed > 0 && (
              <StatusBadge tone="danger">{summaryCounts.failed}/{totalAngles} 失败</StatusBadge>
            )}
            {summaryCounts.waiting > 0 && (
              <StatusBadge tone="neutral">{summaryCounts.waiting}/{totalAngles} 等待中</StatusBadge>
            )}
            <span className="text-muted-foreground">
              视频生成通常需要 2–5 分钟。可以离开此页面稍后回来。
            </span>
          </CardContent>
        </Card>
      )}

      {round.baseDistillation && (
        <Card className="mb-4 bg-secondary">
          <CardHeader>
            <CardTitle>上一组蒸馏特征（本组优化方向应遵循）</CardTitle>
          </CardHeader>
          <CardContent className="text-meta">
            <p className="whitespace-pre-wrap text-muted-foreground">
              {round.baseDistillation.summary}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-meta text-muted-foreground">详细结构（开发者信息）</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded-(--radius-md) bg-card p-3 font-mono text-meta">
                {JSON.stringify(round.baseDistillation.structured, null, 2)}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}

      {round.angles.length === 0 ? (
        <Card className="p-8 text-center text-body text-muted-foreground">
          尚未生成创意方向。点击右上「生成 5 个创意方向」。
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {round.angles.map((a) => {
            const brief = a.videoBrief;
            const latestPlan = brief?.adEditPlans[0];
            const qa = brief?.qaReviews[0];
            const pub = brief?.publishRecords[0];
            return (
              <Card key={a.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-meta text-muted-foreground">#{a.sortOrder}</span>
                      <span
                        className={
                          a.type === "OPTIMIZATION"
                            ? "text-meta text-success"
                            : "text-meta text-warning"
                        }
                      >
                        {ANGLE_TYPE_USER_LABELS[a.type]}
                      </span>
                      {a.explorationTheme && (
                        <span className="text-meta text-muted-foreground">
                          · {a.explorationTheme}
                        </span>
                      )}
                    </div>
                    {brief && (
                      <StatusBadge tone={briefTone(brief.status)}>
                        {BRIEF_USER_LABELS[brief.status]}
                      </StatusBadge>
                    )}
                  </div>
                  <CardTitle>{a.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-meta text-muted-foreground">
                  {a.hook && (
                    <p className="line-clamp-2">
                      <span className="text-foreground">开场钩子：</span> {a.hook}
                    </p>
                  )}
                  {a.narrative && <p className="line-clamp-2">{a.narrative}</p>}
                  {brief && brief.scripts.length > 0 && (
                    <p className="line-clamp-3 rounded-(--radius-md) bg-secondary p-3">
                      {brief.scripts[0].fullText.slice(0, 140)}…
                    </p>
                  )}
                  {latestPlan && (
                    <div>
                      剪辑计划：{latestPlan.title}
                    </div>
                  )}
                  {qa && qa.aiOverallScore != null && (
                    <div>综合评分：{qa.aiOverallScore}</div>
                  )}
                  {pub?.externalPostId && <div>已发布到 TikTok</div>}
                  {brief && (
                    <Link
                      href={`/briefs/${brief.id}`}
                      className="mt-1 inline-block text-primary hover:underline"
                    >
                      打开创意简报 →
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
          <h2 className="mb-3 font-heading text-title">打分与排名</h2>
          <div className="space-y-3">
            {round.scoreReports.map((sr) => (
              <Card key={sr.id}>
                <CardContent className="text-meta">
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
                    <pre className="mt-2 max-h-40 overflow-auto rounded-(--radius-md) bg-secondary p-3 font-mono text-meta">
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
