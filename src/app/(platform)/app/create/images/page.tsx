import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import {
  ProductImageStudio,
  type ProductImageJobDto,
} from "@/components/product-images/product-image-studio";
import { authOptions } from "@/lib/auth";
import { listProductImageJobsForUser } from "@/lib/services/product-image-service";

export const dynamic = "force-dynamic";

export default async function ProductImagesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create/images");
  const rows = await listProductImageJobsForUser(session.user.id);
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
    fromMock: job.fromMock,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
  }));
  return (
    <div className="editorial-page-stack">
      <header className="max-w-4xl space-y-4">
        <p className="studio-label text-muted-foreground">Product Image Studio</p>
        <h1 className="editorial-display">先把产品图做准，再批量出片</h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          优化现有实拍图，或从描述生成新的产品视觉；风格预设锁定构图与光线，成品一键进入单条或批量视频。
        </p>
        <CreateModeTabs active="image" />
      </header>
      <ProductImageStudio initialJobs={jobs} />
    </div>
  );
}
