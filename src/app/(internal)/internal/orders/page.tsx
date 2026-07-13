import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge, deliveryTone } from "@/components/features/status-badge";
import { DELIVERY_ORDER_LABELS, ROUND_LABELS } from "@/lib/labels";
import { listDeliveryOrders } from "@/lib/services/order-service";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { items, total } = await listDeliveryOrders();

  return (
    <div className="space-y-8">
      <PageHeader
        title="广告项目"
        description={`共 ${total} 个真实素材广告项目`}
        actions={
          <Link href="/orders/new">
            <Button>
            <Plus strokeWidth={1.5} aria-hidden />
              新建广告项目
            </Button>
          </Link>
        }
      />

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-body text-muted-foreground">
            还没有广告项目。点击「新建广告项目」开始第一个真实素材测试。
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((order) => {
            const latestRound = order.rounds[0];
            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Card size="sm" className="transition-colors duration-fast hover:border-foreground motion-reduce:transition-none">
                  <div className="flex min-w-0 flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium">{order.title}</h3>
                        <StatusBadge tone={deliveryTone(order.status)}>
                          {DELIVERY_ORDER_LABELS[order.status]}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-meta text-muted-foreground">
                        <span>{order.productCategory}</span>
                        <span>{order.targetPlatform}</span>
                        <span>
                          {order.targetCountry} · {order.targetLanguage}
                        </span>
                        <span>卖点 {order._count.sellingPoints}</span>
                        <span>轮次 {order._count.rounds}</span>
                        {latestRound && (
                          <span>
                            #{latestRound.roundIndex} · {ROUND_LABELS[latestRound.status]}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-meta text-muted-foreground sm:text-right">
                      {formatDate(order.createdAt)}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
