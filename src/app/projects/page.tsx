import Link from "next/link";
import { FolderPlus, Inbox, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/project/status-badge";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export default async function ProjectsPage() {
  const projects = await db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      contentPlan: { select: { caption: true } },
    },
  });

  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">项目列表</h2>
          <Link href="/projects/new">
            <Button>
              <FolderPlus className="mr-2 h-4 w-4" />
              新建项目
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Inbox className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              还没有项目
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              创建你的第一个 TikTok 短视频项目
            </p>
            <Link href="/projects/new">
              <Button>
                <FolderPlus className="mr-2 h-4 w-4" />
                新建项目
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">项目列表</h2>
        <Link href="/projects/new">
          <Button>
            <FolderPlus className="mr-2 h-4 w-4" />
            新建项目
          </Button>
        </Link>
      </div>

      <div className="space-y-3">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`}>
            <Card className="hover:bg-gray-50 transition-colors cursor-pointer">
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.keyword}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {p.contentPlan?.caption || "尚未生成内容"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={p.status} />
                  <span className="text-xs text-gray-400 hidden sm:inline">
                    {formatDate(p.createdAt)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
