"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play, Sparkles, Swords, XCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  order: {
    id: string;
    status: string;
    sellingPoints: { id: string }[];
    rounds: { id: string; status: string }[];
    maxRounds: number;
  };
}

export function OrderActions({ order }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    try {
      const res = await fn();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `请求失败: ${res.status}`);
      }
      toast.success(`${label} 已完成`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const canResearch = ["DRAFT", "RESEARCHING", "SELLING_POINTS_READY"].includes(
    order.status,
  );
  const canStartRound =
    order.sellingPoints.length > 0 &&
    order.rounds.length < order.maxRounds &&
    !["COMPLETED", "CANCELLED", "ROUND_ACTIVE", "VIDEOS_IN_FLIGHT"].includes(
      order.status,
    );

  const canFinalize = !["COMPLETED", "CANCELLED"].includes(order.status);

  return (
    <div className="flex items-center gap-2">
      {canResearch && (
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy}
          onClick={() =>
            call("调研 + 卖点", () =>
              fetch(`/api/delivery-orders/${order.id}/research`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phase: "all" }),
              }),
            )
          }
        >
          {busy === "调研 + 卖点" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          执行调研 + 卖点
        </Button>
      )}

      {canStartRound && (
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() =>
            call("开启新一轮", async () => {
              const res = await fetch(`/api/delivery-orders/${order.id}/rounds`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
              if (res.ok) {
                const round = await res.clone().json();
                toast.success(`第 ${round.roundIndex ?? "?"} 轮已创建`);
                router.push(`/rounds/${round.id}`);
              }
              return res;
            })
          }
        >
          {busy === "开启新一轮" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Swords className="h-3.5 w-3.5" />
          )}
          开启新一轮
        </Button>
      )}

      {canFinalize && (
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy}
          onClick={() =>
            call("提前结算", () =>
              fetch(`/api/delivery-orders/${order.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "finalize", reason: "运营手动结算" }),
              }),
            )
          }
        >
          <Check className="h-3.5 w-3.5" />
          提前结算
        </Button>
      )}

      {canFinalize && (
        <Button
          variant="destructive"
          size="sm"
          disabled={!!busy}
          onClick={() =>
            call("取消交付单", () =>
              fetch(`/api/delivery-orders/${order.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "cancel", reason: "运营取消" }),
              }),
            )
          }
        >
          <XCircle className="h-3.5 w-3.5" />
          取消
        </Button>
      )}
    </div>
  );
}
