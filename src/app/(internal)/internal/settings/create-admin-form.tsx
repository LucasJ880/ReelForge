"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateAdminForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "OPERATOR" as "SUPER_ADMIN" | "OPERATOR" | "REVIEWER",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建失败");
      }
      toast.success("账号已创建");
      setForm({ email: "", name: "", password: "", role: "OPERATOR" });
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-3 md:grid-cols-4">
      <Input
        type="email"
        required
        aria-label="邮箱"
        placeholder="邮箱"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <Input
        type="text"
        aria-label="姓名"
        placeholder="姓名（可选）"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <Input
        type="password"
        required
        aria-label="密码"
        minLength={8}
        placeholder="密码（≥8 位）"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      <div className="flex gap-2">
        <select
          value={form.role}
          onChange={(e) =>
            setForm({
              ...form,
              role: e.target.value as typeof form.role,
            })
          }
          className="h-10 min-w-0 flex-1 rounded-(--radius-md) border border-input bg-card px-3 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="角色"
        >
          <option value="OPERATOR">运营</option>
          <option value="REVIEWER">审核员</option>
          <option value="SUPER_ADMIN">超级管理员</option>
        </select>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden /> : <UserPlus strokeWidth={1.5} aria-hidden />}
          新建
        </Button>
      </div>
    </form>
  );
}
