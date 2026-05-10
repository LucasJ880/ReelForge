import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getClientProject } from "@/lib/services/client-project-service";

export default async function WizardOverviewPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const project = await getClientProject(orderId);
  if (!project || !project.brief) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">项目数据不完整</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>
            该项目缺少有效的 Client Brief，请回到 Wizard 首页重新创建一个项目。
          </p>
          <Link href="/wizard">
            <Button variant="outline">回到 Wizard 首页</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { brief } = project;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Step 1 · 项目目标已锁定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <KV k="商家" v={brief.businessName} />
          <KV k="行业" v={brief.industry} />
          <KV k="目标" v={brief.objective} />
          <KV k="平台" v={brief.targetPlatforms.join(", ")} />
          <KV k="时长" v={`${brief.videoLengthSec}s`} />
          <KV k="口吻" v={brief.brandTone} />
          {brief.keyMessage && <KV k="关键信息" v={brief.keyMessage} />}
          {brief.brandAssets.ctaText && (
            <KV k="CTA" v={brief.brandAssets.ctaText} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">下一步</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            目标已锁定，下一步从已发布的「创意证据卡」中挑一张作为本视频的结构灵感。
          </p>
          <Link href={`/wizard/${orderId}/step-2-card`}>
            <Button>
              前往 Step 2 · 选证据卡 <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground text-right">{v}</span>
    </div>
  );
}
