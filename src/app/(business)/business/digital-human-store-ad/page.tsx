import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { DigitalHumanWizard } from "@/components/digital-human/digital-human-wizard";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DigitalHumanStoreAdPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/digital-human-store-ad");

  const enabled = process.env.ENABLE_DIGITAL_HUMAN_AD !== "false";

  return (
    <div className="space-y-8">
      <BusinessPageHeader
        kicker="AI 数字人 · 探店广告"
        title="数字人探店广告生成"
        subtitle="选一个虚拟数字人，配上自然的中文口播，上传你的门店实景图，几分钟生成一条竖版探店广告片。"
      />
      {enabled ? (
        <DigitalHumanWizard />
      ) : (
        <div className="rounded-xl border border-white/10 bg-card/60 p-8 text-sm text-muted-foreground">
          该功能正在灰度中，暂未对你的账号开放。
        </div>
      )}
    </div>
  );
}
