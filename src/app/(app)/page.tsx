import Link from "next/link";
import {
  ArrowRight,
  Zap,
  Video,
  TrendingUp,
  BarChart3,
  Layers,
} from "lucide-react";
import { StatusBadge } from "@/components/project/status-badge";
import { db } from "@/lib/db";
import { BatchStatus, ProjectStatus } from "@prisma/client";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const [totalProjects, publishedCount, analyzedCount, recentProjects, runningBatches] =
    await Promise.all([
      db.project.count(),
      db.project.count({
        where: {
          status: {
            in: [
              ProjectStatus.PUBLISHED,
              ProjectStatus.ANALYTICS_PENDING,
              ProjectStatus.ANALYTICS_FETCHED,
              ProjectStatus.ANALYZED,
            ],
          },
        },
      }),
      db.project.count({ where: { status: ProjectStatus.ANALYZED } }),
      db.project.findMany({
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: {
          contentPlan: { select: { caption: true } },
          videoJob: { select: { status: true, videoUrl: true } },
        },
      }),
      db.batch.findMany({
        where: { status: BatchStatus.RUNNING },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
    ]);

  const latestSnapshots = await db.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(s.views), 0) as total
    FROM (
      SELECT DISTINCT ON ("publicationId") views
      FROM "AnalyticsSnapshot"
      ORDER BY "publicationId", "fetchedAt" DESC
    ) s
  `;
  const totalViews = Number(latestSnapshots[0]?.total ?? 0);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-2">
            创作工作台
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            用 AI 创作你的下一个爆款视频
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/batches/new"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/5"
          >
            <Zap className="h-3.5 w-3.5" />
            批量生成
          </Link>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            开始创作
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Stats — inline, not cards */}
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <Stat icon={Video} label="作品" value={totalProjects} />
        <Stat icon={TrendingUp} label="已发布" value={publishedCount} />
        <Stat icon={BarChart3} label="总播放" value={totalViews.toLocaleString()} />
        <Stat icon={BarChart3} label="已分析" value={analyzedCount} />
      </div>

      {/* Running batches */}
      {runningBatches.length > 0 && (
        <div className="rounded-xl bg-violet-500/10 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-violet-400 font-medium">
              <Layers className="h-3.5 w-3.5" />
              执行中
            </div>
            <Link href="/batches" className="text-xs text-violet-400 hover:text-violet-300 font-medium">
              全部批次
            </Link>
          </div>
          <div className="space-y-2">
            {runningBatches.map((b) => {
              const pct = b.totalCount > 0
                ? Math.round(((b.completedCount + b.failedCount) / b.totalCount) * 100)
                : 0;
              return (
                <Link key={b.id} href={`/batches/${b.id}`}>
                  <div className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5 transition-colors">
                    <span className="text-sm font-medium text-zinc-100">{b.name}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-20 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-violet-400 font-medium w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent works */}
      {recentProjects.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium">
              最近作品
            </p>
            <Link href="/projects" className="text-xs text-zinc-400 hover:text-zinc-300 font-medium">
              查看全部
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div className="group rounded-xl border border-white/5 bg-zinc-900/50 p-4 transition-all hover:border-zinc-800">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-sm font-medium text-zinc-100 truncate">
                      {p.keyword}
                    </h3>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="text-xs text-zinc-400 truncate mb-3">
                    {p.contentPlan?.caption || "尚未生成内容"}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-400">
                      {formatDate(p.updatedAt)}
                    </span>
                    <span className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      查看 →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-16">
          <p className="text-zinc-400 text-sm mb-6">还没有作品，开始你的第一次创作</p>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            开始创作
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-zinc-400" />
      <div>
        <p className="text-2xl font-extralight tabular-nums text-white">{value}</p>
        <p className="text-[11px] text-zinc-400">{label}</p>
      </div>
    </div>
  );
}
