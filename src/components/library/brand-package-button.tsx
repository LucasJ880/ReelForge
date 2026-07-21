"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Download, Loader2, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * 成品库「品牌封装」入口：对一条干净成片叠加 logo 角标 + 品牌尾卡。
 * 封装结果由 /api/brand-packaging 落库（VideoJob / VideoBrief 的 brandedVideoUrl），
 * 只有 branded 成片提供「下载交付」。
 */
export function BrandPackageButton({
  videoJobId,
  briefId,
  brandedVideoUrl,
  aspectRatio,
  copy,
}: {
  videoJobId: string | null;
  briefId: string | null;
  brandedVideoUrl: string | null;
  aspectRatio: string | null;
  copy: {
    package: string;
    packaging: string;
    packaged: string;
    download: string;
    failed: string;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (brandedVideoUrl) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">
          <BadgeCheck aria-hidden />
          {copy.packaged}
        </Badge>
        <Button
          render={
            <a href={brandedVideoUrl} download target="_blank" rel="noreferrer" />
          }
          size="sm"
        >
          <Download aria-hidden />
          {copy.download}
        </Button>
      </div>
    );
  }

  if (!videoJobId && !briefId) return null;

  async function packageVideo() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/brand-packaging", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoJobId,
          briefId,
          clientProfileId: "sunnyshutter",
          aspectRatio: aspectRatio === "16:9" ? "16:9" : "9:16",
        }),
      });
      if (!response.ok) {
        setError(copy.failed);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || pending}
        onClick={() => void packageVideo()}
      >
        {busy || pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Stamp aria-hidden />
        )}
        {busy || pending ? copy.packaging : copy.package}
      </Button>
      {error ? (
        <span role="status" className="text-meta text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
