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
    mode: job.mode,
    status: job.status,
    prompt: job.prompt,
    preset: job.preset,
    aspectRatio: job.aspectRatio,
    quality: job.quality,
    model: job.model,
    sourceImageUrl: job.sourceImageUrl,
    outputImageUrl: job.outputImageUrl,
    outputAssetId: job.outputAssetId,
    fromMock: job.fromMock,
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
