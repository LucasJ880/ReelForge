import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";
import { authOptions } from "@/lib/auth";
import { loadLastCreativeDraft } from "@/lib/services/order-creative-draft";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function CreateVideoPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/personal/create-video");

  const sp = await searchParams;
  const userId = session.user?.id;
  const initialDraft =
    sp.from === "last" && userId
      ? await loadLastCreativeDraft(userId, "PERSONAL")
      : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">生成你的视频</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          用一句话描述画面，选好时长，一键生成。有参考图可以上传，没有也能直接开拍。
        </p>
        {initialDraft ? (
          <p className="mt-2 text-sm text-sky-300">
            已载入上次创意「{initialDraft.sourceTitle}」，可直接修改后再次生成。
          </p>
        ) : userId ? (
          <p className="mt-2 text-sm text-muted-foreground">
            <Link
              href="/personal/create-video?from=last"
              className="text-primary hover:underline"
            >
              沿用上一次描述
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
