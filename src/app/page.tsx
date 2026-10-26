import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PilotLanding, type LandingSample } from "@/components/leads/pilot-landing";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { getServerLocale } from "@/i18n/server";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import {
  SHOWCASE_SAFE_SLUGS,
  verifiedTemplateSample,
  verifiedTemplateVideo,
} from "@/lib/video-generation/template-sample";
import { contactEmail } from "@/lib/config/contact";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = getGrowthCopy(await getServerLocale()).landing;
  return { title: copy.metaTitle, description: copy.metaDescription };
}

/**
 * 公开首页的样片：只取公开面零瑕疵名单，且必须仍在真机验收白名单里（verified* 返回 null 即撤下）。
 * 模板名从模板库取（1.5 秒超时）；取不到就用通用名——样片本身不依赖数据库。
 */
async function loadLandingSamples(english: boolean, fallbackName: string): Promise<LandingSample[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let names = new Map<string, string>();
  try {
    const templates = await Promise.race([
      listActiveStyleTemplates(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("landing samples timeout")), 1500);
      }),
    ]);
    names = new Map(templates.map((template) => [template.slug, english ? template.name : template.nameZh]));
  } catch {
    /// 名字只是标签，取不到不挡样片
  } finally {
    clearTimeout(timer);
  }
  return SHOWCASE_SAFE_SLUGS.flatMap((slug) => {
    const video = verifiedTemplateVideo(slug, `/template-previews/${slug}.mp4`);
    if (!video) return [];
    return [{
      slug,
      name: names.get(slug) ?? fallbackName,
      video,
      poster: verifiedTemplateSample(slug, `/template-previews/${slug}.jpg`) ?? undefined,
    }];
  });
}

/**
 * Routing matrix（1025 起）:
 *  - 未登录 → 公开首页：30 天试点结构 + 申请表（计划 6.1）
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
  const copy = getGrowthCopy(locale).landing;
  const samples = await loadLandingSamples(locale === "en-US", copy.sampleFallbackName);
  const fallbackEmail = contactEmail();
  return <PilotLanding locale={locale} samples={samples} fallbackEmail={fallbackEmail} />;
}
