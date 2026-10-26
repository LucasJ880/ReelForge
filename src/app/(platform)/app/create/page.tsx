import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import {
  StreamlinedVideoStudio,
  type StudioReadings,
} from "@/components/video-generation/streamlined-video-studio";
import { isBrollRouteAvailable } from "@/lib/services/broll-assembly-service";
import { getCapabilities } from "@/lib/services/capability-status-service";
import { authOptions } from "@/lib/auth";
import { loadCreateRetryPrefill } from "@/lib/services/create-retry-prefill-service";
import { loadExchangeReadings, loadProductionCounts, loadVideoQuota } from "@/lib/services/exchange-readings";
import { findProductImageResultForUser } from "@/lib/services/product-image-service";
import type { UploadedAsset } from "@/types/video-generation";
import { getServerLocale } from "@/i18n/server";
import { getCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";

/// 空态演练：等同一个全新账号，成片读数全为零（零就写零）；额度仍取真实计量。
const EMPTY_ACTIVITY: Pick<StudioReadings, "generating" | "filled24h" | "successRate7d"> = {
  generating: 0,
  filled24h: 0,
  successRate7d: null,
};

export default async function PlatformCreatePage({
  searchParams,
}: {
  searchParams: Promise<{
    productImageResultId?: string;
    styleTemplate?: string;
    prompt?: string;
    guide?: string;
    retry?: string;
  }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create");
  const [{ productImageResultId, styleTemplate, prompt, guide, retry }, locale, routeState] = await Promise.all([
    searchParams,
    getServerLocale(),
    getCustomerRouteRehearsalState("create"),
  ]);
  const [brandPackages, readings, capabilities] = await Promise.all([
    listWorkspaceBrandPackagesForUser(session.user.id),
    loadCreateReadings(session.user.id, routeState === "empty"),
    /// C4：能力状态（纯 DTO）交给客户端——实拍线路、口播稿起草与画面质检说明据此诚实显示。永不抛出。
    getCapabilities(),
  ]);
  const result = productImageResultId
    ? await findProductImageResultForUser(productImageResultId, session.user.id)
    : null;
  /// 成品库「重新生成」：按属主读回原订单的产品照片与创作方向（别人的订单当作不存在）。
  const retryPrefill = typeof retry === "string" && retry && !result
    ? await loadCreateRetryPrefill(retry, session.user.id)
    : null;
  const retryAssets: UploadedAsset[] = (retryPrefill?.productAssets ?? []).map((asset, index) => ({
    id: asset.id,
    assetId: asset.id,
    type: "IMAGE",
    inferredRole: "product_image",
    roleConfidence: 1,
    url: absoluteAssetUrl(asset.url),
    mimeType: asset.mimeType,
    fileName: `product-image-${index + 1}`,
    width: asset.width,
    height: asset.height,
    durationSeconds: null,
    userAssignedRole: "product_image",
    suggestedUse: locale === "en-US" ? "Loaded from the video you are regenerating." : "已从要重新生成的那条视频载入。",
    warnings: [],
  }));
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
      : retryAssets;
  return (
    <div data-route-state={routeState === "empty" ? "empty" : "ready"}>
      <StreamlinedVideoStudio
        initialAssets={initialAssets}
        initialStyleTemplateId={styleTemplate}
        initialPrompt={(retryPrefill?.prompt || prompt)?.slice(0, 4000) ?? ""}
        initialDurationSec={retryPrefill?.durationSec ?? undefined}
        initialAspectRatio={retryPrefill?.aspectRatio ?? undefined}
        retryOfOrderId={retryPrefill?.orderId ?? null}
        brandPackages={brandPackages}
        canSelectVideoRoute={false}
        showInternalVideoRoutes={false}
        forceOnboarding={guide === "open"}
        brollAvailable={isBrollRouteAvailable()}
        capabilities={capabilities}
        readings={readings}
      />
    </div>
  );
}

/**
 * 行情头读数：与壳层、大屏同一口径（exchange-readings 的 DB 计数，只数本人数据、不含样片）；
 * 额度格读本月真实用量（UserUsagePeriod）对生效上限——试用账号是 3 条，不是套餐表里的 30。
 * 只把纯数字交给客户端组件（client bundle 铁律）。读失败不吞成空数据（RF-012）：交给本路由的 error.tsx。
 */
async function loadCreateReadings(userId: string, rehearseEmpty: boolean): Promise<StudioReadings> {
  const [activity, production, quota] = await Promise.all([
    rehearseEmpty ? Promise.resolve(EMPTY_ACTIVITY) : loadExchangeReadings(userId),
    rehearseEmpty ? Promise.resolve({ generating: 0 }) : loadProductionCounts(userId),
    loadVideoQuota(userId),
  ]);
  return {
    generating: production.generating,
    filled24h: activity.filled24h,
    quotaUsed: quota.used,
    quotaLimit: quota.limit,
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
