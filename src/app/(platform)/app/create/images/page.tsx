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
  const jobs: ProductImageJobDto[] = rows.map((job) => ({
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
    outputs: job.outputs.map((output) => ({
      id: output.id,
      position: output.position,
      url: output.outputImageUrl,
      asset: {
        id: output.asset.id,
        url: output.asset.url,
        mimeType: output.asset.mimeType,
        width: output.asset.width,
        height: output.asset.height,
      },
    })),
    outputImageUrl: job.outputImageUrl,
    outputAssetId: job.outputAssetId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
  }));
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
