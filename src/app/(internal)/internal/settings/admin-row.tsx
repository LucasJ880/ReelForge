"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "SUPER_ADMIN" | "OPERATOR" | "REVIEWER";
    createdAtText: string;
  };
  isSelf: boolean;
  roleLabel: string;
}

export function AdminRow({ user, isSelf, roleLabel }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function changeRole(role: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error("失败");
      toast.success("角色已更新");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`确认删除 ${user.email}？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "失败");
      }
      toast.success("已删除");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-border/40">
      <td className="py-2">{user.email}</td>
      <td>{user.name ?? "—"}</td>
      <td>
        {isSelf ? (
          <span className="text-xs text-muted-foreground">{roleLabel} (自己)</span>
        ) : (
          <select
            disabled={busy}
            value={user.role}
            onChange={(e) => changeRole(e.target.value)}
            className="rounded border border-input bg-card px-2 py-1 text-xs"
          >
            <option value="OPERATOR">运营</option>
            <option value="REVIEWER">审核员</option>
            <option value="SUPER_ADMIN">超级管理员</option>
          </select>
        )}
      </td>
      <td className="text-xs text-muted-foreground">{user.createdAtText}</td>
      <td className="text-right">
        {!isSelf && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={remove}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    </tr>
  );
}
