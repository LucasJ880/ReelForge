import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDateShort, formatNumber } from "@/lib/utils";
import { MetricsImport } from "./metrics-import";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const recent = await db.metricsSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    take: 50,
    include: {
      publishRecord: {
        include: {
          videoBrief: {
            include: {
              contentAngle: {
                include: {
                  round: { include: { deliveryOrder: { select: { title: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });

  return (
    <div>
      <PageHeader title="数据导入" description="通过 CSV 上传 TikTok 12/24/48h 数据窗口" />

      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>CSV 上传</CardTitle>
          </CardHeader>
          <CardContent>
            <MetricsImport />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-semibold">最近数据快照</h2>
      {recent.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          还没有数据快照
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">时间</th>
                  <th>交付单 / 轮次</th>
                  <th>post_id</th>
                  <th>窗口</th>
                  <th className="text-right">Views</th>
                  <th className="text-right">Completion</th>
                  <th className="text-right">Likes</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => {
                  const m = (s.metrics ?? {}) as Record<string, number | undefined>;
                  const order =
                    s.publishRecord.videoBrief.contentAngle.round.deliveryOrder;
                  const round = s.publishRecord.videoBrief.contentAngle.round;
                  return (
                    <tr key={s.id} className="border-t border-border/40">
                      <td className="py-2">{formatDateShort(s.capturedAt)}</td>
                      <td className="truncate">{order.title} · 第 {round.roundIndex} 轮</td>
                      <td className="font-mono">{s.publishRecord.externalPostId ?? "—"}</td>
                      <td>+{s.windowHours}h</td>
                      <td className="text-right">{formatNumber(m.views)}</td>
                      <td className="text-right">
                        {m.completion_rate != null
                          ? `${(m.completion_rate * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="text-right">{formatNumber(m.likes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
