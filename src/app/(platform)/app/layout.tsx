import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/platform/platform-shell";
import { authOptions } from "@/lib/auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { db } from "@/lib/db";
import { loadPulse } from "@/lib/services/exchange-readings";
import { getCapabilities } from "@/lib/services/capability-status-service";
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
  const [workspace, pulse, capabilities] = await Promise.all([
    /// 2026-10-28 /persona 选择页删除后，无身份类型、没有工作区的存量账号会直接进 /app：
    /// 补建一个入门版默认工作区（与注册时同一形状），不再 500。
    db.workspace.upsert({
      where: { ownerId: userId },
      update: {},
      create: {
        ownerId: userId,
        name: session.user.email?.split("@")[0] || "Aivora",
        planId: "starter",
        isDefault: true,
      },
      select: { name: true },
    }),
    loadPulse(userId, { locale }),
    /// C4：能力状态（进程内缓存 60 秒，永不抛出）——状态栏据此亮「部分 AI 能力暂停」。
    getCapabilities(),
  ]);
  return (
    <PlatformShell
      email={session.user.email ?? ""}
      workspaceName={workspace.name}
      initialPulse={pulse}
      initialCapabilities={capabilities}
      showOpsCredits={isInternalRole(session.user.role)}
    >
      {children}
    </PlatformShell>
  );
}
