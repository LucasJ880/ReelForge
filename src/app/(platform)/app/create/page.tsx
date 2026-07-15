import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { StreamlinedVideoStudio } from "@/components/video-generation/streamlined-video-studio";
import { authOptions } from "@/lib/auth";
import { findProductImageJobForUser } from "@/lib/services/product-image-service";
import type { UploadedAsset } from "@/types/video-generation";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";
import { isInternalRole } from "@/lib/auth-role-policy";

export default async function PlatformCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ productImageJobId?: string; styleTemplate?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create");
  const [{ productImageJobId, styleTemplate }, locale, routeState] = await Promise.all([
    searchParams,
    getServerLocale(),
    getCustomerRouteRehearsalState("create"),
  ]);
  const showInternalVideoRoutes = isInternalRole(session.user.role);
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
    <div data-route-state={routeState === "empty" ? "empty" : "ready"}>
      <StreamlinedVideoStudio
        initialAssets={initialAssets}
        initialStyleTemplateId={styleTemplate}
        canSelectVideoRoute
        showInternalVideoRoutes={showInternalVideoRoutes}
      />
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
