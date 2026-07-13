import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge, deliveryTone, briefTone } from "@/components/features/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DELIVERY_ORDER_LABELS,
  RESEARCH_LABELS,
  ROUND_LABELS,
} from "@/lib/labels";
import {
  ANGLE_TYPE_USER_LABELS,
  BRIEF_USER_LABELS,
  COMMON_USER_TERMS,
} from "@/lib/labels-user";
import { getDeliveryOrderDetail } from "@/lib/services/order-service";
import { formatDate } from "@/lib/utils";
import { AssetActions } from "./asset-actions";
import { OrderActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getDeliveryOrderDetail(id);
  if (!order) notFound();
  const productInput = (order.productInput ?? {}) as Record<string, unknown>;
  const footageAssets = order.rawAssets;

  return (
    <div className="space-y-8">
      <PageHeader
        title={order.title}
        description={`${order.productCategory} · ${order.targetPlatform} · ${order.targetCountry} / ${order.targetLanguage}${order.targetRegionVariant ? ` (${order.targetRegionVariant})` : ""}`}
        actions={<OrderActions order={order} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={deliveryTone(order.status)}>
          {DELIVERY_ORDER_LABELS[order.status]}
        </StatusBadge>
        {order.marketResearch && (
          <StatusBadge tone={order.marketResearch.status === "READY" ? "success" : "info"}>
            调研: {RESEARCH_LABELS[order.marketResearch.status]}
          </StatusBadge>
        )}
        <span className="text-meta text-muted-foreground">
          创建于 {formatDate(order.createdAt)}
          {order.createdBy && ` · ${order.createdBy.email}`}
        </span>
      </div>

      <PipelineStatus order={order} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>产品输入</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-meta">
            <InfoRow label="名称" value={productInput.product_name} />
            <InfoRow label="目标客户" value={productInput.target_audience} />
            <InfoRow label="价格" value={productInput.price_range} />
            <InfoRow label="品牌风格" value={productInput.brand_style} />
            {typeof productInput.product_url === "string" && (
              <a
                href={productInput.product_url}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-primary hover:underline"
              >
                {productInput.product_url}
              </a>
            )}
          </CardContent>
        </Card>

        <Card id="assets">
          <CardHeader>
            <CardTitle>市场调研</CardTitle>
          </CardHeader>
          <CardContent className="text-meta">
            {order.marketResearch?.summary ? (
              <p className="whitespace-pre-wrap text-muted-foreground">
                {order.marketResearch.summary}
              </p>
            ) : (
              <p className="text-muted-foreground">未开始，点击右上「执行调研 + 卖点」</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>真实素材 ({footageAssets.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-meta">
            <AssetActions orderId={order.id} />
            {footageAssets.length === 0 ? (
              <p className="text-muted-foreground">未上传素材。可上传文件或粘贴素材 URL。</p>
            ) : (
              footageAssets.slice(0, 8).map((asset, index) => (
                <a
                  key={`${asset.url}-${index}`}
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-(--radius-md) border border-border bg-card p-3 transition-colors duration-fast hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                >
                  <span className="mr-2 rounded-(--radius-sm) bg-secondary px-2 py-1 uppercase">
                    {asset.type.toLowerCase()}
                  </span>
                  <span className="break-all">{asset.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {asset.status} · {asset.shots.length} shots
                  </span>
                  {asset.errorMessage && (
                    <span className="ml-2 text-destructive">{asset.errorMessage}</span>
                  )}
                </a>
              ))
            )}
            {typeof productInput.footage_notes === "string" && (
              <p className="whitespace-pre-wrap rounded-(--radius-md) bg-secondary p-3 text-muted-foreground">
                {productInput.footage_notes}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>卖点 ({order.sellingPoints.length})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-body md:grid-cols-2 lg:grid-cols-3">
            {order.sellingPoints.length === 0 ? (
              <p className="text-meta text-muted-foreground">未生成</p>
            ) : (
              order.sellingPoints.map((sp) => (
                <div key={sp.id} className="rounded-(--radius-md) border border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-meta text-muted-foreground">#{sp.rank}</span>
                    <span className="text-meta uppercase tracking-wider text-primary">
                      {sp.kind}
                    </span>
                    <span className="text-body font-medium">{sp.title}</span>
                  </div>
                  <p className="mt-1 text-meta text-muted-foreground">{sp.body}</p>
                </div>
              ))
            )}
        </CardContent>
      </Card>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-title">{COMMON_USER_TERMS.raceRound}（{order.rounds.length}/{order.maxRounds}）</h2>
        </div>
        {order.rounds.length === 0 ? (
          <Card className="p-8 text-center text-body text-muted-foreground">
            尚未开启任何轮次。卖点就绪后可在右上角「启动第一轮」。
          </Card>
        ) : (
          <div className="space-y-4">
            {order.rounds.map((round) => (
              <Card key={round.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      <Link
                        href={`/rounds/${round.id}`}
                        className="inline-flex items-center gap-2 hover:text-primary"
                      >
                        第 {round.roundIndex} 组创意
                        <ArrowRight strokeWidth={1.5} aria-hidden />
                      </Link>
                    </CardTitle>
                    <StatusBadge tone="info">{ROUND_LABELS[round.status]}</StatusBadge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 md:grid-cols-5">
                    {round.angles.map((a) => (
                      <Link
                        key={a.id}
                        href={a.videoBrief ? `/briefs/${a.videoBrief.id}` : `/rounds/${round.id}`}
                        className="rounded-(--radius-md) border border-border bg-card p-3 text-meta transition-colors duration-fast hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-meta text-muted-foreground">
                            #{a.sortOrder}
                          </span>
                          <span
                            className={
                              a.type === "OPTIMIZATION"
                                ? "text-meta text-success"
                                : "text-meta text-warning"
                            }
                          >
                            {ANGLE_TYPE_USER_LABELS[a.type]}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 font-medium">{a.title}</p>
                        {a.videoBrief && (
                          <StatusBadge
                            tone={briefTone(a.videoBrief.status)}
                            className="mt-1.5"
                          >
                            {BRIEF_USER_LABELS[a.videoBrief.status]}
                          </StatusBadge>
                        )}
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {order.distillations.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-heading text-title">创意蒸馏 ({order.distillations.length})</h2>
          <div className="space-y-3">
            {order.distillations.map((d) => (
              <Card key={d.id}>
                <CardContent className="text-body">
                  <p className="whitespace-pre-wrap text-muted-foreground">{d.summary}</p>
                  <pre className="mt-3 max-h-40 overflow-auto rounded-(--radius-md) bg-secondary p-3 font-mono text-meta">
                    {JSON.stringify(d.structured, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PipelineStatus({ order }: { order: NonNullable<Awaited<ReturnType<typeof getDeliveryOrderDetail>>> }) {
  const rawAssetCount = order.rawAssets.length;
  const indexedAssetCount = order.rawAssets.filter((asset) => asset.status === "INDEXED").length;
  const shotCount = order.rawAssets.reduce((sum, asset) => sum + asset.shots.length, 0);
  const briefs = order.rounds.flatMap((round) =>
    round.angles.map((angle) => angle.videoBrief).filter(Boolean),
  );
  const planCount = briefs.reduce((sum, brief) => sum + (brief?.adEditPlans.length ?? 0), 0);
  const reviewedPlanCount = briefs.reduce(
    (sum, brief) =>
      sum + (brief?.adEditPlans.filter((plan) => ["REVIEWED", "RENDERED"].includes(plan.status)).length ?? 0),
    0,
  );
  const renderedCount = briefs.filter((brief) => brief?.finalVideoUrl).length;
  const qaCount = briefs.filter((brief) => (brief?.qaReviews.length ?? 0) > 0).length;
  const metricsCount = briefs.reduce(
    (sum, brief) =>
      sum +
      (brief?.publishRecords.reduce(
        (snapSum, record) => snapSum + record.metricsSnapshots.length,
        0,
      ) ?? 0),
    0,
  );
  const hasScore = order.rounds.some((round) => round.scoreReports.length > 0);
  const hasDistillation = order.distillations.length > 0;

  const stages = [
    {
      label: "上传",
      done: rawAssetCount >= 3,
      detail: `${rawAssetCount}/3 RawAssets`,
      action: rawAssetCount < 3 ? "上传或登记至少 3 个素材" : "已满足 demo 素材数",
      href: "#assets",
    },
    {
      label: "预处理",
      done: indexedAssetCount >= rawAssetCount && shotCount > 0,
      detail: `${indexedAssetCount}/${rawAssetCount} indexed · ${shotCount} shots`,
      action: shotCount === 0 ? "点击真实素材区的「预处理并打标签」" : "镜头索引已生成",
      href: "#assets",
    },
    {
      label: "计划",
      done: planCount >= 5,
      detail: `${planCount}/5 AdEditPlans`,
      action: planCount < 5 ? "进入轮次页生成 5 条广告" : "剪辑计划已生成",
      href: order.rounds[0] ? `/rounds/${order.rounds[0].id}` : undefined,
    },
    {
      label: "Review",
      done: reviewedPlanCount >= Math.min(planCount, 5) && reviewedPlanCount > 0,
      detail: `${reviewedPlanCount}/${planCount} reviewed`,
      action: reviewedPlanCount === 0 ? "生成计划后自动跑 ReviewerAgent" : "ReviewerAgent 结果已写入 QA",
      href: order.rounds[0] ? `/rounds/${order.rounds[0].id}` : undefined,
    },
    {
      label: "渲染",
      done: renderedCount > 0,
      detail: `${renderedCount} final videos`,
      action: renderedCount === 0 ? "打开 Brief 渲染至少 1 条真实素材剪辑" : "finalVideoUrl 已绑定",
      href: briefs[0] ? `/briefs/${briefs[0].id}` : undefined,
    },
    {
      label: "人工审核",
      done: qaCount > 0,
      detail: `${qaCount} QA records`,
      action: qaCount === 0 ? "先运行 ReviewerAgent 或 AI 初审" : "QA 结果可查看",
      href: "/qa",
    },
    {
      label: "数据",
      done: metricsCount > 0,
      detail: `${metricsCount} metric snapshots`,
      action: metricsCount === 0 ? "导入 CSV 指标" : "指标已回流",
      href: "/metrics",
    },
    {
      label: "迭代",
      done: hasScore && hasDistillation,
      detail: `${hasScore ? "scored" : "no score"} · ${hasDistillation ? "distilled" : "no distill"}`,
      action: hasScore && hasDistillation ? "下一轮建议已生成" : "轮次页点击「复盘 + 下一轮」",
      href: order.rounds[0] ? `/rounds/${order.rounds[0].id}` : undefined,
    },
  ];

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>MVP Demo Pipeline</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-meta md:grid-cols-4">
        {stages.map((stage) => (
          <div
            key={stage.label}
            className={`rounded-(--radius-md) border p-3 ${
              stage.done
                ? "border-success bg-card"
                : "border-border bg-secondary"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{stage.label}</span>
              <StatusBadge tone={stage.done ? "success" : "neutral"}>
                {stage.done ? "OK" : "Next"}
              </StatusBadge>
            </div>
            <p className="mt-1 text-muted-foreground">{stage.detail}</p>
            {stage.href ? (
              <Link href={stage.href} className="mt-2 inline-block text-primary hover:underline">
                {stage.action}
              </Link>
            ) : (
              <p className="mt-2 text-muted-foreground">{stage.action}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: unknown }) {
  if (typeof value !== "string" || value.length === 0) return null;
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}
