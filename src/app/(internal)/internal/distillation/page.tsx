import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DistillationPage() {
  const itemsRaw = await db.distillationFeature.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      deliveryOrder: { select: { id: true, title: true } },
    },
  });
  const roundIds = Array.from(
    new Set(itemsRaw.map((i) => i.sourceRoundId).filter(Boolean)),
  ) as string[];
  const rounds = await db.round.findMany({
    where: { id: { in: roundIds } },
    select: { id: true, roundIndex: true },
  });
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const items = itemsRaw.map((d) => ({
    ...d,
    sourceRound: d.sourceRoundId ? roundById.get(d.sourceRoundId) ?? null : null,
  }));

  return (
    <div>
      <PageHeader title="创意蒸馏" description="被 Top3 视频提炼的可复用创意特征" />
      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          还没有蒸馏记录，需要至少跑完一轮打分后才能蒸馏。
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <CardTitle className="text-sm">
                  <Link
                    href={`/orders/${d.deliveryOrderId}`}
                    className="hover:text-primary"
                  >
                    {d.deliveryOrder.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    来源：第 {d.sourceRound?.roundIndex ?? "?"} 轮 · {formatDate(d.createdAt)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="whitespace-pre-wrap text-muted-foreground">{d.summary}</p>
                <pre className="mt-2 max-h-60 overflow-auto rounded bg-secondary/40 p-2 text-[11px]">
                  {JSON.stringify(d.structured, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
