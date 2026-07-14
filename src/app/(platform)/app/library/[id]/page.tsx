import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { getUnifiedLibraryItem } from "@/lib/services/unified-library-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VideoActions } from "@/components/library/video-actions";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { ReportContentButton } from "@/components/library/report-content-button";
import { VideoDownloadLink } from "@/components/library/video-download-link";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function PlatformLibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?from=/app/library/${id}`);
  const item = await getUnifiedLibraryItem(session.user.id, id);
  if (!item) notFound();
  const copy = getPlatformCopy(await getServerLocale()).library;
  return (
    <div className="editorial-page-stack">
      <Button render={<Link href="/app/library" />} variant="ghost" size="sm"><ArrowLeft aria-hidden />{copy.back}</Button>
      <header className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h1 className="editorial-display">{item.title}</h1><Badge variant={item.status === "ready" ? "success" : item.status === "failed" ? "destructive" : "secondary"}>{copy.statuses[item.status]}</Badge></div><p className="font-mono text-body tabular-nums text-muted-foreground">{item.durationSec ? `${item.durationSec}s` : copy.durationPending} · {item.aspectRatio ?? copy.aspectPending} · {item.id}</p>{item.videoUrl || item.briefId ? <div className="flex flex-wrap gap-2">{item.videoUrl ? <VideoDownloadLink videoUrl={item.videoUrl} filename={`aivora-${item.id}.mp4`} label={copy.download} /> : null}{item.briefId ? <><VideoActions briefId={item.briefId} failedSceneCount={item.failedSceneCount} canRetry={item.canRetry} /><ReportContentButton briefId={item.briefId} /></> : null}</div> : null}{item.status === "failed" ? <p className="text-body text-muted-foreground">{copy.detailFailure}</p> : null}</header>
      <Card><CardContent className="py-6">{item.videoUrl ? <div className="relative mx-auto w-fit max-w-full"><video controls preload="metadata" poster={item.thumbnailUrl ?? undefined} className="max-h-[70vh] w-auto max-w-full rounded-(--radius-md)" src={item.videoUrl}>{copy.cannotPlay}</video><AiGeneratedLabel className="pointer-events-none absolute left-3 top-3" /></div> : <p className="py-16 text-center text-body text-muted-foreground">{copy.processing}</p>}</CardContent></Card>
    </div>
  );
}
