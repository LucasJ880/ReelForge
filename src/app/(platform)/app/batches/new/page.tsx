import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { BatchCreateWizard } from "@/components/batch/batch-create-wizard";
import { authOptions } from "@/lib/auth";
import { findProductImageJobForUser } from "@/lib/services/product-image-service";

export default async function PlatformBatchCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; productImageJobId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/batches/new");
  const { template: initialTemplateId, productImageJobId } = await searchParams;
  const job = productImageJobId
    ? await findProductImageJobForUser(productImageJobId, session.user.id)
    : null;
  const initialImages = job?.status === "SUCCEEDED" && job.outputImageUrl
    ? [{
        id: `product-image-${job.id}`,
        url: absoluteAssetUrl(job.outputImageUrl),
        fileName: `Aivora-product-image-${job.id.slice(-6)}.png`,
      }]
    : [];
  return (
    <div className="editorial-page-stack">
      <header className="max-w-4xl space-y-4">
        <p className="studio-label text-muted-foreground">
          Batch Production
        </p>
        <h1 className="editorial-display">批量生产</h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          锁定模板与素材分配，一次创建批次，并在统一监控页查看任务、分镜和失败原因。
        </p>
      </header>
      <BatchCreateWizard
        batchDetailsBasePath="/app/batches"
        initialTemplateId={initialTemplateId}
        initialImages={initialImages}
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
