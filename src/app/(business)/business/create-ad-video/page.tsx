import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";
import { authOptions } from "@/lib/auth";
import { getServerTranslator } from "@/i18n/server";
import { loadOrderCreativeDraft } from "@/lib/services/order-creative-draft";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function CreateAdVideoPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/create-ad-video");

  const { t } = await getServerTranslator();
  const sp = await searchParams;
  const fromOrderId = sp.from?.trim();
  const initialDraft =
    fromOrderId && session.user?.id
      ? await loadOrderCreativeDraft(fromOrderId, session.user.id)
      : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("shell.creative.pageTitleBusiness")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("shell.creative.pageSubtitleBusiness")}
        </p>
        {initialDraft && (
          <p className="mt-2 text-sm text-sky-300">
            {t("shell.creative.prefilledVariant", {
              title: initialDraft.sourceTitle,
            })}
          </p>
        )}
      </header>
      <UnifiedCreativeInputShell
        userType="business"
        initialDraft={initialDraft ?? undefined}
      />
    </div>
  );
}
