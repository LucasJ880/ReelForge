import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { BatchCreateWizard } from "@/components/batch/batch-create-wizard";
import { authOptions } from "@/lib/auth";
import { isInternalRole } from "@/lib/auth-role-policy";
import { findProductImageResultForUser } from "@/lib/services/product-image-service";
import { loadProductionCounts, loadVideoQuota } from "@/lib/services/exchange-readings";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { quotaStat, readingStat } from "@/lib/exchange/readings-registry";
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
  const [result, production, quota, templates, locale] = await Promise.all([
    productImageResultId
      ? findProductImageResultForUser(productImageResultId, session.user.id)
      : Promise.resolve(null),
    loadProductionCounts(session.user.id),
    /// 额度格读本月真实用量对生效上限（试用 3 条），不是「近 30 天成片 / 套餐表上限」。
    loadVideoQuota(session.user.id),
    listActiveStyleTemplates(),
    getServerLocale(),
  ]);
  const initialImages = result
    ? [{
        id: result.assetId,
        url: absoluteAssetUrl(result.asset.url),
        fileName: `Aivora-product-image-${result.id.slice(-6)}.png`,
      }]
    : [];
  const copy = getPlatformCopy(locale).batches;
  return (
    <div className="x-stack">
      <QuoteHeader
        title={copy.new}
        subtitle={copy.newSubtitle}
        primaryAction={null}
        readingsLabel={copy.newBoard.label}
        readings={[
          readingStat("activeBatches", production.activeBatches, locale),
          quotaStat(quota.used, quota.limit, locale),
          readingStat("templates", templates.length, locale),
        ]}
        scope={copy.newBoard.scope}
      />
      <BatchCreateWizard
        batchDetailsBasePath="/app/batches"
        initialTemplateId={initialTemplateId}
        initialImages={initialImages}
        showProviderPoints={isInternalRole(session.user.role)}
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
