import Link from "next/link";
import {
  ArrowRight,
  Zap,
  Video,
  Layers,
  Sparkles,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { StatusBadge } from "@/components/project/status-badge";
import { db } from "@/lib/db";
import { BatchStatus, ProjectStatus } from "@prisma/client";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const [totalProjects, contentCount, videoReadyCount, doneCount, recentProjects, runningBatches] =
    await Promise.all([
      db.project.count(),
      db.project.count({ where: { status: ProjectStatus.CONTENT_GENERATED } }),
      db.project.count({ where: { status: ProjectStatus.VIDEO_READY } }),
      db.project.count({ where: { status: ProjectStatus.DONE } }),
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

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-600/20 via-teal-600/10 to-teal-600/10" />
        <div className="absolute inset-0 bg-[#0c0c14]/40" />
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-teal-500/15 blur-[80px]" />
        <div className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full bg-teal-500/10 blur-[60px]" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-teal-500/15 border border-teal-400/25 px-3 py-1 text-[11px] text-teal-300 font-medium mb-4">
              <Sparkles className="h-3 w-3" />
              创作工作台
            </div>
            <h1 className="text-[26px] font-bold tracking-tight text-white leading-snug">
              用 AI 一键生成你的下一个<br className="hidden sm:inline" />爆款短视频
            </h1>
          </div>
          <div className="flex gap-2.5 shrink-0">
            <Link
              href="/batches/new"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-5 py-2.5 text-sm font-medium text-zinc-200 transition-all hover:bg-white/[0.1] hover:border-white/20"
            >
              <Zap className="h-3.5 w-3.5" />
              批量生成
            </Link>
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-teal-500/20 hover:brightness-110"
            >
              开始创作
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={Video} label="作品总数" value={totalProjects} color="text-teal-400" bg="bg-teal-500/10" borderColor="border-teal-500/15" />
        <Stat icon={FileText} label="内容已生成" value={contentCount} color="text-sky-400" bg="bg-sky-500/10" borderColor="border-sky-500/15" />
        <Stat icon={Video} label="视频就绪" value={videoReadyCount} color="text-amber-400" bg="bg-amber-500/10" borderColor="border-amber-500/15" />
        <Stat icon={CheckCircle2} label="已完成" value={doneCount} color="text-emerald-400" bg="bg-emerald-500/10" borderColor="border-emerald-500/15" />
      </div>

      {/* Running batches */}
      {runningBatches.length > 0 && (
        <div className="rounded-2xl bg-teal-500/[0.06] border border-teal-500/15 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-teal-400 font-medium">
              <Layers className="h-3.5 w-3.5" />
              执行中
            </div>
            <Link href="/batches" className="text-xs text-teal-400 hover:text-teal-300 font-medium">
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
                  <div className="flex items-center justify-between rounded-xl px-4 py-3 hover:bg-white/[0.04] transition-colors">
                    <span className="text-sm font-medium text-zinc-100">{b.name}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-28 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-teal-500 to-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-teal-400 font-mono font-medium w-8 text-right">{pct}%</span>
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
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm font-medium text-zinc-300">
              最近作品
            </p>
            <Link href="/projects" className="text-xs text-zinc-500 hover:text-teal-400 transition-colors">
              查看全部 →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-300 hover:bg-white/[0.05] hover:border-teal-500/20 hover:shadow-lg hover:shadow-teal-500/5">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-[15px] font-semibold text-zinc-100 truncate">
                      {p.keyword}
                    </h3>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="text-[13px] text-zinc-500 truncate mb-4 leading-relaxed">
                    {p.contentPlan?.caption || "尚未生成内容"}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-600">
                      {formatDate(p.updatedAt)}
                    </span>
                    <span className="text-xs text-teal-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                      打开 →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-20 rounded-2xl border border-dashed border-white/[0.08]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/15">
            <Video className="h-6 w-6 text-teal-400" />
          </div>
          <p className="text-zinc-400 text-sm mb-6">还没有作品，开始你的第一次创作</p>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-teal-600 px-6 py-2.5 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-teal-500/20 hover:brightness-110"
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
  color,
  bg,
  borderColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  color: string;
  bg: string;
  borderColor: string;
}) {
  return (
    <div className={`rounded-xl border ${borderColor} bg-white/[0.02] p-4 transition-all hover:bg-white/[0.04]`}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <span className="text-[11px] text-zinc-500 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums text-white tracking-tight">{value}</p>
    </div>
  );
}
