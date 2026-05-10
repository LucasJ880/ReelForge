import type { ReactNode } from "react";
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
}: PhoneVideoMockupProps) {
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
        {videoUrl ? (
          <video
            className="h-full w-full object-cover"
            src={videoUrl}
            poster={posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            muted
          />
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
            <div className="w-full text-left text-[10px] uppercase tracking-[0.28em] text-white/55">
              Sample render preview
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
