import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import {
  ProductImageStudio,
  type BrandPackageOption,
  type ProductImageJobDto,
} from "@/components/product-images/product-image-studio";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  hasFatalProductImageTask,
  isRetryableProductImageTask,
  listProductImageJobsForUser,
} from "@/lib/services/product-image-service";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

const READING_COPY = {
  "zh-CN": {
    label: "产品图读数",
    inFlight: "生成中",
    images30d: "近 30 天出图",
    imagesTotal: "累计出图",
    failed30d: "近 30 天失败",
    scope: "统计口径：本账号的产品图任务实时读取；取消的任务不计入失败。",
  },
  "en-US": {
    label: "Product image readings",
    inFlight: "In progress",
    images30d: "Images · 30 days",
    imagesTotal: "Images · all time",
    failed30d: "Failed · 30 days",
    scope: "Live from your product-image jobs; cancelled jobs are not counted as failures.",
  },
} as const;

/**
 * 行情头读数：只数本人的产品图任务，零就写零。
 * 出图数 = 结果行（每张成品图一行）+ 结果表上线前的历史成片（任务成功、没有结果行、但有成品 URL）。
 */
async function loadImageReadings(userId: string) {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const legacy = {
    userId,
    status: "SUCCEEDED" as const,
    outputs: { none: {} },
    outputImageUrl: { not: null },
  };
  const [inFlight, results30d, resultsTotal, legacy30d, legacyTotal, failed30d] = await Promise.all([
    db.productImageJob.count({ where: { userId, status: { in: ["QUEUED", "PROCESSING"] } } }),
    db.productImageResult.count({ where: { productImageJob: { userId }, createdAt: { gte: since } } }),
    db.productImageResult.count({ where: { productImageJob: { userId } } }),
    db.productImageJob.count({ where: { ...legacy, createdAt: { gte: since } } }),
    db.productImageJob.count({ where: legacy }),
    db.productImageJob.count({ where: { userId, status: "FAILED", createdAt: { gte: since } } }),
  ]);
  return {
    inFlight,
    images30d: results30d + legacy30d,
    imagesTotal: resultsTotal + legacyTotal,
    failed30d,
  };
}

export default async function ProductImagesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create/images");
  const [rows, brandPackageViews, readings, locale] = await Promise.all([
    listProductImageJobsForUser(session.user.id),
    listWorkspaceBrandPackagesForUser(session.user.id),
    loadImageReadings(session.user.id),
    getServerLocale(),
  ]);
  /// 印上品牌 Logo：只传客户端需要的精简字段，logo 直接取品牌包资产 URL。
  const brandPackages: BrandPackageOption[] = brandPackageViews
    .filter((pkg) => pkg.logoAsset.mimeType.startsWith("image/"))
    .map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      brandName: pkg.brandName,
      logoUrl: pkg.logoAsset.url,
      scope: pkg.scope,
      isDefault: pkg.isDefault,
    }));
  const copy = getPlatformCopy(locale).images;
  const readingCopy = READING_COPY[locale === "en-US" ? "en-US" : "zh-CN"];
  const jobs: ProductImageJobDto[] = rows.map((job) => {
    const outputs = job.outputs.length > 0
      ? job.outputs.map((output) => ({
          id: output.id,
          handoffId: output.id,
          position: output.position,
          url: output.outputImageUrl,
          asset: {
            id: output.asset.id,
            url: output.asset.url,
            mimeType: output.asset.mimeType,
            width: output.asset.width,
            height: output.asset.height,
          },
          historical: false,
        }))
      : job.status === "SUCCEEDED" && job.outputImageUrl
        ? [{
            id: `historical-${job.id}`,
            handoffId: null,
            position: 0,
            url: job.outputImageUrl,
            asset: null,
            historical: true,
          }]
        : [];
    return {
      id: job.id,
      status: job.status,
      prompt: job.prompt,
      preset: job.preset,
      aspectRatio: job.aspectRatio,
      model: job.model,
      modelSnapshot: job.modelSnapshot,
      planId: job.planId,
      resolutionSnapshot: job.resolutionSnapshot,
      pointsSnapshot: job.pointsSnapshot,
      resultCount: job.resultCount,
      sourceAsset: job.sourceAsset
        ? {
            id: job.sourceAsset.id,
            url: job.sourceAsset.url,
            mimeType: job.sourceAsset.mimeType,
            width: job.sourceAsset.width,
            height: job.sourceAsset.height,
          }
        : null,
      outputs,
      retryableTasks: job.status === "FAILED" && !hasFatalProductImageTask(job.providerTasks)
        ? job.providerTasks
            .filter(isRetryableProductImageTask)
            .map((task) => ({
              id: task.id,
              ordinal: task.ordinal,
              errorMessage: task.errorMessage,
            }))
        : [],
      outputImageUrl: job.outputImageUrl,
      outputAssetId: job.outputAssetId,
      errorMessage: job.errorMessage,
      historyNotice: outputs.some((output) => output.historical)
        ? "此历史图片可查看和下载；如需继续编辑或制作视频，请重新生成以创建服务器资产。"
        : null,
      brandLogo: job.brandLogoUrl
        ? { packageId: job.brandPackageId, url: job.brandLogoUrl }
        : null,
      createdAt: job.createdAt.toISOString(),
    };
  });
  return (
    <div className="x-stack min-w-0">
      <QuoteHeader
        title={copy.pageTitle}
        subtitle={copy.pageSubtitle}
        actions={<CreateModeTabs active="image" />}
        statsLabel={readingCopy.label}
        stats={[
          { label: readingCopy.inFlight, value: readings.inFlight, tone: readings.inFlight > 0 ? "live" : "neutral" },
          { label: readingCopy.images30d, value: readings.images30d, tone: readings.images30d > 0 ? "filled" : "neutral" },
          { label: readingCopy.imagesTotal, value: readings.imagesTotal },
          { label: readingCopy.failed30d, value: readings.failed30d, tone: readings.failed30d > 0 ? "fault" : "neutral" },
        ]}
        scope={readingCopy.scope}
      />
      <ProductImageStudio initialJobs={jobs} brandPackages={brandPackages} />
    </div>
  );
}
