import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import {
  AgentCreativeStudio,
  type AgentTemplateRecommendation,
  type QualityTemplateSkill,
} from "@/components/video-generation/agent-creative-studio";
import { authOptions } from "@/lib/auth";
import { findProductImageJobForUser } from "@/lib/services/product-image-service";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import type { UploadedAsset } from "@/types/video-generation";
import { getServerLocale } from "@/i18n/server";

export default async function PlatformCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ productImageJobId?: string; styleTemplate?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create");
  const [{ productImageJobId, styleTemplate }, locale, templates] = await Promise.all([
    searchParams,
    getServerLocale(),
    listActiveStyleTemplates().catch(() => []),
  ]);
  const job = productImageJobId
    ? await findProductImageJobForUser(productImageJobId, session.user.id)
    : null;
  const initialAssets: UploadedAsset[] =
    job?.status === "SUCCEEDED" && job.outputImageUrl
      ? [{
          id: `product_image_${job.id}`,
          type: "IMAGE",
          inferredRole: "product_image",
          roleConfidence: 1,
          url: absoluteAssetUrl(job.outputImageUrl),
          mimeType: "image/png",
          fileName: `Aivora-product-image-${job.id.slice(-6)}.png`,
          width: null,
          height: null,
          durationSeconds: null,
          userAssignedRole: "product_image",
          suggestedUse: locale === "en-US" ? "Loaded from Product Image Studio as a product-consistency reference." : "已从产品图工作台载入，可作为视频的产品一致性参考。",
          warnings: [],
        }]
      : [];
  const recommendations = buildAgentRecommendations(templates);
  return (
    <AgentCreativeStudio
      initialAssets={initialAssets}
      initialStyleTemplateId={styleTemplate}
      recommendations={recommendations}
    />
  );
}

function buildAgentRecommendations(
  templates: Awaited<ReturnType<typeof listActiveStyleTemplates>>,
): AgentTemplateRecommendation[] {
  const specs: Array<{
    skillId: QualityTemplateSkill;
    slug: string;
    fallback: Omit<AgentTemplateRecommendation, "skillId" | "batchTemplateId">;
  }> = [
    {
      skillId: "tpl_event_watch_party",
      slug: "lifestyle-use-demo",
      fallback: { name: "Watch Party Story", nameZh: "赛事观看稳定叙事", coverImage: "/template-previews/lifestyle-use-demo.jpg" },
    },
    {
      skillId: "tpl_viral_result_first",
      slug: "fast-commerce-beats",
      fallback: { name: "Result-First Hook", nameZh: "成果前置强钩子", coverImage: "/template-previews/fast-commerce-beats.jpg" },
    },
    {
      skillId: "tpl_viral_pain_solution",
      slug: "before-after-reversal",
      fallback: { name: "Pain to Proof", nameZh: "痛点到证明", coverImage: "/template-previews/before-after-reversal.jpg" },
    },
    {
      skillId: "tpl_ugc_review",
      slug: "ugc-handheld-review",
      fallback: { name: "Grounded UGC Review", nameZh: "真实 UGC 手持测评", coverImage: "/template-previews/ugc-handheld-review.jpg" },
    },
    {
      skillId: "tpl_viral_sensory_texture",
      slug: "macro-material-study",
      fallback: { name: "Material and Light", nameZh: "材质与光影特写", coverImage: "/template-previews/macro-material-study.jpg" },
    },
  ];
  return specs.map((spec) => {
    const template = templates.find((candidate) => candidate.slug === spec.slug);
    return {
      skillId: spec.skillId,
      batchTemplateId: template?.id ?? null,
      name: template?.name ?? spec.fallback.name,
      nameZh: template?.nameZh ?? spec.fallback.nameZh,
      coverImage: template?.coverImage ?? spec.fallback.coverImage,
    };
  });
}

function absoluteAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return new URL(url, base).toString();
}
