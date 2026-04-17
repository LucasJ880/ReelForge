"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, Upload, Loader2, Film } from "lucide-react";
import { upload } from "@vercel/blob/client";

export function UserAssetsManager({
  projectId,
  initialAssets,
  onChange,
  disabled,
}: {
  projectId: string;
  initialAssets: string[];
  onChange?: (assets: string[]) => void;
  disabled?: boolean;
}) {
  const [assets, setAssets] = useState<string[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    setAssets(initialAssets);
  }, [initialAssets]);

  async function handleUpload(file: File) {
    if (uploading) return;
    if (!file.type.startsWith("video/")) {
      toast.error("仅支持 mp4 / webm / mov 视频");
      return;
    }
    setUploading(true);
    try {
      const pathname = `user-assets/${projectId}-${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const uploaded = await upload(pathname, file, {
        access: "public",
        handleUploadUrl: "/api/upload/video-token",
        contentType: file.type,
      });

      const res = await fetch(`/api/projects/${projectId}/user-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: uploaded.url }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "添加失败");
      }
      const data = await res.json();
      setAssets(data.assets);
      onChange?.(data.assets);
      toast.success("素材已上传");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(url: string) {
    if (removing) return;
    setRemoving(url);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/user-assets?url=${encodeURIComponent(url)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "删除失败");
      }
      const data = await res.json();
      setAssets(data.assets);
      onChange?.(data.assets);
      toast.success("素材已移除");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
            自带素材（可选）
          </span>
        </div>
        <label className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${disabled || uploading ? "opacity-50 pointer-events-none" : "hover:bg-accent"}`}>
          {uploading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          上传
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            disabled={disabled || uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {assets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          没有自带素材时，Free 通道会用 Pexels 免费竖屏视频；上传后会优先使用你的素材。
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {assets.map((url) => (
            <div
              key={url}
              className="group relative aspect-[9/16] rounded-md overflow-hidden border border-border bg-black"
            >
              <video
                src={url}
                muted
                preload="metadata"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemove(url)}
                disabled={removing === url}
                className="absolute top-1 right-1 inline-flex items-center justify-center rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
              >
                {removing === url ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
