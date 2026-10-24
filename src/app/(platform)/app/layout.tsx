import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/platform/platform-shell";
import type { TapeEntry } from "@/components/exchange/exchange-tape";
import { authOptions } from "@/lib/auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { db } from "@/lib/db";
import { getWorkspacePlanForUser } from "@/lib/services/workspace-plan-service";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app");
  const [workspace, entitlement, activeBatches, failedJobs, recentBatches] = await Promise.all([
    db.workspace.findUnique({ where: { ownerId: session.user.id } }),
    getWorkspacePlanForUser(session.user.id),
    db.batchJob.count({
      where: {
        userId: session.user.id,
        status: { in: ["EXPANDING", "RUNNING", "PAUSED"] },
      },
    }),
    db.videoJob.count({
      where: {
        status: "FAILED",
        batchJob: { userId: session.user.id },
      },
    }),
    // 成交带：本工作区最近 12 笔批次的真实状态（不放示例数据）。
    db.batchJob.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        productName: true,
        status: true,
        requestedCount: true,
        completedCount: true,
        failedCount: true,
        updatedAt: true,
        template: { select: { nameZh: true, name: true } },
      },
    }),
  ]);
  if (!workspace) throw new Error("默认 Workspace 不存在");
  const tape: TapeEntry[] = recentBatches.map((batch) => ({
    id: batch.id,
    name: batch.productName ?? batch.template.nameZh ?? batch.template.name,
    status: batch.status,
    done: batch.completedCount,
    total: batch.requestedCount,
    failed: batch.failedCount,
    at: batch.updatedAt.toISOString(),
  }));
  return (
    <PlatformShell
      email={session.user.email ?? ""}
      workspaceName={workspace.name}
      planId={entitlement.planId}
      monthlyVideoLimit={entitlement.monthlyVideoLimit}
      activeBatches={activeBatches}
      failedJobs={failedJobs}
      tape={tape}
      showOpsCredits={isInternalRole(session.user.role)}
    >
      {children}
    </PlatformShell>
  );
}
