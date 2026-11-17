import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import {
  StreamlinedVideoStudio,
  type StudioReadings,
} from "@/components/video-generation/streamlined-video-studio";
import { getCapabilities } from "@/lib/services/capability-status-service";
import { authOptions } from "@/lib/auth";
import { contactEmail } from "@/lib/config/contact";
import { loadCreateRetryPrefill } from "@/lib/services/create-retry-prefill-service";
import { productProfilePrompt } from "@/lib/contracts/product-profile";
import { loadCreateShortcutsOrNone, loadProductProfilePrefill } from "@/lib/services/product-profile-service";
import { stripProductSize } from "@/lib/create/product-size";
import { applyHookAngle, HOOK_ANGLES, stripHookAngle } from "@/lib/create/hook-angles";
import { resolveOwnedImageAssets } from "@/lib/services/media-asset-service";
import { readMachineVideoTaskPrefill } from "@/lib/services/machine-video-task-service";
import { countFinished, loadExchangeReadings, loadProductionCounts, loadVideoQuota } from "@/lib/services/exchange-readings";
import type { UploadedAsset } from "@/types/video-generation";
import { getServerLocale } from "@/i18n/server";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";
import { workspaceNavTitle } from "@/components/exchange/workspace-page";

/** 浏览器标签页的标题：跟导航名走（之前每一页都是同一句英文站名，开几个标签分不清） */
export async function generateMetadata() {
  return { title: `${workspaceNavTitle("create", await getServerLocale())} · Aivora` };
}

export default async function PlatformCreatePage({
  searchParams,
}: {
  searchParams: Promise<{
    styleTemplate?: string;
    prompt?: string;
    guide?: string;
    retry?: string;
    /// 换个开头再做一条（成片详情页带过来）：只和 retry 一起生效
    hook?: string;
    machineTask?: string;
    /// 拍这件存好的商品（商品页 / 创作页「接着拍」带过来）：带入它的商品图、名字、卖点和尺寸
    product?: string;
    /// 成品库顶部「回创作页继续」带过来：明确要接着处理上一轮故事板（失败的那一轮也直接带回来）
    resume?: string;
  }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create");
  const [{ styleTemplate, prompt, guide, retry, hook, machineTask, product, resume }, locale] = await Promise.all([
    searchParams,
    getServerLocale(),
  ]);
  const [brandPackages, readings, capabilities, finishedCount] = await Promise.all([
    listWorkspaceBrandPackagesForUser(session.user.id),
    loadCreateReadings(session.user.id),
    /// C4：能力状态（纯 DTO）交给客户端——口播稿起草与镜头规划的说明据此诚实显示。永不抛出。
    getCapabilities(),
    /// 出过成片的账号不再被当成新人弹首启引导（只看本地记号时，换台电脑就又弹一次）
    countFinished(session.user.id).catch(() => 0),
  ]);
  /// 成品库「重新生成」：按属主读回原订单的产品照片与创作方向（别人的订单当作不存在）。
  const retryPrefill = typeof retry === "string" && retry
    ? await loadCreateRetryPrefill(retry, session.user.id)
    : null;
  /// 商品档案：按属主读（别人的、归档的当作不存在）。和「重新生成」同时带时以重新生成为准。
  const productPrefill = typeof product === "string" && product && !retryPrefill
    ? await loadProductProfilePrefill(session.user.id, product)
    : null;
  const machinePrefill = typeof machineTask === "string" && machineTask && !retryPrefill && !productPrefill
    ? await readMachineVideoTaskPrefill(session.user.id, machineTask)
    : null;
  const machineAssets = machinePrefill?.assetIds.length
    ? await loadMachineTaskAssets(session.user.id, machinePrefill.assetIds, locale)
    : [];
  const hookAngle = HOOK_ANGLES.find((angle) => angle.id === hook)?.id ?? null;
  /// 「接着拍这些商品」：只在空白创作页上用得着（带着预填进来的不查）；读不到由服务层记日志、当作没有，不拦创作
  /// 存好的商品在前，不够四格再用最近拍过、还没存的补上。
  const recentSources = retryPrefill || machinePrefill || productPrefill
    ? []
    : (await loadCreateShortcutsOrNone(session.user.id)).map((shortcut) => ({
        id: `${shortcut.kind}:${shortcut.id}`,
        href: shortcut.kind === "product"
          ? `/app/create?product=${encodeURIComponent(shortcut.id)}`
          : `/app/create?retry=${encodeURIComponent(shortcut.id)}`,
        /// 商品用它的名字；拍过的一单用当时描述的第一行（去掉我们补的「开头方向」和「尺寸」那两行）
        title: shortcut.kind === "product"
          ? shortcut.title
          : Array.from(stripProductSize(stripHookAngle(shortcut.title)).split("\n")[0] ?? "").slice(0, 40).join(""),
        thumbnailUrl: absoluteAssetUrl(shortcut.thumbnailUrl),
        imageCount: shortcut.imageCount,
      }));
  const productAssets: UploadedAsset[] = (productPrefill?.productAssets ?? []).map((asset, index) => ({
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
    suggestedUse: locale === "en-US" ? "Loaded from your saved product." : "已从你存的商品载入。",
    warnings: [],
  }));
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
    retryAssets.length > 0
      ? retryAssets
      : productAssets.length > 0
        ? productAssets
        : machineAssets;
  return (
    <div data-route-state="ready">
      <StreamlinedVideoStudio
        resumeRequested={resume === "1"}
        initialAssets={initialAssets}
        initialStyleTemplateId={styleTemplate}
        initialPrompt={
          retryPrefill?.prompt && hookAngle
            /// 带回的描述换上选好的开头方向（原来带着别的方向就替换掉）；超长时 applyHookAngle 原样返回
            ? applyHookAngle(retryPrefill.prompt.slice(0, 4000), hookAngle, locale === "en-US" ? "en" : "zh")
            : (
                retryPrefill?.prompt
                || (productPrefill ? productProfilePrompt(productPrefill, locale === "en-US" ? "en" : "zh") : "")
                || machinePrefill?.prompt
                || prompt
              )?.slice(0, 4000) ?? ""
        }
        initialDurationSec={supportedDuration(retryPrefill?.durationSec ?? machinePrefill?.durationSec)}
        initialAspectRatio={supportedAspect(retryPrefill?.aspectRatio ?? machinePrefill?.aspectRatio)}
        initialVoiceoverScript={machinePrefill?.voiceoverScript ?? ""}
        machineTaskId={
          machinePrefill && !machinePrefill.storyboardRunId && typeof machineTask === "string"
            ? machineTask
            : null
        }
        retryOfOrderId={retryPrefill?.orderId ?? null}
        loadedProductName={productAssets.length > 0 && retryAssets.length === 0 ? productPrefill?.name ?? null : null}
        recentSources={recentSources}
        brandPackages={brandPackages}
        forceOnboarding={guide === "open"}
        returningUser={finishedCount > 0}
        capabilities={capabilities}
        readings={readings}
        /// 额度用完时「联系我们」的邮箱：服务端取值、以 props 传下去（客户端不读环境变量；审计 A7）
        contactEmail={contactEmail()}
      />
    </div>
  );
}

/**
 * 行情头读数：与壳层、大屏同一口径（exchange-readings 的 DB 计数，只数本人数据、不含样片）；
 * 额度格读本月真实用量（UserUsagePeriod）对生效上限——试用账号是 3 条，不是套餐表里的 30。
 * 只把纯数字交给客户端组件（client bundle 铁律）。读失败不吞成空数据（RF-012）：交给本路由的 error.tsx。
 */
async function loadCreateReadings(userId: string): Promise<StudioReadings> {
  const [activity, production, quota] = await Promise.all([
    loadExchangeReadings(userId),
    loadProductionCounts(userId),
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

function supportedDuration(value: number | undefined): 15 | 30 | 60 | undefined {
  return value === 15 || value === 30 || value === 60 ? value : undefined;
}

function supportedAspect(value: string | undefined): "9:16" | "16:9" | "1:1" | undefined {
  return value === "9:16" || value === "16:9" || value === "1:1" ? value : undefined;
}

async function loadMachineTaskAssets(
  userId: string,
  assetIds: string[],
  locale: string,
): Promise<UploadedAsset[]> {
  try {
    const assets = await resolveOwnedImageAssets({ userId, assetIds });
    return assets.map((asset, index) => ({
      id: asset.id,
      assetId: asset.id,
      type: "IMAGE" as const,
      inferredRole: "product_image" as const,
      roleConfidence: 1,
      url: absoluteAssetUrl(asset.url),
      mimeType: asset.mimeType,
      fileName: `product-image-${index + 1}`,
      width: asset.width,
      height: asset.height,
      durationSeconds: null,
      userAssignedRole: "product_image" as const,
      suggestedUse: locale === "en-US"
        ? "Loaded from a video task waiting for confirmation."
        : "已从待确认的视频任务载入。",
      warnings: [],
    }));
  } catch {
    return [];
  }
}

function absoluteAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return new URL(url, base).toString();
}
