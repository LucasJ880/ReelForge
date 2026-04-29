"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RoundActions({
  round,
}: {
  round: { id: string; status: string; angles: { id: string }[]; deliveryOrderId: string };
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
      toast.success(`${label} 已触发`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const canGenerateAngles = round.angles.length === 0;
  const canGenerateAdPlans = round.angles.length > 0;
  const canScore = round.status === "LIVE" || round.status === "METRICS_WINDOWS_PENDING";
  const canDistill = round.status === "RANKED";

  return (
    <div className="flex gap-2">
      {canGenerateAngles && (
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() =>
            call("生成 Angles", `/api/rounds/${round.id}/angles`, {})
          }
        >
          {busy === "生成 Angles" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          生成 5 条 Angle
        </Button>
      )}
      {canGenerateAdPlans && (
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => call("生成广告剪辑计划", `/api/rounds/${round.id}/ad-plans`, { count: 5 })}
        >
          {busy === "生成广告剪辑计划" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          生成 5 条广告
        </Button>
      )}
      {canScore && (
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => call("打分", `/api/rounds/${round.id}/score`)}
        >
          {busy === "打分" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          打分 + 排名
        </Button>
      )}
      {canScore && (
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => call("复盘 + 下一轮", `/api/rounds/${round.id}/iteration`)}
        >
          {busy === "复盘 + 下一轮" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          复盘 + 下一轮
        </Button>
      )}
      {canDistill && (
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() => call("蒸馏", `/api/rounds/${round.id}/distill`)}
        >
          {busy === "蒸馏" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          蒸馏特征
        </Button>
      )}
    </div>
  );
}
