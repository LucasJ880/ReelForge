import Link from "next/link";
import { Plus, Layers, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";

const statusConfig: Record<string, { label: string; dot: string }> = {
  PENDING: { label: "等待中", dot: "bg-zinc-300" },
  RUNNING: { label: "执行中", dot: "bg-teal-500 animate-pulse" },
  PAUSED: { label: "已暂停", dot: "bg-amber-400" },
  COMPLETED: { label: "已完成", dot: "bg-emerald-500" },
  FAILED: { label: "失败", dot: "bg-red-500" },
};

export default async function BatchListPage() {
  const batches = await db.batch.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { projects: true } } },
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-1">
            生产队列
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            批量任务
          </h1>
        </div>
        <Link
          href="/batches/new"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-700"
        >
          <Plus className="h-3.5 w-3.5" />
          新建批次
        </Link>
      </div>

      {batches.length === 0 ? (
        <div className="text-center py-20">
          <Layers className="h-8 w-8 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-400 text-sm mb-6">暂无批量任务</p>
          <Link
            href="/batches/new"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-700"
          >
            创建批次
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map((batch) => {
            const s = statusConfig[batch.status] || statusConfig.PENDING;
            const pct = batch.totalCount > 0
              ? Math.round(((batch.completedCount + batch.failedCount) / batch.totalCount) * 100)
              : 0;

            return (
              <Link key={batch.id} href={`/batches/${batch.id}`}>
                <div className="group flex items-center justify-between rounded-xl border border-white/5 bg-zinc-900/50 p-4 transition-all hover:border-zinc-800 hover:bg-white/5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${s.dot}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">
                          {batch.name}
                        </p>
                        <span className="text-[11px] text-zinc-400">{s.label}</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {batch._count.projects} 个项目 · {batch.completedCount} 完成
                        {batch.failedCount > 0 && ` · ${batch.failedCount} 失败`}
                        {" · "}{formatDate(batch.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-20 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-zinc-400 w-8 text-right tabular-nums">{pct}%</span>
                    <span className="text-xs text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
