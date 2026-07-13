"use client";

import { useState } from "react";
import { PawPrint } from "lucide-react";
import { cn } from "@/lib/utils";

interface PetImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

/**
 * 宠物图片组件，带优雅降级。
 *
 * AI 生成素材落地前或加载失败时，使用语义化占位块保证布局稳定。
 */
export function PetImage({
  src,
  alt,
  className,
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
        "flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-center text-muted-foreground",
        className,
      )}
      aria-label={alt}
      role="img"
    >
      <PawPrint size={24} aria-hidden />
      {fallbackLabel ? (
        <span className="px-3 text-xs font-medium text-foreground/70">
          {fallbackLabel}
        </span>
      ) : null}
    </div>
  );
}
