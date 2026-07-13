"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACTION_BUTTON_LABELS } from "@/lib/labels-user";

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
  const isInflight =
    brief.status === "RENDERING" || brief.status === "RENDER_QUEUED";

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant={hasScript ? "outline" : "default"}
        disabled={!!busy}
        onClick={() => call("生成视频脚本", `/api/briefs/${brief.id}/script`)}
      >
        {busy === "生成视频脚本" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
        {hasScript ? ACTION_BUTTON_LABELS.rewriteScript : ACTION_BUTTON_LABELS.generateScript}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy || !hasScript}
        onClick={() =>
          call("生成分镜", `/api/briefs/${brief.id}/scenes`, { generatePrompts: true })
        }
      >
        {busy === "生成分镜" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
        {ACTION_BUTTON_LABELS.generateScenes}
      </Button>
      <Button
        size="sm"
        disabled={!!busy || isInflight}
        title={
          isInflight
            ? "已经有视频生成请求在处理中，请等结果出来或先点「刷新状态」"
            : undefined
        }
        onClick={() => call("生成视频", `/api/briefs/${brief.id}/render`)}
      >
        {busy === "生成视频" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
        {ACTION_BUTTON_LABELS.generateVideo}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy}
        onClick={() => call("生成剪辑计划", `/api/briefs/${brief.id}/ad-plan`)}
      >
        {busy === "生成剪辑计划" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
        {ACTION_BUTTON_LABELS.generateAdEditPlan}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy || !hasAdEditPlan}
        onClick={() =>
          call("渲染剪辑计划", `/api/briefs/${brief.id}/render`, { mode: "ad_edit_plan" })
        }
      >
        {busy === "渲染剪辑计划" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
        {ACTION_BUTTON_LABELS.renderAdEditPlan}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy}
        onClick={() => call("质量检查", `/api/briefs/${brief.id}/qa`)}
      >
        {busy === "质量检查" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
        {ACTION_BUTTON_LABELS.runQA}
      </Button>
    </div>
  );
}
