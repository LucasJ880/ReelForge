"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Maximize2 } from "lucide-react";
import { useNow } from "@/components/exchange/use-now";

/** 大屏的三个活件：秒级时钟、定时刷新、全屏。都只在浏览器里跑，服务端渲染占位。 */
export function WallClock({ locale }: { locale: string }) {
  const now = useNow();
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-[clamp(28px,3vw,56px)] font-light leading-none tabular-nums text-foreground">
        {now
          ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)
          : "--:--:--"}
      </span>
      <span className="font-mono text-data uppercase tracking-wider text-muted-foreground">
        {now ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(now) : ""}
      </span>
    </div>
  );
}

export function WallAutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}

export function WallFullscreenButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }}
      className="flex h-8 items-center gap-2 rounded-(--radius-md) border border-border-strong px-3 text-meta text-muted-foreground hover:border-accent hover:text-accent"
    >
      <Maximize2 className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

/** 大屏成片：静音循环播放；系统要求减少动态时只显示封面帧。 */
export function WallVideo({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void ref.current?.play().catch(() => undefined);
  }, [src]);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={label}
      className="size-full object-cover"
    />
  );
}
