"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BriefActions({
  brief,
}: {
  brief: {
    id: string;
    status: string;
    scripts: { id: string }[];
    adEditPlans?: { id: string; status: string }[];
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(label: string, url: string, body?: unknown) {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "请求失败");
      }
      toast.success(`${label} 已完成`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const hasScript = brief.scripts.length > 0;
  const hasAdEditPlan = (brief.adEditPlans?.length ?? 0) > 0;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant={hasScript ? "outline" : "default"}
        disabled={!!busy}
        onClick={() => call("生成脚本", `/api/briefs/${brief.id}/script`)}
      >
        {busy === "生成脚本" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {hasScript ? "重写脚本" : "生成脚本"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy || !hasScript}
        onClick={() => call("分镜+Prompt", `/api/briefs/${brief.id}/scenes`, { generatePrompts: true })}
      >
        {busy === "分镜+Prompt" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        分镜 + Prompt
      </Button>
      <Button
        size="sm"
        disabled={!!busy}
        onClick={() => call("渲染视频", `/api/briefs/${brief.id}/render`)}
      >
        {busy === "渲染视频" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        触发渲染
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy}
        onClick={() => call("生成剪辑计划", `/api/briefs/${brief.id}/ad-plan`)}
      >
        {busy === "生成剪辑计划" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        真实素材计划
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy || !hasAdEditPlan}
        onClick={() => call("渲染剪辑计划", `/api/briefs/${brief.id}/render`, { mode: "ad_edit_plan" })}
      >
        {busy === "渲染剪辑计划" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        渲染剪辑计划
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy}
        onClick={() => call("AI 初审", `/api/briefs/${brief.id}/qa`)}
      >
        {busy === "AI 初审" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        AI 初审
      </Button>
    </div>
  );
}
