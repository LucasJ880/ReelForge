"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "SUPER_ADMIN" | "OPERATOR" | "REVIEWER";
    createdAtText: string;
    /// 已停用（disabledAt 非空）。停用取代删除：数据全保留、可恢复。
    disabled?: boolean;
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

  /**
   * 停用取代删除（A4 5.1）：删除会沿级联删光名下全部业务数据，违反「只归档不删除」。
   * 停用只拦登录与会话，并取消未开始的排队任务；数据全部保留，可随时恢复。
   */
  async function disable() {
    const reason = window.prompt(
      `停用 ${user.email}？\n停用后无法登录，未开始的排队任务会被取消；名下数据全部保留，可随时恢复。\n请填写停用原因：`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error("请填写停用原因");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "停用失败");
      toast.success(
        data.cancelledVideoJobs > 0
          ? `已停用，取消了 ${data.cancelledVideoJobs} 条未开始的任务`
          : "已停用",
      );
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    if (!confirm(`恢复 ${user.email}？恢复后可以重新登录。`)) return;
    setBusy(true);
    try {
      /// 解除停用 = 删掉「停用」这个子资源；账号本身永远不删。
      const res = await fetch(`/api/admin/users/${user.id}/disable`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "恢复失败");
      toast.success("已恢复");
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
        {!isSelf && user.disabled ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-meta text-muted-foreground">已停用</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={enable}
              aria-label={`恢复 ${user.email}`}
            >
              <RotateCcw strokeWidth={1.5} aria-hidden />
              恢复
            </Button>
          </span>
        ) : null}
        {!isSelf && !user.disabled ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={disable}
            className="text-danger hover:text-danger"
            aria-label={`停用 ${user.email}`}
          >
            <UserX strokeWidth={1.5} aria-hidden />
            停用
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
