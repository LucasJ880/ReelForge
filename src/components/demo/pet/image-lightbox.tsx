"use client";

import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { PetImage } from "./pet-image";

interface ImageLightboxProps {
  src?: string | null;
  alt: string;
  /** 触发缩略图的额外 class（控制宽高比等）。 */
  thumbClassName?: string;
  fallbackLabel?: string;
  /** 放大查看时的提示文案。 */
  zoomHint?: string;
}

/**
 * 可点击放大的图片：缩略图点击后全屏遮罩查看，便于投资人放大看数据细节。
 * Esc / 点击遮罩 / 关闭按钮均可退出，打开时锁定 body 滚动。
 */
export function ImageLightbox({
  src,
  alt,
  thumbClassName,
  fallbackLabel,
  zoomHint = "点击放大查看细节",
}: ImageLightboxProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full cursor-zoom-in"
        aria-label={`${alt} · 点击放大`}
      >
        <PetImage
          src={src}
          alt={alt}
          className={thumbClassName}
          fallbackLabel={fallbackLabel}
        />
        <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-medium text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
          <Maximize2 size={12} /> {zoomHint}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white transition hover:bg-white/20"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src ?? undefined}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[95vw] cursor-zoom-out rounded-2xl object-contain shadow-2xl"
            draggable={false}
          />
        </div>
      ) : null}
    </>
  );
}
