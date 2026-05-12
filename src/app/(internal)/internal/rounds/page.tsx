import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge } from "@/components/features/status-badge";
import { Card } from "@/components/ui/card";
import { ROUND_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RoundsPage() {
  const rounds = await db.round.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      deliveryOrder: { select: { id: true, title: true } },
      _count: { select: { angles: true } },
    },
  });

  return (
    <div>
      <PageHeader title="赛马轮次" description="所有进行中及历史轮次" />
      {rounds.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          尚无轮次。在交付单详情页启动第一轮。
        </Card>
      ) : (
        <div className="space-y-3">
          {rounds.map((r) => (
            <Link key={r.id} href={`/rounds/${r.id}`}>
              <Card size="sm" className="hover:ring-foreground/20 transition">
                <div className="flex items-center justify-between px-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">第 {r.roundIndex} 轮</span>
                      <StatusBadge tone="info">{ROUND_LABELS[r.status]}</StatusBadge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.deliveryOrder.title} · {r._count.angles} 条 angle
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground/70">
                    {formatDate(r.updatedAt)}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
