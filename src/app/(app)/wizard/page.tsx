import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireWizardPage } from "@/lib/api-auth";
import { readClientBrief } from "@/lib/services/client-project-service";

export default async function WizardIndexPage() {
  await requireWizardPage();
  const orders = await db.deliveryOrder.findMany({
    // 避免使用字面量 null（Prisma 6 已废弃且语义为 JSON null 字面量）
    where: { NOT: { clientBrief: { equals: Prisma.DbNull } } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: { selectedCreativeCard: { select: { title: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Client Wizard</h1>
          <p className="text-xs text-muted-foreground mt-1">
            北美本地商家半自动短视频工作流：目标 → 创意证据卡 → AI 脚本 → 分镜 → 上传素材 → Draft 渲染。
          </p>
        </div>
        <Link href="/wizard/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" /> 新建 Wizard 项目
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">已有 Wizard 项目（{orders.length}）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {orders.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有任何 Wizard 项目。点击右上角「新建 Wizard 项目」开始第一个。
            </p>
          ) : (
            orders.map((o) => {
              const brief = readClientBrief(o.clientBrief);
              return (
                <Link
                  key={o.id}
                  href={`/wizard/${o.id}`}
                  className="block rounded-md border border-white/10 bg-card/40 p-3 hover:border-white/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm font-medium">{o.title}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {brief
                          ? `${brief.industry} · ${brief.objective} · ${brief.videoLengthSec}s · ${brief.targetPlatforms.join(", ")}`
                          : "Brief 数据不完整"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {o.selectedCreativeCard?.title && (
                        <Badge className="bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-[10px]">
                          {o.selectedCreativeCard.title}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] border-white/20">
                        {o.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(o.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
