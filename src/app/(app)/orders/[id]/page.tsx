import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge, deliveryTone, briefTone } from "@/components/features/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BRIEF_LABELS,
  DELIVERY_ORDER_LABELS,
  RESEARCH_LABELS,
  ROUND_LABELS,
  ANGLE_TYPE_LABELS,
} from "@/lib/labels";
import { getDeliveryOrderDetail } from "@/lib/services/order-service";
import { formatDate } from "@/lib/utils";
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

  return (
    <div>
      <PageHeader
        title={order.title}
        description={`${order.productCategory} · ${order.targetCountry} / ${order.targetLanguage}${order.targetRegionVariant ? ` (${order.targetRegionVariant})` : ""}`}
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
        <span className="text-xs text-muted-foreground">
          创建于 {formatDate(order.createdAt)}
          {order.createdBy && ` · ${order.createdBy.email}`}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>产品输入</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <pre className="max-h-60 overflow-auto rounded bg-secondary/40 p-2 whitespace-pre-wrap break-all">
              {JSON.stringify(order.productInput, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>市场调研</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
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
            <CardTitle>卖点 ({order.sellingPoints.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {order.sellingPoints.length === 0 ? (
              <p className="text-xs text-muted-foreground">未生成</p>
            ) : (
              order.sellingPoints.map((sp) => (
                <div key={sp.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">#{sp.rank}</span>
                    <span className="text-[10px] uppercase tracking-wider text-primary">
                      {sp.kind}
                    </span>
                    <span className="text-sm font-medium">{sp.title}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{sp.body}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">赛马轮次 ({order.rounds.length}/{order.maxRounds})</h2>
        </div>
        {order.rounds.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
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
                        第 {round.roundIndex} 轮
                        <ArrowRight className="h-3.5 w-3.5" />
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
                        className="rounded-md border border-border/60 bg-card/60 p-3 text-xs hover:ring-1 hover:ring-foreground/20"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">
                            #{a.sortOrder}
                          </span>
                          <span
                            className={
                              a.type === "OPTIMIZATION"
                                ? "text-[10px] text-emerald-400"
                                : "text-[10px] text-amber-400"
                            }
                          >
                            {ANGLE_TYPE_LABELS[a.type]}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 font-medium">{a.title}</p>
                        {a.videoBrief && (
                          <StatusBadge
                            tone={briefTone(a.videoBrief.status)}
                            className="mt-1.5"
                          >
                            {BRIEF_LABELS[a.videoBrief.status]}
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
          <h2 className="mb-3 text-lg font-semibold">创意蒸馏 ({order.distillations.length})</h2>
          <div className="space-y-3">
            {order.distillations.map((d) => (
              <Card key={d.id}>
                <CardContent className="pt-4 text-sm">
                  <p className="whitespace-pre-wrap text-muted-foreground">{d.summary}</p>
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">
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
