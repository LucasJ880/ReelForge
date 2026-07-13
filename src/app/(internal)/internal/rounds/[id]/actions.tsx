"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACTION_BUTTON_LABELS } from "@/lib/labels-user";

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
    <div className="flex min-w-0 flex-wrap gap-2">
      {canGenerateAngles && (
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() =>
            call("生成创意方向", `/api/rounds/${round.id}/angles`, {})
          }
        >
          {busy === "生成创意方向" ? <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden /> : null}
          {ACTION_BUTTON_LABELS.generateAngles}
        </Button>
      )}
      {canGenerateAdPlans && (
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => call("生成创意版本", `/api/rounds/${round.id}/ad-plans`, { count: 5 })}
        >
          {busy === "生成创意版本" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
          {ACTION_BUTTON_LABELS.generateAds}
        </Button>
      )}
      {canScore && (
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => call("打分", `/api/rounds/${round.id}/score`)}
        >
          {busy === "打分" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
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
          {busy === "复盘 + 下一轮" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
          复盘 + 下一轮
        </Button>
      )}
      {canDistill && (
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() => call("蒸馏", `/api/rounds/${round.id}/distill`)}
        >
          {busy === "蒸馏" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
          蒸馏特征
        </Button>
      )}
    </div>
  );
}
