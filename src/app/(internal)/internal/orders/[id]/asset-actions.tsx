"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AssetActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");

  async function registerAsset(payload: {
    name: string;
    url: string;
    type?: "VIDEO" | "IMAGE" | "AUDIO";
    mimeType?: string;
    fileSizeBytes?: number;
  }) {
    const res = await fetch(`/api/delivery-orders/${orderId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "素材登记失败");
    }
  }

  async function uploadFile(file: File) {
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("prefix", `orders/${orderId}/raw-assets`);
      const upload = await fetch("/api/upload/blob", { method: "POST", body: form });
      if (!upload.ok) {
        const data = await upload.json().catch(() => ({}));
        throw new Error(data.error || "上传失败");
      }
      const blob = (await upload.json()) as { url: string };
      await registerAsset({
        name: file.name,
        url: blob.url,
        type: file.type.startsWith("image/") ? "IMAGE" : file.type.startsWith("audio/") ? "AUDIO" : "VIDEO",
        mimeType: file.type,
        fileSizeBytes: file.size,
      });
      toast.success("素材已上传并登记");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addUrl() {
    if (!url) return;
    setBusy("url");
    try {
      await registerAsset({
        name: name || new URL(url).pathname.split("/").pop() || "素材 URL",
        url,
        type: inferType(url),
      });
      setUrl("");
      setName("");
      toast.success("素材 URL 已登记");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function preprocessAll() {
    setBusy("preprocess");
    try {
      const res = await fetch(`/api/delivery-orders/${orderId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preprocess_all", options: {} }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "预处理失败");
      }
      toast.success("素材索引已生成");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <Input
        type="file"
        accept="video/*,image/*,audio/*"
        disabled={!!busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadFile(file);
        }}
      />
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <Input
          value={name}
          disabled={!!busy}
          placeholder="素材名称（可选）"
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          value={url}
          disabled={!!busy}
          placeholder="或粘贴素材 URL"
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button size="sm" variant="outline" disabled={!!busy || !url} onClick={addUrl}>
          {busy === "url" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
          登记
        </Button>
      </div>
      <Button size="sm" disabled={!!busy} onClick={preprocessAll}>
        {busy === "preprocess" ? (
          <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />
        ) : (
          <Upload strokeWidth={1.5} aria-hidden />
        )}
        预处理并打标签
      </Button>
    </div>
  );
}

function inferType(url: string): "VIDEO" | "IMAGE" | "AUDIO" {
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(lower)) return "IMAGE";
  if (/\.(mp3|wav|m4a|aac)(\?|$)/.test(lower)) return "AUDIO";
  return "VIDEO";
}
