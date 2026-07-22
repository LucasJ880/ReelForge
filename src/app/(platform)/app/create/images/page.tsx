import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import {
  ProductImageStudio,
  type ProductImageJobDto,
} from "@/components/product-images/product-image-studio";
import { authOptions } from "@/lib/auth";
import { listProductImageJobsForUser } from "@/lib/services/product-image-service";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function ProductImagesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create/images");
  const rows = await listProductImageJobsForUser(session.user.id);
  const copy = getPlatformCopy(await getServerLocale()).images;
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
      retryableTasks: job.status === "FAILED"
        ? job.providerTasks
            .filter((task) => task.submissionState === "REJECTED")
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
      createdAt: job.createdAt.toISOString(),
    };
  });
  return (
    <div className="editorial-page-stack">
      <header className="studio-hero max-w-5xl space-y-4">
        <p className="studio-label text-muted-foreground">{copy.kicker}</p>
        <h1 className="editorial-display">{copy.pageTitle}</h1>
        <p className="max-w-2xl text-body text-muted-foreground">{copy.pageSubtitle}</p>
        <CreateModeTabs active="image" />
      </header>
      <ProductImageStudio initialJobs={jobs} />
    </div>
  );
}
