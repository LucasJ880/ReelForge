"use client";

import { useState } from "react";
import { Download, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface DownloadButtonProps {
  url: string;
  filename?: string;
  className?: string;
  size?: "sm" | "md";
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function DownloadButton({
  url,
  filename,
  className,
  size = "md",
  label,
  onClick,
}: DownloadButtonProps) {
  const [state, setState] = useState<"idle" | "downloading" | "done">("idle");

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (onClick) onClick(e);
    if (state === "downloading") return;

    setState("downloading");
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`下载失败 (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename || inferFilename(url);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      console.error("[DownloadButton]", err);
      setState("idle");
      alert(err instanceof Error ? err.message : "下载失败");
    }
  }

  const sizeClasses = size === "sm"
    ? "h-7 px-2.5 text-xs gap-1"
    : "h-9 px-3 text-sm gap-1.5";

  const iconSize = size === "sm" ? 13 : 15;

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={state === "downloading"}
      aria-label={label || "下载视频"}
      title={label || "下载视频"}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition",
        "border border-white/10 bg-white/[0.04] text-foreground",
        "hover:bg-white/[0.08] hover:border-white/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        sizeClasses,
        className,
      )}
    >
      {state === "downloading" ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : state === "done" ? (
        <Check size={iconSize} />
      ) : (
        <Download size={iconSize} />
      )}
      {label && <span>{label}</span>}
    </button>
  );
}

function inferFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop();
    if (last && /\.(mp4|mov|webm|mkv)$/i.test(last)) return last;
  } catch {}
  return `video-${Date.now()}.mp4`;
}
