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
    <tr className="border-t border-border">
      <td className="py-2">{user.email}</td>
      <td>{user.name ?? "—"}</td>
      <td>
        {isSelf ? (
          <span className="text-meta text-muted-foreground">{roleLabel} (自己)</span>
        ) : (
          <select
            disabled={busy}
            value={user.role}
            onChange={(e) => changeRole(e.target.value)}
            className="h-10 rounded-(--radius-md) border border-input bg-card px-3 text-meta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`${user.email} 的角色`}
          >
            <option value="OPERATOR">运营</option>
            <option value="REVIEWER">审核员</option>
            <option value="SUPER_ADMIN">超级管理员</option>
          </select>
        )}
      </td>
      <td className="text-meta text-muted-foreground">{user.createdAtText}</td>
      <td className="text-right">
        {!isSelf && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={remove}
            className="text-danger hover:text-danger"
            aria-label={`删除 ${user.email}`}
          >
            <Trash2 strokeWidth={1.5} aria-hidden />
          </Button>
        )}
      </td>
    </tr>
  );
}
