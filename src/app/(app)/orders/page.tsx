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
    <div>
      <PageHeader
        title="交付单"
        description={`共 ${total} 个交付单`}
        actions={
          <Link href="/orders/new">
            <Button>
              <Plus className="h-4 w-4" />
              新建交付单
            </Button>
          </Link>
        }
      />

      {items.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            还没有交付单。点击「新建交付单」开始第一个产品。
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((order) => {
            const latestRound = order.rounds[0];
            return (
              <Link key={order.id} href={`/orders/${order.id}`}>
                <Card size="sm" className="hover:ring-foreground/20 transition">
                  <div className="flex items-center justify-between gap-4 px-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium">{order.title}</h3>
                        <StatusBadge tone={deliveryTone(order.status)}>
                          {DELIVERY_ORDER_LABELS[order.status]}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>{order.productCategory}</span>
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
                    <div className="text-right text-xs text-muted-foreground/70">
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
