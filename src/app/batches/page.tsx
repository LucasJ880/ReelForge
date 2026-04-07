import Link from "next/link";
import { Plus, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDING: { label: "等待中", color: "bg-gray-100 text-gray-700" },
  RUNNING: { label: "执行中", color: "bg-blue-100 text-blue-700" },
  PAUSED: { label: "已暂停", color: "bg-yellow-100 text-yellow-700" },
  COMPLETED: { label: "已完成", color: "bg-green-100 text-green-700" },
  FAILED: { label: "失败", color: "bg-red-100 text-red-700" },
};

export default async function BatchListPage() {
  const batches = await db.batch.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { projects: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">批量任务</h2>
          <p className="text-gray-500 mt-1">管理批量视频生成任务</p>
        </div>
        <Link href="/batches/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新建批次
          </Button>
        </Link>
      </div>

      {batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Layers className="h-12 w-12 mb-4 text-gray-300" />
            <p className="text-lg font-medium">暂无批量任务</p>
            <p className="text-sm mt-1">创建批次，一次生成多个视频</p>
            <Link href="/batches/new" className="mt-4">
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                创建第一个批次
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => {
            const s = statusConfig[batch.status] || statusConfig.PENDING;
            const progress =
              batch.totalCount > 0
                ? Math.round(
                    ((batch.completedCount + batch.failedCount) /
                      batch.totalCount) *
                      100
                  )
                : 0;

            return (
              <Link key={batch.id} href={`/batches/${batch.id}`}>
                <Card className="hover:bg-gray-50 transition-colors cursor-pointer">
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {batch.name}
                        </p>
                        <Badge className={s.color}>{s.label}</Badge>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {batch._count.projects} 个项目 · 
                        {batch.completedCount} 完成
                        {batch.failedCount > 0 &&
                          ` · ${batch.failedCount} 失败`}
                        {" · "}
                        {formatDate(batch.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">
                        {progress}%
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
