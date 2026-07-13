import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { BatchCreateWizard } from "@/components/batch/batch-create-wizard";

export default async function BatchCreatePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/batch-create");

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-violet-300">
          Batch Studio
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
          批量生成产品视频
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
          一次上传最多 50 张产品图，锁定一个风格模板，并发生产最多 200
          条视频。全程可监控，失败任务可保留原素材单独重试。
        </p>
      </header>
      <BatchCreateWizard />
    </div>
  );
}
