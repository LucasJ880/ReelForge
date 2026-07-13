import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { EditorialCreateWorkflow } from "@/components/personal/glass-create-workflow";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ mode?: string; from?: string }>;
};

/**
 * 创作页（对齐同行三步工作流）：
 * ① 选产品图 → ② 爆款参考视频（可选）→ ③ 模式+需求 → 生成脚本（可编辑）→ 确认出片。
 */
export default async function CreateVideoPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/personal/create-video");

  const sp = await searchParams;
  const initialMode = sp.mode === "director" ? "director" : "fast";

  return <EditorialCreateWorkflow initialMode={initialMode} />;
}
