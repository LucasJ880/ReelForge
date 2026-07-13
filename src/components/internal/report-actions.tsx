"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReportActions({ reportId, disabled }: { reportId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "review" | "dismiss" | "takedown") {
    const resolutionNote = window.prompt(action === "takedown" ? "请输入下架原因（会写入审计记录）" : "请输入处理说明");
    if (!resolutionNote?.trim()) return;
    setBusy(action); setError(null);
    const response = await fetch(`/api/internal/reports/${reportId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, resolutionNote }) }).catch(() => null);
    setBusy(null);
    if (!response?.ok) { setError("操作失败或状态已改变，请刷新。"); return; }
    router.refresh();
  }
  return <div className="flex flex-wrap items-center gap-2">
    <Button size="xs" variant="outline" disabled={disabled || busy != null} onClick={() => void act("review")}>{busy === "review" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}复审</Button>
    <Button size="xs" variant="outline" disabled={disabled || busy != null} onClick={() => void act("dismiss")}>{busy === "dismiss" ? <Loader2 className="animate-spin" /> : <X />}驳回</Button>
    <Button size="xs" variant="destructive" disabled={disabled || busy != null} onClick={() => void act("takedown")}>{busy === "takedown" ? <Loader2 className="animate-spin" /> : <Trash2 />}下架</Button>
    {error ? <span role="alert" className="text-meta text-danger">{error}</span> : null}
  </div>;
}
