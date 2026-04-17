"use client";

import { useState } from "react";
import { Trash2, X, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
  onDeleted: () => void;
}

export function BulkActionBar({ selectedIds, onClear, onDeleted }: BulkActionBarProps) {
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [expiredDialog, setExpiredDialog] = useState(false);
  const [expiredPreview, setExpiredPreview] = useState<number | null>(null);
  const [expiredDays, setExpiredDays] = useState(30);

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/projects/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      onDeleted();
      onClear();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setLoading(false);
      setConfirm(false);
    }
  }

  async function openExpiredDialog() {
    setExpiredDialog(true);
    setExpiredPreview(null);
    try {
      const res = await fetch(`/api/projects/bulk-delete?days=${expiredDays}`);
      const data = await res.json();
      setExpiredPreview(data.expiredCount ?? 0);
    } catch {
      setExpiredPreview(0);
    }
  }

  async function refreshExpiredPreview(days: number) {
    setExpiredDays(days);
    setExpiredPreview(null);
    try {
      const res = await fetch(`/api/projects/bulk-delete?days=${days}`);
      const data = await res.json();
      setExpiredPreview(data.expiredCount ?? 0);
    } catch {
      setExpiredPreview(0);
    }
  }

  async function handleDeleteExpired() {
    setLoading(true);
    try {
      const res = await fetch("/api/projects/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeExpiredDays: expiredDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      onDeleted();
      onClear();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setLoading(false);
      setExpiredDialog(false);
    }
  }

  return (
    <>
      {/* Floating action bar */}
      <div
        className={cn(
          "fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transition-all duration-200",
          selectedIds.length === 0
            ? "pointer-events-none translate-y-4 opacity-0"
            : "pointer-events-auto translate-y-0 opacity-100",
        )}
      >
        <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <span className="text-sm text-foreground">
            已选择 <span className="font-semibold text-primary">{selectedIds.length}</span> 项
          </span>
          <div className="h-5 w-px bg-border" />
          <button
            onClick={openExpiredDialog}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Clock className="h-3.5 w-3.5" />
            清理过期
          </button>
          <button
            onClick={() => setConfirm(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除选中
          </button>
          <button
            onClick={onClear}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="取消选择"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Delete selected confirmation */}
      {confirm && (
        <Modal onClose={() => !loading && setConfirm(false)}>
          <h3 className="text-base font-semibold text-foreground">确认删除选中项目？</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            即将删除 <span className="font-semibold text-foreground">{selectedIds.length}</span> 个项目，
            同时清理它们的视频、缩略图和上传图片。此操作不可撤销。
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setConfirm(false)}
              disabled={loading}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "删除中" : "确认删除"}
            </button>
          </div>
        </Modal>
      )}

      {/* Expired cleanup dialog */}
      {expiredDialog && (
        <Modal onClose={() => !loading && setExpiredDialog(false)}>
          <h3 className="text-base font-semibold text-foreground">一键清理过期作品</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            清除已完成、超过指定天数仍未使用的项目，释放云存储空间。
          </p>

          <div className="mt-5 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">过期天数</label>
            <div className="flex flex-wrap gap-2">
              {[7, 14, 30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => refreshExpiredPreview(d)}
                  disabled={loading}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    expiredDays === d
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {d} 天
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-md border border-border bg-background/40 px-3 py-2.5 text-sm">
            {expiredPreview === null ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                查询中...
              </div>
            ) : expiredPreview === 0 ? (
              <p className="text-muted-foreground">没有找到符合条件的过期项目 🎉</p>
            ) : (
              <p className="text-foreground">
                找到 <span className="font-semibold text-destructive">{expiredPreview}</span>{" "}
                个项目将被删除（状态为已完成，最后更新时间超过 {expiredDays} 天）。
              </p>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setExpiredDialog(false)}
              disabled={loading}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleDeleteExpired}
              disabled={loading || expiredPreview === 0 || expiredPreview === null}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "清理中" : `确认清理`}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-xl border border-border bg-card p-5 shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}
