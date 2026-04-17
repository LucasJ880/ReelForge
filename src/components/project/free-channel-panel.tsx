"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Download, RotateCcw } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import {
  composeFreeChannelVideo,
  type FreeClipInput,
} from "@/lib/free-channel-composer";

interface FreeManifest {
  channel: "free";
  voiceId: string;
  totalDurationMs: number;
  resolution: { width: number; height: number };
  clips: FreeClipInput[];
  srt: string;
}

export function FreeChannelPanel({
  projectId,
  manifest,
  currentVideoUrl,
}: {
  projectId: string;
  manifest: FreeManifest;
  currentVideoUrl: string | null;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("准备就绪");
  const [state, setState] = useState<
    "idle" | "rendering" | "uploading" | "done" | "failed"
  >(currentVideoUrl ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(
    currentVideoUrl ?? null,
  );
  const triggeredRef = useRef(false);

  const startRender = useCallback(async () => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    setState("rendering");
    setError(null);
    setProgress(0);

    try {
      const { blob, objectUrl } = await composeFreeChannelVideo(
        manifest.clips,
        (pct, msg) => {
          setProgress(Math.floor(pct));
          if (msg) setMessage(msg);
        },
      );
      setLocalUrl(objectUrl);

      setState("uploading");
      setMessage("上传到云存储...");
      const filename = `free-output/${projectId}-${Date.now()}.mp4`;
      const uploaded = await upload(filename, blob, {
        access: "public",
        handleUploadUrl: "/api/upload/video-token",
        contentType: "video/mp4",
      });

      setMessage("回写任务状态...");
      const res = await fetch(`/api/projects/${projectId}/free-finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: uploaded.url }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "回传失败");
      }

      setState("done");
      setMessage("合成完成");
      toast.success("Free 通道视频已生成");
      router.refresh();
    } catch (err) {
      console.error("[free-channel]", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setState("failed");
      setMessage("合成失败");
      toast.error(`浏览器合成失败：${errMsg}`);

      // 上报失败
      await fetch(`/api/projects/${projectId}/free-finalize`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: errMsg }),
      }).catch(() => undefined);

      // 允许重试
      triggeredRef.current = false;
    }
  }, [manifest.clips, projectId, router]);

  useEffect(() => {
    if (state === "idle" && !localUrl) {
      startRender();
    }
  }, [state, localUrl, startRender]);

  function handleRetry() {
    triggeredRef.current = false;
    setState("idle");
    setProgress(0);
    setError(null);
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Free 通道 · 浏览器端合成</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {manifest.clips.length} 个分镜 · {Math.round(manifest.totalDurationMs / 1000)} 秒
        </span>
      </div>

      {state === "rendering" || state === "uploading" ? (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {message}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {progress}% · 处理过程完全在你浏览器里完成，关闭页面会中断。
          </p>
        </>
      ) : null}

      {state === "failed" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm text-destructive">{error ?? "合成失败"}</p>
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <RotateCcw className="h-3 w-3" />
            重试
          </button>
        </div>
      )}

      {state === "done" && localUrl && (
        <div className="space-y-3">
          <video
            src={localUrl}
            controls
            className="aspect-[9/16] w-full max-w-[360px] rounded-lg bg-black"
          />
          <a
            href={localUrl}
            download={`free-${projectId}.mp4`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            下载 mp4
          </a>
        </div>
      )}
    </div>
  );
}
