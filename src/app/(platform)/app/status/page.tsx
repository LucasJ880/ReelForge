import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { CapabilityBoard } from "@/components/capabilities/capability-board";
import { getServerLocale } from "@/i18n/server";
import { authOptions } from "@/lib/auth";
import { withoutRetiredCapabilities } from "@/lib/capabilities/registry";
import { getCapabilities } from "@/lib/services/capability-status-service";

export const dynamic = "force-dynamic";

/**
 * C4 · 能力状态：哪些 AI 能力在工作、哪些暂停、暂停时系统改用什么。
 * 壳层状态栏的「部分 AI 能力暂停」与各页的暂停提示都指向这里。
 * 服务端取数（getCapabilities 永不抛出），纯 DTO 交给展示组件。
 */
export default async function CapabilityStatusPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/status");
  const [locale, allCapabilities] = await Promise.all([getServerLocale(), getCapabilities()]);
  /// 已下线的线路不列给商家看（线路精简 2026-11-09）
  const capabilities = withoutRetiredCapabilities(allCapabilities);
  return <CapabilityBoard capabilities={capabilities} locale={locale} />;
}
