import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { BatchCreateWizard } from "@/components/batch/batch-create-wizard";

export default async function BatchCreatePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/batch-create");

  return (
    <main className="space-y-10">
      <header className="max-w-4xl space-y-4">
        <p className="text-meta font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Editorial Batch Studio
        </p>
        <h1 className="editorial-display">
          批量生成产品视频
        </h1>
        <p className="max-w-2xl text-body leading-7 text-muted-foreground">
          一次上传最多 50 张产品图，锁定一个风格模板，并发生产最多 200
          条视频。全程可监控，失败任务可保留原素材单独重试。
        </p>
      </header>
      <BatchCreateWizard />
    </main>
  );
}
