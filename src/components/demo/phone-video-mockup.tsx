"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhoneVideoMockupProps {
  /// 真实视频 URL；如果为 null 则展示占位画面
  videoUrl?: string | null;
  posterUrl?: string | null;
  caption?: string;
  /// 顶部状态徽标，例如 "30s · 9:16"
  statusBadge?: string;
  /// 占位画面的渐变色
  fallbackGradient?: string;
  /// 占位画面里的副文案 / 场景标题
  fallbackTitle?: string;
  /// 占位画面里的小贴士 / 内容
  fallbackSubtitle?: string;
  /// 自由占位内容（覆盖 fallbackTitle/Subtitle）
  fallbackContent?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  /// 视频展示模式：
  ///   - "preview"（默认）：controls + 用户主动播放，适合 Final Output；
  ///   - "autoplay"：muted + loop + autoPlay + 无控件，适合 Hero 静音环播。
  videoMode?: "preview" | "autoplay";
}

const SIZE_CLASS = {
  sm: "h-[420px] w-[210px]",
  md: "h-[520px] w-[260px]",
  lg: "h-[600px] w-[300px]",
} as const;

export function PhoneVideoMockup({
  videoUrl,
  posterUrl,
  caption,
  statusBadge,
  fallbackGradient,
  fallbackTitle,
  fallbackSubtitle,
  fallbackContent,
  className,
  size = "md",
  videoMode = "preview",
}: PhoneVideoMockupProps) {
  const [hasVideoError, setHasVideoError] = useState(false);
  const showVideo = Boolean(videoUrl) && !hasVideoError;
  const showStaticPoster = !showVideo && Boolean(posterUrl);
  const isAutoplay = videoMode === "autoplay";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /*
   * autoplay 模式下浏览器有时会拒绝 muted autoplay（Chrome incognito、Safari 节能
   * 模式、低电量、隐私权限等场景）。如果 play() promise reject 了，我们记录失败
   * 状态并在 video 上叠一层「点击播放」覆盖层，让用户能手动启动播放，避免投资人
   * 看到一个永远静止的 hero phone。
   */
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    if (!isAutoplay || !videoRef.current) return;
    const el = videoRef.current;
    const tryPlay = () => {
      const promise = el.play();
      if (promise && typeof promise.then === "function") {
        promise
          .then(() => setAutoplayBlocked(false))
          .catch(() => setAutoplayBlocked(true));
      }
    };
    tryPlay();
  }, [isAutoplay, videoUrl]);

  const handleManualPlay = () => {
    const el = videoRef.current;
    if (!el) return;
    const promise = el.play();
    if (promise && typeof promise.then === "function") {
      promise
        .then(() => setAutoplayBlocked(false))
        .catch(() => {
          /* 用户点击触发也失败极少见，保持 overlay 让用户重试 */
        });
    }
  };

  return (
    <div
      className={cn(
        "relative mx-auto rounded-[2.4rem] border border-white/10 bg-black/85 p-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65)]",
        SIZE_CLASS[size],
        className,
      )}
    >
      <div className="absolute inset-x-1/2 top-2 z-10 flex h-5 w-24 -translate-x-1/2 items-center justify-center rounded-full bg-black/70" />
      <div className="relative h-full w-full overflow-hidden rounded-[2rem] bg-black">
        {showVideo ? (
          <>
            <video
              key={videoUrl ?? "video"}
              ref={videoRef}
              className="h-full w-full object-cover"
              src={videoUrl ?? undefined}
              poster={posterUrl ?? undefined}
              controls={!isAutoplay}
              playsInline
              preload="metadata"
              muted={isAutoplay}
              loop={isAutoplay}
              autoPlay={isAutoplay}
              onError={() => setHasVideoError(true)}
            >
              <track kind="captions" />
            </video>
            {isAutoplay && autoplayBlocked ? (
              <button
                type="button"
                onClick={handleManualPlay}
                aria-label="点击播放视频"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-[1px] transition hover:bg-black/30"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/40 bg-black/55 backdrop-blur">
                  <Play className="ml-0.5" size={24} />
                </span>
                <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white/90 backdrop-blur">
                  点击播放
                </span>
              </button>
            ) : null}
          </>
        ) : showStaticPoster ? (
          // 静态 poster 模式：videoUrl=null 但 posterUrl 存在时，把 poster
          // 当成 placeholder 主视觉铺满；只叠加可选的 statusBadge / caption。
          <div className="relative h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterUrl ?? undefined}
              alt={fallbackTitle ?? "placeholder poster"}
              className="h-full w-full object-cover"
              loading="lazy"
              draggable={false}
            />
            {statusBadge ? (
              <div className="absolute left-3 top-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white/85 backdrop-blur">
                  {statusBadge}
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              "flex h-full w-full flex-col items-center justify-between bg-gradient-to-br p-5 text-center text-white",
              fallbackGradient ??
                "from-emerald-500/30 via-indigo-500/20 to-rose-500/20",
            )}
          >
            <div className="w-full text-left">
              {statusBadge ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white/85 backdrop-blur">
                  {statusBadge}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-black/40 backdrop-blur">
                <Play className="ml-0.5" size={20} />
              </div>
              {fallbackContent ? (
                <div className="space-y-2 text-balance">{fallbackContent}</div>
              ) : (
                <>
                  {fallbackTitle ? (
                    <p className="text-base font-semibold leading-snug">
                      {fallbackTitle}
                    </p>
                  ) : null}
                  {fallbackSubtitle ? (
                    <p className="text-xs leading-5 text-white/75">
                      {fallbackSubtitle}
                    </p>
                  ) : null}
                </>
              )}
            </div>
            <div className="w-full text-left">
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/55">
                {hasVideoError ? "Video preview unavailable" : "示例预览"}
              </p>
              {hasVideoError ? (
                <p className="mt-2 text-[11px] leading-5 text-white/70">
                  Use the workflow below to see how this output is produced.
                </p>
              ) : null}
            </div>
          </div>
        )}
        {caption ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-2xl bg-black/55 px-3 py-2 text-center text-xs leading-5 text-white backdrop-blur">
            {caption}
          </div>
        ) : null}
      </div>
    </div>
  );
}
