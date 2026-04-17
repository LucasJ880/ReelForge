"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Shield, RotateCcw, CheckCircle2 } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { applyBrandLock, type BrandLockConfig } from "@/lib/brand-lock-composer";

interface Props {
  projectId: string;
  /** 当前 brandedVideoUrl，已经合成过则显示"已完成"状态 */
  existingBrandedUrl?: string | null;
  /** 原始（AI 生成）视频 URL */
  rawVideoUrl?: string | null;
  /** 当最终 branded URL 回填到 DB 后的回调 */
  onBranded?: (brandedUrl: string) => void;
  /** 是否应该自动触发合成（首次 Pro/Free 成功后用） */
  autoTrigger?: boolean;
}

type State = "idle" | "fetching" | "composing" | "uploading" | "done" | "error";

/**
 * Brand Lock 合成组件
 *
 * 流程：
 *   1. GET /api/projects/[id]/brand-lock → 拿 raw video + config
 *   2. 浏览器 ffmpeg.wasm 合成 → 得到 branded Blob
 *   3. upload() 直传 Blob 到 Vercel Blob (branded/ 目录)
 *   4. POST /api/projects/[id]/brand-lock 回填 brandedVideoUrl
 */
export function BrandLockSynth({
  projectId,
  existingBrandedUrl,
  rawVideoUrl,
  onBranded,
  autoTrigger = false,
}: Props) {
  const [state, setState] = useState<State>(
    existingBrandedUrl ? "done" : "idle",
  );
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const autoTriggeredRef = useRef(false);

  const run = useCallback(async () => {
    if (state === "composing" || state === "uploading" || state === "fetching") {
      return;
    }
    setErrorMsg(null);
    setState("fetching");
    setProgress(0);
    setMessage("读取合成配置...");

    try {
      const metaRes = await fetch(`/api/projects/${projectId}/brand-lock`, {
        method: "GET",
      });
      if (!metaRes.ok) {
        const err = await metaRes.json().catch(() => ({}));
        throw new Error(err.error || "获取合成配置失败");
      }
      const meta = await metaRes.json();
      const cfg: BrandLockConfig = meta.config;
      if (!meta.rawVideoUrl) {
        throw new Error("没有可合成的原始视频");
      }

      setState("composing");
      const blob = await applyBrandLock(meta.rawVideoUrl, cfg, (pct, msg) => {
        setProgress(Math.round(pct));
        if (msg) setMessage(msg);
      });

      setState("uploading");
      setMessage("上传品牌版视频...");
      const filename = `branded/${projectId}-${Date.now()}.mp4`;
      const uploaded = await upload(filename, blob, {
        access: "public",
        handleUploadUrl: "/api/upload/video-token",
        contentType: "video/mp4",
      });

      setMessage("回写任务状态...");
      const saveRes = await fetch(`/api/projects/${projectId}/brand-lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandedVideoUrl: uploaded.url }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        throw new Error(err.error || "回写失败");
      }

      setState("done");
      setProgress(100);
      setMessage("品牌版已就绪");
      toast.success("Brand Lock 合成完成");
      onBranded?.(uploaded.url);
    } catch (err) {
      console.error("[BrandLockSynth]", err);
      const msg = err instanceof Error ? err.message : "合成失败";
      setErrorMsg(msg);
      setState("error");
      toast.error(`Brand Lock 失败：${msg}`);
    }
  }, [projectId, state, onBranded]);

  // 自动触发（仅首次）
  useEffect(() => {
    if (
      autoTrigger &&
      !autoTriggeredRef.current &&
      !existingBrandedUrl &&
      rawVideoUrl &&
      state === "idle"
    ) {
      autoTriggeredRef.current = true;
      run();
    }
  }, [autoTrigger, existingBrandedUrl, rawVideoUrl, state, run]);

  const busy =
    state === "fetching" || state === "composing" || state === "uploading";

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Brand Lock · 品牌保真合成
          </span>
          {state === "done" && (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          )}
        </div>
        {!busy && (
          <button
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-primary/40 hover:bg-primary/[0.08] transition-colors"
            title={state === "done" ? "用新配置重新合成" : "开始合成"}
          >
            <RotateCcw className="h-3 w-3" />
            {state === "done" ? "重新合成" : state === "error" ? "重试" : "合成"}
          </button>
        )}
      </div>

      {busy && (
        <>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-2">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span>{message || "处理中..."}</span>
            <span className="ml-auto tabular-nums text-primary">{progress}%</span>
          </div>
          <div className="h-1 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      )}

      {state === "done" && !busy && (
        <p className="text-[11px] text-muted-foreground">
          logo 已硬叠加到最终视频。换 logo / 改位置后可「重新合成」。
        </p>
      )}

      {state === "error" && errorMsg && (
        <p className="text-[11px] text-red-400 mt-1">{errorMsg}</p>
      )}

      {state === "idle" && (
        <p className="text-[11px] text-muted-foreground">
          点击「合成」给视频叠加品牌层（logo 水印），保证商家品牌 100% 露出。
        </p>
      )}
    </div>
  );
}
