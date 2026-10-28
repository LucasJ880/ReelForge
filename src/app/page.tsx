import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ShowroomLanding } from "@/components/landing/showroom-landing";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { getServerLocale } from "@/i18n/server";
import { contactEmail } from "@/lib/config/contact";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = getGrowthCopy(await getServerLocale()).landing;
  return { title: copy.metaTitle, description: copy.metaDescription };
}

/**
 * Routing matrix（1025 起）:
 *  - 未登录 → 公开首页「展厅」（2026-10-28 学 Seedance 2.5 官网）：主行动「免费试做 3 条」→ 注册 → /app/welcome；
 *    次行动「看样片」/「申请 30 天陪跑」→ 本页锚点
 *  - userType=BUSINESS → /business
 *  - userType=PERSONAL → /personal
 *  - userType=OPERATOR / SUPER_ADMIN → /internal/frame-qa（旧中台 2026-10-28 删除，只留帧质检）
 *  - userType=null（罕见，迁移后存量账号）→ /app
 */
export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (session) {
    const userType = session.user.userType;
    switch (userType) {
      case "BUSINESS":
        redirect("/business");
      case "PERSONAL":
        redirect("/personal");
      case "OPERATOR":
      case "SUPER_ADMIN":
        redirect("/internal/frame-qa");
      default:
        redirect("/app");
    }
  }

  const locale = await getServerLocale();
  return <ShowroomLanding locale={locale} fallbackEmail={contactEmail()} />;
}
