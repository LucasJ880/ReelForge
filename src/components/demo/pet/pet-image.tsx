"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface PetImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  /// 占位时显示的 emoji / 文案
  fallbackEmoji?: string;
  fallbackLabel?: string;
}

/**
 * 宠物图片组件，带优雅降级。
 *
 * AI 生成素材（/demo/pet/*.png）落地前，或加载失败时，渲染一个暖色渐变
 * 占位块 + emoji，保证 demo 页面在缺图情况下依然好看、不崩。
 */
export function PetImage({
  src,
  alt,
  className,
  fallbackEmoji = "🐾",
  fallbackLabel,
}: PetImageProps) {
  const [errored, setErrored] = useState(false);
  const showImage = Boolean(src) && !errored;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src ?? undefined}
        alt={alt}
        className={cn("h-full w-full object-cover", className)}
        loading="lazy"
        draggable={false}
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 bg-linear-to-br from-[var(--pet-orange-soft)] via-[var(--pet-cream)] to-[var(--pet-teal-soft)] text-center",
        className,
      )}
      aria-label={alt}
      role="img"
    >
      <span className="text-3xl">{fallbackEmoji}</span>
      {fallbackLabel ? (
        <span className="px-3 text-xs font-medium text-foreground/70">
          {fallbackLabel}
        </span>
      ) : null}
    </div>
  );
}
