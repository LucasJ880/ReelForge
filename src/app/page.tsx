import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PilotLanding, type LandingCounts } from "@/components/leads/pilot-landing";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { getServerLocale } from "@/i18n/server";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import { hasVerifiedTemplateVideo } from "@/lib/video-generation/template-sample";
import { contactEmail } from "@/lib/config/contact";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = getGrowthCopy(await getServerLocale()).landing;
  return { title: copy.metaTitle, description: copy.metaDescription };
}

/**
 * 公开首页行情条上的模板库计数：只读公开的模板库（1.5 秒超时）。
 * 取不到就是 null——含计数的事实整条不显示，不写示例数字。
 */
async function loadLandingCounts(): Promise<LandingCounts | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const templates = await Promise.race([
      listActiveStyleTemplates(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("landing counts timeout")), 1500);
      }),
    ]);
    return {
      templates: templates.length,
      samples: templates.filter((template) => hasVerifiedTemplateVideo(template.slug)).length,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Routing matrix（1025 起）:
 *  - 未登录 → 公开首页：主行动「免费试做 3 条」→ 注册 → /app/welcome；次行动「申请 30 天陪跑」→ 本页申请表
 *  - userType=BUSINESS → /business
 *  - userType=PERSONAL → /personal
 *  - userType=OPERATOR / SUPER_ADMIN → /internal/orders
 *  - userType=null（罕见，迁移后存量账号）→ /persona
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
        redirect("/internal/orders");
      default:
        redirect("/persona");
    }
  }

  const locale = await getServerLocale();
  const counts = await loadLandingCounts();
  const fallbackEmail = contactEmail();
  return <PilotLanding locale={locale} counts={counts} fallbackEmail={fallbackEmail} />;
}
