import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/platform/platform-shell";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspacePlanForUser } from "@/lib/services/workspace-plan-service";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app");
  const [workspace, entitlement, activeBatches, failedJobs] = await Promise.all([
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
  ]);
  if (!workspace) throw new Error("默认 Workspace 不存在");
  return (
    <PlatformShell
      email={session.user.email ?? ""}
      workspaceName={workspace.name}
      planId={entitlement.planId}
      activeBatches={activeBatches}
      failedJobs={failedJobs}
    >
      {children}
    </PlatformShell>
  );
}
