"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Layers, ArrowRight, Trash2, Loader2, MoreHorizontal } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useIsPro } from "@/lib/hooks/use-role";

interface BatchItem {
  id: string;
  name: string;
  status: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
  _count: { projects: number };
}

const statusConfig: Record<string, { label: string; dot: string; textClass: string }> = {
  PENDING: { label: "等待中", dot: "bg-muted-foreground/60", textClass: "text-muted-foreground" },
  RUNNING: { label: "执行中", dot: "bg-primary animate-pulse", textClass: "text-primary" },
  PAUSED: { label: "已暂停", dot: "bg-amber-400", textClass: "text-amber-400" },
  COMPLETED: { label: "已完成", dot: "bg-emerald-500", textClass: "text-emerald-400" },
  FAILED: { label: "失败", dot: "bg-red-500", textClass: "text-red-400" },
};

export default function BatchListPage() {
  const isPro = useIsPro();
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/batches");
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches || data || []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onDocClick() {
      setMenuOpenId(null);
    }
    if (menuOpenId) {
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }
  }, [menuOpenId]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-1">
            生产队列
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">批量任务</h1>
        </div>
        {isPro && (
          <Link
            href="/batches/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            新建批次
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-20">
          <Layers className="h-8 w-8 text-muted-foreground/70 mx-auto mb-4" />
          <p className="text-muted-foreground text-sm mb-6">暂无批量任务</p>
          {isPro && (
            <Link
              href="/batches/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              创建批次
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              canManage={isPro}
              menuOpen={menuOpenId === batch.id}
              onMenuToggle={(next) => setMenuOpenId(next ? batch.id : null)}
              onDeleted={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BatchRow({
  batch,
  canManage,
  menuOpen,
  onMenuToggle,
  onDeleted,
}: {
  batch: BatchItem;
  canManage: boolean;
  menuOpen: boolean;
  onMenuToggle: (next: boolean) => void;
  onDeleted: () => void;
}) {
  const s = statusConfig[batch.status] || statusConfig.PENDING;
  const pct =
    batch.totalCount > 0
      ? Math.round(((batch.completedCount + batch.failedCount) / batch.totalCount) * 100)
      : 0;
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(cascade: boolean) {
    const msg = cascade
      ? `确定级联删除批次「${batch.name}」及其下 ${batch._count.projects} 个项目（含视频资产）？此操作不可撤销。`
      : `确定删除批次「${batch.name}」？其下已生成的作品会保留在作品库。`;
    if (!window.confirm(msg)) return;

    setDeleting(true);
    try {
      const url = `/api/batches/${batch.id}${cascade ? "?cascade=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success(cascade ? "批次及作品已删除" : "批次已清理，作品保留");
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
      onMenuToggle(false);
    }
  }

  return (
    <div className="group relative flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-border hover:bg-accent/40">
      <Link href={`/batches/${batch.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn("h-2 w-2 rounded-full shrink-0", s.dot)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">{batch.name}</p>
            <span className={cn("text-[11px]", s.textClass)}>{s.label}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {batch._count.projects} 个项目 · {batch.completedCount} 完成
            {batch.failedCount > 0 && ` · ${batch.failedCount} 失败`}
            {" · "}
            {formatDate(batch.createdAt)}
          </p>
        </div>
      </Link>

      <div className="flex items-center gap-3 shrink-0">
        <div className="w-20 h-1 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {pct}%
        </span>

        {canManage && (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMenuToggle(!menuOpen);
              }}
              aria-label="更多操作"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-3.5 w-3.5" />
              )}
            </button>

            {menuOpen && !deleting && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-popover shadow-xl"
              >
                <button
                  type="button"
                  onClick={() => handleDelete(false)}
                  className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
                >
                  <Trash2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block font-medium">清理批次</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      保留已生成的作品
                    </span>
                  </span>
                </button>
                <div className="border-t border-border" />
                <button
                  type="button"
                  onClick={() => handleDelete(true)}
                  className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    <span className="block font-medium">级联删除</span>
                    <span className="mt-0.5 block text-[11px] text-red-400/70">
                      连同 {batch._count.projects} 个项目 + 视频一并清除
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
