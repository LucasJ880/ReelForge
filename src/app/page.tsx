import Link from "next/link";
import {
  FolderPlus,
  TrendingUp,
  Video,
  BarChart3,
  ChevronRight,
  Layers,
  Zap,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
        take: 5,
        include: { contentPlan: { select: { caption: true } } },
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">欢迎使用 ReelForge</h2>
          <p className="text-gray-500 mt-1">
            AI 驱动的 TikTok 短视频自动化平台
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/batches/new">
            <Button variant="outline">
              <Zap className="mr-2 h-4 w-4" />
              批量生成
            </Button>
          </Link>
          <Link href="/projects/new">
            <Button>
              <FolderPlus className="mr-2 h-4 w-4" />
              新建项目
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              总项目数
            </CardTitle>
            <Video className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProjects}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              已发布
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{publishedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              总播放量
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalViews.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              分析完成
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analyzedCount}</div>
          </CardContent>
        </Card>
      </div>

      {runningBatches.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-700 flex items-center gap-2">
              <Layers className="h-4 w-4" />
              正在执行的批次
            </CardTitle>
            <Link href="/batches" className="text-xs text-blue-600 hover:underline">
              查看全部
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {runningBatches.map((b) => {
              const progress = b.totalCount > 0
                ? Math.round(((b.completedCount + b.failedCount) / b.totalCount) * 100)
                : 0;
              return (
                <Link key={b.id} href={`/batches/${b.id}`}>
                  <div className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-blue-100/50 transition-colors">
                    <span className="text-sm font-medium text-blue-900">{b.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-blue-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 rounded-full" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-xs text-blue-600">{progress}%</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {recentProjects.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>最近项目</CardTitle>
            <Link
              href="/projects"
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              查看全部
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-gray-50 transition-colors -mx-1">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {p.keyword}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {p.contentPlan?.caption || "尚未生成内容"} ·{" "}
                        {formatDate(p.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={p.status} />
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>快速开始</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm text-gray-600">
              {[
                { n: 1, title: "输入关键词", desc: "输入中文关键词或产品方向，AI 自动生成内容方案" },
                { n: 2, title: "生成视频", desc: "确认内容后，AI 自动生成短视频" },
                { n: 3, title: "一键发布", desc: "预览确认后，直接发布到 TikTok" },
                { n: 4, title: "数据分析", desc: "发布后自动追踪数据，AI 给出优化建议" },
              ].map((s) => (
                <div key={s.n} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-white text-xs font-bold">
                    {s.n}
                  </span>
                  <div>
                    <p className="font-medium text-gray-900">{s.title}</p>
                    <p>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
