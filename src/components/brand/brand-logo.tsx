"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 品牌 Logo 展示位。
 *
 * Logo 资产可能因为托管迁移 / 资产过期而取不到（2026-07-29 线上 `/brand/*.png`
 * 404 就把展示墙渲染成了浏览器裂图）。这里在加载失败时降级成品牌首字母，
 * 保证对外展示位任何时候都是完整的视觉，而不是破图图标。
 */
export function BrandLogo({
  src,
  brandName,
  className,
  imageClassName,
}: {
  src: string;
  brandName: string;
  className?: string;
  imageClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = brandInitials(brandName);

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-secondary",
        className,
      )}
    >
      {failed || !src ? (
        <span
          aria-hidden
          className="font-heading text-subhead font-semibold text-muted-foreground"
        >
          {initials}
        </span>
      ) : (
        <Image
          src={src}
          alt=""
          fill
          unoptimized
          className={cn("object-contain", imageClassName)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function brandInitials(brandName: string): string {
  const words = brandName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
