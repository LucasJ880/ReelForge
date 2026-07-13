import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { BatchFilmStrip } from "@/components/batch/batch-film-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  EXPANDING: "正在展开",
  RUNNING: "生成中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  PARTIAL_FAILED: "部分失败",
  FAILED: "失败",
  CANCELLED: "已取消",
} as const;

export default async function PlatformBatchesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/batches");
  const batches = await db.batchJob.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { template: { select: { nameZh: true, coverImage: true } } },
  }).catch(() => []);

  return (
    <div className="editorial-page-stack min-w-0">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl space-y-3">
          <p className="studio-label text-muted-foreground">Batch production</p>
          <h1 className="editorial-display">批量生产</h1>
          <p className="max-w-2xl text-body text-muted-foreground">
            从一条批次记录进入任务、分镜与失败分诊；状态与成本都保留在同一条生产链路。
          </p>
        </div>
        <Button render={<Link href="/app/batches/new" />}>
          <Plus aria-hidden />新建批次
        </Button>
      </header>

      {batches.length === 0 ? (
        <section className="rounded-(--radius-lg) border border-border bg-card px-6 py-12">
          <p className="text-body text-muted-foreground">还没有批次。从模板库选一个风格开始。</p>
          <Button render={<Link href="/app/templates" />} className="mt-5">
            浏览模板库<ArrowRight aria-hidden />
          </Button>
        </section>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2" aria-label="批次列表">
          {batches.map((batch) => {
            const queued = batch.queuedCount + batch.pausedCount;
            const variant = batch.status === "FAILED" ? "destructive" : batch.status === "COMPLETED" ? "success" : batch.status === "PARTIAL_FAILED" || batch.status === "PAUSED" ? "warning" : "default";
            return (
              <li key={batch.id} className="min-w-0">
                <article className="group min-w-0 h-full rounded-(--radius-lg) border border-border bg-card p-5 transition-colors hover:border-border-strong">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="studio-label text-muted-foreground">{batch.template.nameZh}</p>
                      <h2 className="mt-2 truncate font-heading text-subhead font-semibold">{batch.productName || "未命名批次"}</h2>
                    </div>
                    <Badge variant={variant}>{STATUS_LABEL[batch.status]}</Badge>
                  </div>
                  <BatchFilmStrip
                    className="mt-6"
                    counts={{
                      completed: batch.completedCount,
                      generating: batch.runningCount,
                      queued,
                      failed: batch.failedCount,
                      cancelled: batch.cancelledCount,
                    }}
                  />
                  <div className="mt-5 grid grid-cols-[1fr_1fr_auto] items-end gap-4">
                    <div>
                      <p className="studio-label text-muted-foreground">完成 / 总数</p>
                      <p className="mt-1 font-mono text-title font-semibold tabular-nums">{batch.completedCount}<span className="text-muted-foreground">/{batch.requestedCount}</span></p>
                    </div>
                    <div>
                      <p className="studio-label text-muted-foreground">成本快照</p>
                      <p className="mt-1 font-mono text-title font-semibold tabular-nums">$—</p>
                    </div>
                    <Button render={<Link href={`/app/batches/${batch.id}`} />} variant="ghost" size="sm" aria-label={`查看批次 ${batch.id}`}>
                      查看<ArrowRight aria-hidden />
                    </Button>
                  </div>
                  <p className="mt-4 break-all border-t border-border pt-3 font-mono text-meta text-muted-foreground">
                    {batch.id} · {batch.createdAt.toLocaleString("en-CA", { hour12: false })}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
