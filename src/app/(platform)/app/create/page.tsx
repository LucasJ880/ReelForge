import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";
import { authOptions } from "@/lib/auth";
import { findProductImageJobForUser } from "@/lib/services/product-image-service";
import type { UploadedAsset } from "@/types/video-generation";

export default async function PlatformCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ productImageJobId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/create");
  const { productImageJobId } = await searchParams;
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
          suggestedUse: "已从产品图工作台载入，可作为视频的产品一致性参考。",
          warnings: [],
        }]
      : [];
  return (
    <div className="editorial-page-stack">
      <header className="max-w-4xl space-y-4">
        <p className="studio-label text-muted-foreground">
          Agent Director
        </p>
        <h1 className="editorial-display">从一个想法到完整成片</h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          上传产品素材，用自然语言描述目标；同一条流水线完成策划、分镜、生成与入库。
        </p>
        <CreateModeTabs active="video" />
      </header>
      <UnifiedCreativeInputShell userType="platform" initialAssets={initialAssets} />
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
