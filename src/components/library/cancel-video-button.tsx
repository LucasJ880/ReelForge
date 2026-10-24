"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requestPulseRefresh } from "@/lib/exchange/pulse";

/**
 * 成品库详情 · 生成中的单条视频可取消（铁律 #7）。两步确认就地完成（不弹浏览器确认框），
 * 说清楚取消的后果：额度立即返还，素材保留。
 */
export function CancelVideoButton({
  orderId,
  copy,
}: {
  orderId: string;
  copy: {
    cancelVideo: string;
    cancelConfirm: string;
    cancelKeep: string;
    cancelConfirmHint: string;
    cancelling: string;
    cancelFailed: string;
  };
}) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setStep("busy");
    setError(null);
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      /// 409 = 已经结束（期间成片或失败了）：刷新让页面显示真实状态，不当成错误。
      if (!response.ok && response.status !== 409) throw new Error(payload?.error ?? copy.cancelFailed);
      requestPulseRefresh();
      router.refresh();
      setStep("idle");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.cancelFailed);
      setStep("confirm");
    }
  }

  if (step === "idle") {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setStep("confirm")}>
        {copy.cancelVideo}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2" role="group" aria-label={copy.cancelVideo}>
      <p className="text-meta text-muted-foreground">{copy.cancelConfirmHint}</p>
      {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" size="sm" disabled={step === "busy"} onClick={cancel}>
          {step === "busy" ? copy.cancelling : copy.cancelConfirm}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={step === "busy"} onClick={() => setStep("idle")}>
          {copy.cancelKeep}
        </Button>
      </div>
    </div>
  );
}
