import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";
import { authOptions } from "@/lib/auth";
import { getServerTranslator } from "@/i18n/server";
import { loadLastCreativeDraft } from "@/lib/services/order-creative-draft";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function CreateVideoPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/personal/create-video");

  const { t } = await getServerTranslator();
  const sp = await searchParams;
  const userId = session.user?.id;
  const initialDraft =
    sp.from === "last" && userId
      ? await loadLastCreativeDraft(userId, "PERSONAL")
      : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("shell.creative.pageTitlePersonal")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("shell.creative.pageSubtitlePersonal")}
        </p>
        {initialDraft ? (
          <p className="mt-2 text-sm text-sky-300">
            {t("shell.creative.prefilledLast", {
              title: initialDraft.sourceTitle,
            })}
          </p>
        ) : userId ? (
          <p className="mt-2 text-sm text-muted-foreground">
            <Link
              href="/personal/create-video?from=last"
              className="text-primary hover:underline"
            >
              {t("shell.creative.useLastPrompt")}
            </Link>
          </p>
        ) : null}
      </header>
      <UnifiedCreativeInputShell
        userType="personal"
        initialDraft={initialDraft ?? undefined}
      />
    </div>
  );
}
