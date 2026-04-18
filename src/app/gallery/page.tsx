import Link from "next/link";
import { db } from "@/lib/db";
import { ProjectStatus } from "@prisma/client";
import { ArrowRight, Play, Sparkles } from "lucide-react";
import { PublicHeader } from "@/components/public/public-header";

export const revalidate = 60;

export const metadata = {
  title: "公开画廊 · Aivora",
  description: "浏览 Aivora 用户通过 AI 生成的 TikTok 短视频作品。",
};

export default async function GalleryPage() {
  const projects = await db.project.findMany({
    where: {
      isPublic: true,
      status: ProjectStatus.DONE,
    },
    include: {
      contentPlan: { select: { caption: true, hashtags: true } },
      videoJob: {
        select: {
          brandedVideoUrl: true,
          stitchedVideoUrl: true,
          videoUrl: true,
          thumbnailUrl: true,
          duration: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 48,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-12 sm:pt-20">
        <header className="mb-10">
          <p className="text-[11px] uppercase tracking-[0.2em] text-primary/80 font-medium mb-3">
            Public Gallery
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            Aivora 公开画廊
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">
            这里展示由 Aivora 生成的短视频作品，免费账号可以直接浏览、播放、下载。想自己创作？订阅 Pro 即可解锁全部功能。
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              订阅 Pro 开始创作
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              免费注册
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-16 text-center">
            <Play className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              画廊还没有作品。订阅 Pro 创建第一条，公开后就会出现在这里。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {projects.map((p) => {
              const url =
                p.videoJob?.brandedVideoUrl ||
                p.videoJob?.stitchedVideoUrl ||
                p.videoJob?.videoUrl ||
                null;
              const poster = p.videoJob?.thumbnailUrl || undefined;
              return (
                <Link
                  key={p.id}
                  href={`/gallery/${p.id}`}
                  className="group relative block overflow-hidden rounded-2xl bg-card border border-border hover:border-primary/40 transition-colors"
                >
                  <div className="aspect-[9/16] bg-black relative">
                    {url ? (
                      <video
                        src={url}
                        poster={poster}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                        onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Play className="h-6 w-6" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3">
                      <p className="text-sm font-medium text-white line-clamp-1">
                        {p.keyword}
                      </p>
                      {p.contentPlan?.caption && (
                        <p className="mt-0.5 text-[11px] text-white/70 line-clamp-1">
                          {p.contentPlan.caption}
                        </p>
                      )}
                    </div>
                    {p.videoJob?.duration && (
                      <span className="absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {p.videoJob.duration}s
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
