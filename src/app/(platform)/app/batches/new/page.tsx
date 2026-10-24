import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { BatchCreateWizard } from "@/components/batch/batch-create-wizard";
import { authOptions } from "@/lib/auth";
import { findProductImageResultForUser } from "@/lib/services/product-image-service";
import { loadExchangeReadings } from "@/lib/services/exchange-readings";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import { getWorkspacePlanForUser } from "@/lib/services/workspace-plan-service";
import { QuoteHeader } from "@/components/exchange/quote-header";
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
  const [result, readings, plan, templates, locale] = await Promise.all([
    productImageResultId
      ? findProductImageResultForUser(productImageResultId, session.user.id)
      : Promise.resolve(null),
    loadExchangeReadings(session.user.id, { mediaLimit: 0 }),
    getWorkspacePlanForUser(session.user.id),
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
        statsLabel={copy.newBoard.label}
        stats={[
          { label: copy.board.live, value: readings.liveBatches, tone: readings.liveBatches > 0 ? "live" : "neutral" },
          {
            label: copy.newBoard.filled30,
            value: `${readings.filled30d} / ${plan.monthlyVideoLimit}`,
            caption: copy.newBoard.allowance.replace("{n}", String(plan.monthlyVideoLimit)),
          },
          { label: copy.newBoard.templates, value: templates.length, caption: copy.newBoard.templatesCaption },
        ]}
      />
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
