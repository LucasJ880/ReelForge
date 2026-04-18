import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { ProjectStatus } from "@prisma/client";
import { PublicHeader } from "@/components/public/public-header";
import { GalleryVideoActions } from "@/components/public/gallery-video-actions";

export const revalidate = 60;

export default async function GalleryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await db.project.findFirst({
    where: { id, isPublic: true, status: ProjectStatus.DONE },
    include: {
      contentPlan: true,
      videoJob: true,
    },
  });

  if (!project) notFound();

  const videoUrl =
    project.videoJob?.brandedVideoUrl ||
    project.videoJob?.stitchedVideoUrl ||
    project.videoJob?.videoUrl ||
    null;
  const poster = project.videoJob?.thumbnailUrl || undefined;
  const filename = `${project.keyword}-${project.videoJob?.duration || 15}s.mp4`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-10">
        <Link
          href="/gallery"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3 w-3" />
          返回画廊
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section>
            <div className="rounded-2xl overflow-hidden bg-black">
              <div className="aspect-[9/16] w-full max-w-md mx-auto">
                {videoUrl ? (
                  <video
                    src={videoUrl}
                    poster={poster}
                    controls
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    视频暂不可用
                  </div>
                )}
              </div>
            </div>

            {videoUrl && (
              <div className="mt-4 flex justify-center">
                <GalleryVideoActions url={videoUrl} filename={filename} />
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-primary/80 font-medium mb-2">
                关键词
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                {project.keyword}
              </h1>
            </div>

            {project.contentPlan?.caption && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-medium mb-1.5">
                  标题
                </p>
                <p className="text-sm text-foreground">
                  {project.contentPlan.caption}
                </p>
              </div>
            )}

            {project.contentPlan?.script && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-medium mb-1.5">
                  脚本
                </p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {project.contentPlan.script}
                </p>
              </div>
            )}

            {project.contentPlan?.hashtags &&
              project.contentPlan.hashtags.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-medium mb-1.5">
                    Hashtags
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {project.contentPlan.hashtags.map((tag, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-accent/60 px-2.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {tag.startsWith("#") ? tag : `#${tag}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <p className="text-sm font-medium text-primary">想做自己的？</p>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                订阅 Pro 后，你也能用自己的关键词、品牌 Logo 一键生成同款视频。
              </p>
              <Link
                href="/pricing"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <Download className="h-3.5 w-3.5" />
                查看订阅方案
              </Link>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
