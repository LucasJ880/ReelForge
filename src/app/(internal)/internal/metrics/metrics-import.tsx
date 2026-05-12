"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MetricsImport() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    Array<{ post: string; ok: boolean; reason?: string }>
  >([]);

  async function handleSubmit() {
    if (!csv.trim()) {
      toast.error("请粘贴 CSV 内容");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/metrics/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: csv,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "导入失败");
      }
      const data = await res.json();
      setResult(data.results ?? []);
      const ok = (data.results as { ok: boolean }[]).filter((r) => r.ok).length;
      toast.success(`已导入 ${ok} 条`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          必需列：external_post_id, window_hours (12/24/48)，可选列：views,
          completion_rate, retention_3s, shares, saves, likes, comments
        </span>
        <a
          href="/api/metrics/import"
          download="metrics-template.csv"
          className="text-primary hover:underline"
        >
          下载模板
        </a>
      </div>
      <textarea
        rows={10}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        className="w-full rounded-md border border-input bg-card p-3 font-mono text-xs"
        placeholder={`external_post_id,window_hours,views,completion_rate,retention_3s,shares,saves,likes,comments\n7012345,24,120000,0.35,0.65,240,800,4500,120`}
      />
      <div className="flex justify-end">
        <Button disabled={busy} onClick={handleSubmit}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          上传 CSV
        </Button>
      </div>
      {result.length > 0 && (
        <div className="rounded border border-border/60 p-3 text-xs">
          <div className="mb-1 font-medium">导入结果</div>
          <ul className="space-y-0.5">
            {result.map((r, i) => (
              <li key={i} className={r.ok ? "text-emerald-400" : "text-destructive"}>
                {r.post}: {r.ok ? "ok" : `失败 (${r.reason})`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
