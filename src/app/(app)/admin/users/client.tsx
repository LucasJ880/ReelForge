"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Crown, Shield, UserCheck, UserX, Loader2 } from "lucide-react";
import type { AdminUserRow } from "@/lib/services/subscription-service";

export function AdminUsersClient({
  initialUsers,
  initialQuery,
}: {
  initialUsers: AdminUserRow[];
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [users, setUsers] = useState(initialUsers);
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    startTransition(() => {
      router.replace(`/admin/users${params.size ? `?${params}` : ""}`);
    });
  }

  async function grant(userId: string) {
    const daysStr = window.prompt("开通/续期天数（默认 30）", "30");
    if (daysStr === null) return;
    const days = Math.max(1, parseInt(daysStr, 10) || 30);
    setBusy(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/grant-pro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                planTier: "PRO",
                planExpiresAt: data.user.planExpiresAt,
                planSource: "admin-manual",
              }
            : u,
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(userId: string) {
    if (!window.confirm("确认撤销该用户的 Pro 订阅？")) return;
    setBusy(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/revoke-pro`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? { ...u, planTier: "FREE", planExpiresAt: null, planSource: "none" }
            : u,
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
          管理后台
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-white">
          用户与订阅
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          共 {users.length} 位用户 · 可手动开通 / 撤销 Pro
        </p>
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索邮箱或昵称..."
            className="w-full rounded-md border border-white/10 bg-card/60 pl-9 pr-3 py-2 text-sm text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md border border-white/10 bg-card/60 px-3 py-2 text-sm text-white hover:bg-card disabled:opacity-60"
        >
          搜索
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-white/5">
        <table className="w-full text-sm">
          <thead className="bg-card/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">用户</th>
              <th className="px-4 py-3 text-left font-medium">角色</th>
              <th className="px-4 py-3 text-left font-medium">订阅</th>
              <th className="px-4 py-3 text-left font-medium">到期</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map((u) => {
              const expiresAt = u.planExpiresAt ? new Date(u.planExpiresAt) : null;
              const isActivePro =
                u.planTier === "PRO" &&
                !!expiresAt &&
                expiresAt.getTime() > Date.now();
              const daysLeft = expiresAt
                ? Math.ceil(
                    (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
                  )
                : null;

              return (
                <tr key={u.id} className="bg-card/20 hover:bg-card/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-white">{u.name || "—"}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {u.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "ADMIN" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-[11px] px-2 py-0.5 font-medium">
                        <Shield className="h-3 w-3" /> ADMIN
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">USER</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isActivePro ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-[11px] px-2 py-0.5 font-medium">
                        <Crown className="h-3 w-3" /> PRO
                      </span>
                    ) : u.planTier === "PRO" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-300 text-[11px] px-2 py-0.5 font-medium">
                        已过期
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">FREE</span>
                    )}
                    {u.planSource !== "none" && (
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        来源: {u.planSource}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {expiresAt ? (
                      <>
                        <div className="text-white/90">
                          {expiresAt.toLocaleDateString("zh-CN")}
                        </div>
                        {daysLeft != null && (
                          <div className="text-[10px] mt-0.5">
                            {daysLeft > 0 ? `剩余 ${daysLeft} 天` : "已过期"}
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.role === "ADMIN" ? (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => grant(u.id)}
                          disabled={busy === u.id}
                          className="inline-flex items-center gap-1 rounded-md bg-primary/90 hover:bg-primary text-primary-foreground text-[11px] px-2.5 py-1.5 font-medium disabled:opacity-50"
                        >
                          {busy === u.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <UserCheck className="h-3 w-3" />
                          )}
                          {isActivePro ? "续期" : "开通 Pro"}
                        </button>
                        {isActivePro && (
                          <button
                            onClick={() => revoke(u.id)}
                            disabled={busy === u.id}
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-card hover:bg-card/80 text-white text-[11px] px-2.5 py-1.5 font-medium disabled:opacity-50"
                          >
                            <UserX className="h-3 w-3" />
                            撤销
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  没有匹配的用户
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
