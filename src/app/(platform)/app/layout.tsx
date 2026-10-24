import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/platform/platform-shell";
import { authOptions } from "@/lib/auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { db } from "@/lib/db";
import { loadPulse } from "@/lib/services/exchange-readings";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * 工作区壳层：首屏脉搏在服务端读（loadPulse，与 GET /api/exchange/pulse 同一个函数），
 * 之后由壳层客户端小岛每 30 秒自刷新——layout 在客户端换页时不重渲染，不能只靠这里。
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app");
  const userId = session.user.id;
  const locale = await getServerLocale();
  const [workspace, pulse] = await Promise.all([
    db.workspace.findUnique({ where: { ownerId: userId }, select: { name: true } }),
    loadPulse(userId, { locale }),
  ]);
  if (!workspace) throw new Error("默认 Workspace 不存在");
  return (
    <PlatformShell
      email={session.user.email ?? ""}
      workspaceName={workspace.name}
      initialPulse={pulse}
      showOpsCredits={isInternalRole(session.user.role)}
    >
      {children}
    </PlatformShell>
  );
}
