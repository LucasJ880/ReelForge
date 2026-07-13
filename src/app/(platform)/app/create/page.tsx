import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";
import { authOptions } from "@/lib/auth";
import { findProductImageJobForUser } from "@/lib/services/product-image-service";
import type { UploadedAsset } from "@/types/video-generation";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export default async function PlatformCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ productImageJobId?: string; styleTemplate?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create");
  const [{ productImageJobId, styleTemplate }, locale] = await Promise.all([searchParams, getServerLocale()]);
  const copy = getPlatformCopy(locale).create;
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
  return (
    <div className="editorial-page-stack">
      <header className="studio-hero max-w-5xl space-y-4">
        <p className="studio-label text-muted-foreground">{copy.kicker}</p>
        <h1 className="editorial-display">{copy.title}</h1>
        <p className="max-w-2xl text-body text-muted-foreground">{copy.subtitle}</p>
        <CreateModeTabs active="video" />
      </header>
      <UnifiedCreativeInputShell userType="platform" initialAssets={initialAssets} initialStyleTemplateId={styleTemplate} />
    </div>
  );
}

function absoluteAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return new URL(url, base).toString();
}
