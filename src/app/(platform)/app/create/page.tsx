import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import {
  StreamlinedVideoStudio,
  type StudioReadings,
} from "@/components/video-generation/streamlined-video-studio";
import { isBrollRouteAvailable } from "@/lib/services/broll-assembly-service";
import { authOptions } from "@/lib/auth";
import { loadExchangeReadings } from "@/lib/services/exchange-readings";
import { findProductImageResultForUser } from "@/lib/services/product-image-service";
import { getWorkspacePlanForUser } from "@/lib/services/workspace-plan-service";
import type { UploadedAsset } from "@/types/video-generation";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";

/// 空态演练：等同一个全新账号，成片读数全为零（零就写零）；额度仍取真实套餐。
const EMPTY_ACTIVITY: Omit<StudioReadings, "monthlyLimit"> = {
  inFlight: 0,
  filled24h: 0,
  filled30d: 0,
  successRate7d: null,
};

export default async function PlatformCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ productImageResultId?: string; styleTemplate?: string; prompt?: string; guide?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create");
  const [{ productImageResultId, styleTemplate, prompt, guide }, locale, routeState] = await Promise.all([
    searchParams,
    getServerLocale(),
    getCustomerRouteRehearsalState("create"),
  ]);
  const [brandPackages, readings] = await Promise.all([
    listWorkspaceBrandPackagesForUser(session.user.id),
    loadCreateReadings(session.user.id, routeState === "empty"),
  ]);
  const result = productImageResultId
    ? await findProductImageResultForUser(productImageResultId, session.user.id)
    : null;
  const initialAssets: UploadedAsset[] =
    result
      ? [{
          id: result.assetId,
          assetId: result.assetId,
          type: "IMAGE",
          inferredRole: "product_image",
          roleConfidence: 1,
          url: absoluteAssetUrl(result.asset.url),
          mimeType: result.asset.mimeType,
          fileName: `Aivora-product-image-${result.id.slice(-6)}.png`,
          width: result.asset.width,
          height: result.asset.height,
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
        initialPrompt={prompt?.slice(0, 4000) ?? ""}
        brandPackages={brandPackages}
        canSelectVideoRoute={false}
        showInternalVideoRoutes={false}
        forceOnboarding={guide === "open"}
        brollAvailable={isBrollRouteAvailable()}
        readings={readings}
      />
    </div>
  );
}

/**
 * 行情头读数：与大屏同一口径（loadExchangeReadings，只数本人数据、不含样片），
 * 月额度取当前套餐（app layout 已保证默认 Workspace 存在）。只把纯数字交给客户端组件。
 * 读失败不吞成空数据（RF-012）：交给本路由的 error.tsx。
 */
async function loadCreateReadings(userId: string, rehearseEmpty: boolean): Promise<StudioReadings> {
  const [activity, entitlement] = await Promise.all([
    rehearseEmpty ? Promise.resolve(EMPTY_ACTIVITY) : loadExchangeReadings(userId, { mediaLimit: 0 }),
    getWorkspacePlanForUser(userId),
  ]);
  return {
    inFlight: activity.inFlight,
    filled24h: activity.filled24h,
    filled30d: activity.filled30d,
    monthlyLimit: entitlement.monthlyVideoLimit,
    successRate7d: activity.successRate7d,
  };
}

function absoluteAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return new URL(url, base).toString();
}
