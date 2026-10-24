"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPulseRefresh } from "@/lib/exchange/pulse";

/**
 * 成品库「需要处理」的「看过了」：写 Workspace.failuresAckedAt（失败记录本身不动），
 * 然后刷新本页与壳层徽标——徽标与这一区是同一个查询，看过即同时清零。
 */
export function FailuresAckButton({
  copy,
}: {
  copy: { acknowledge: string; acknowledging: string; acknowledgeFailed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function acknowledge() {
    setBusy(true);
    try {
      const response = await fetch("/api/exchange/failures-ack", { method: "POST" });
      if (!response.ok) throw new Error(copy.acknowledgeFailed);
      requestPulseRefresh();
      router.refresh();
    } catch {
      toast.error(copy.acknowledgeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void acknowledge()} data-testid="failures-ack">
      <Check aria-hidden />
      {busy ? copy.acknowledging : copy.acknowledge}
    </Button>
  );
}
