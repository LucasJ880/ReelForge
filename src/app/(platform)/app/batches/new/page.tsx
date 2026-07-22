import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { BatchCreateWizard } from "@/components/batch/batch-create-wizard";
import { authOptions } from "@/lib/auth";
import { findProductImageResultForUser } from "@/lib/services/product-image-service";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export default async function PlatformBatchCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; productImageResultId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/batches/new");
  const { template: initialTemplateId, productImageResultId } = await searchParams;
  const result = productImageResultId
    ? await findProductImageResultForUser(productImageResultId, session.user.id)
    : null;
  const initialImages = result
    ? [{
        id: result.assetId,
        url: absoluteAssetUrl(result.asset.url),
        fileName: `Aivora-product-image-${result.id.slice(-6)}.png`,
      }]
    : [];
  const copy = getPlatformCopy(await getServerLocale()).batches;
  return (
    <div className="editorial-page-stack">
      <header className="max-w-4xl space-y-4">
        <p className="studio-label text-muted-foreground">{copy.kicker}</p>
        <h1 className="editorial-display">{copy.title}</h1>
        <p className="max-w-2xl text-body text-muted-foreground">{copy.newSubtitle}</p>
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
