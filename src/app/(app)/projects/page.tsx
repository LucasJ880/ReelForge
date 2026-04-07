import Link from "next/link";
import { ArrowRight, FolderPlus } from "lucide-react";
import { StatusBadge } from "@/components/project/status-badge";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export default async function ProjectsPage() {
  const projects = await db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      contentPlan: { select: { caption: true } },
      videoJob: { select: { status: true, videoUrl: true } },
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-1">
            作品库
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            全部项目
          </h1>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          新建
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-zinc-300 text-sm mb-6">还没有作品</p>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            开始创作
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div className="group rounded-xl border border-white/5 bg-zinc-900/50 p-4 transition-all hover:border-zinc-800 hover:shadow-none">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-sm font-medium text-white truncate">
                    {p.keyword}
                  </h3>
                  <StatusBadge status={p.status} />
                </div>
                <p className="text-xs text-zinc-400 truncate mb-4">
                  {p.contentPlan?.caption || "尚未生成内容"}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-300">
                    {formatDate(p.createdAt)}
                  </span>
                  <span className="text-xs text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity">
                    查看 →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
