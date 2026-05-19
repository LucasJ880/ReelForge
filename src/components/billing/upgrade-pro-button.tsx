"use client";

import { useState } from "react";

export function UpgradeProButton({ disabled }: { disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpgrade() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const j = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !j.url) {
        throw new Error(j.error ?? "无法打开结账页面");
      }
      window.location.href = j.url;
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void onUpgrade()}
        disabled={disabled || loading}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {loading ? "跳转中…" : "升级到 Pro"}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
