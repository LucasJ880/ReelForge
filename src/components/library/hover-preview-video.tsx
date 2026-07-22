"use client";

import { useRef } from "react";

export function HoverPreviewVideo({
  src,
  poster,
}: {
  src: string;
  poster?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  function play() {
    void ref.current?.play().catch(() => undefined);
  }

  function reset() {
    if (!ref.current) return;
    ref.current.pause();
    ref.current.currentTime = 0;
  }

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      onPointerEnter={play}
      onPointerLeave={reset}
      onFocus={play}
      onBlur={reset}
      className="size-full object-cover transition-transform duration-base group-hover:scale-[1.02] motion-reduce:transition-none"
      aria-label="悬停预览视频"
    />
  );
}
