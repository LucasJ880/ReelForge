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

export const dynamic = "force-dynamic";

export default async function PlatformLibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?from=/app/library/${id}`);
  const item = await getUnifiedLibraryItem(session.user.id, id);
  if (!item) notFound();
  return (
    <div className="editorial-page-stack">
      <Button render={<Link href="/app/library" />} variant="ghost" size="sm"><ArrowLeft aria-hidden />返回成品库</Button>
      <header className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h1 className="editorial-display">{item.title}</h1><Badge variant={item.status === "ready" ? "success" : item.status === "failed" ? "destructive" : "secondary"}>{item.label}</Badge></div><p className="font-mono text-body tabular-nums text-muted-foreground">{item.durationSec ? `${item.durationSec}s` : "时长待定"} · {item.aspectRatio ?? "画幅待定"} · {item.id}</p>{item.briefId ? <div className="flex flex-wrap gap-2"><VideoActions briefId={item.briefId} failedSceneCount={item.failedSceneCount} canRetry={item.canRetry} /><ReportContentButton briefId={item.briefId} /></div> : null}{item.status === "failed" ? <p className="text-body text-muted-foreground">这支视频没有完成。请重试失败片段；如再次失败，请联系支持并附上上方视频 ID。</p> : null}</header>
      <Card><CardContent className="py-6">{item.videoUrl ? <div className="relative mx-auto w-fit max-w-full"><video controls preload="metadata" poster={item.thumbnailUrl ?? undefined} className="max-h-[70vh] w-auto max-w-full rounded-(--radius-md)" src={item.videoUrl}>浏览器无法播放此视频。</video><AiGeneratedLabel className="pointer-events-none absolute left-3 top-3" /></div> : <p className="py-16 text-center text-body text-muted-foreground">视频仍在处理中，完成后会显示在这里。</p>}</CardContent></Card>
    </div>
  );
}
