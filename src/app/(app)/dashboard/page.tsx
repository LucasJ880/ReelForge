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
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-8">
        <div className="ambient-glow pointer-events-none absolute inset-0" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              创作工作台
            </div>
            <h1 className="text-[26px] font-bold tracking-tight text-foreground leading-snug">
              用 AI 一键生成你的下一个<br className="hidden sm:inline" />爆款短视频
            </h1>
          </div>
          <div className="flex gap-2.5 shrink-0">
            <Link
              href="/batches/new"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Zap className="h-3.5 w-3.5" />
              批量生成
            </Link>
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              开始创作
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={Video} label="作品总数" value={totalProjects} accent="primary" />
        <Stat icon={FileText} label="内容已生成" value={contentCount} accent="info" />
        <Stat icon={Video} label="视频就绪" value={videoReadyCount} accent="warn" />
        <Stat icon={CheckCircle2} label="已完成" value={doneCount} accent="success" />
      </div>

      {/* Running batches */}
      {runningBatches.length > 0 && (
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.15em] text-primary">
              <Layers className="h-3.5 w-3.5" />
              执行中
            </div>
            <Link href="/batches" className="text-xs font-medium text-primary hover:opacity-80">
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
                  <div className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-accent/40">
                    <span className="text-sm font-medium text-foreground">{b.name}</span>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right font-mono text-xs font-medium text-primary">{pct}%</span>
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
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground/90">最近作品</p>
            <Link href="/projects" className="text-xs text-muted-foreground transition-colors hover:text-primary">
              查看全部 →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div className="group relative rounded-2xl border border-border bg-card p-5 transition-all duration-200 hover:border-primary/30 hover:bg-accent/60">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-foreground">
                      {p.keyword}
                    </h3>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="mb-4 truncate text-[13px] leading-relaxed text-muted-foreground">
                    {p.contentPlan?.caption || "尚未生成内容"}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/70">
                      {formatDate(p.updatedAt)}
                    </span>
                    <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      打开 →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
            <Video className="h-6 w-6 text-primary" />
          </div>
          <p className="mb-6 text-sm text-muted-foreground">还没有作品，开始你的第一次创作</p>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            开始创作
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

const ACCENT_CLASSES: Record<
  "primary" | "info" | "warn" | "success",
  { text: string; bg: string; border: string }
> = {
  primary: { text: "text-primary", bg: "bg-primary/10", border: "border-primary/25" },
  info: { text: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20" },
  warn: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  success: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
};

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  accent: "primary" | "info" | "warn" | "success";
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <div className={`rounded-xl border ${a.border} bg-card p-4 transition-colors hover:bg-accent/60`}>
      <div className="mb-2 flex items-center gap-2.5">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${a.bg}`}>
          <Icon className={`h-3.5 w-3.5 ${a.text}`} />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}
