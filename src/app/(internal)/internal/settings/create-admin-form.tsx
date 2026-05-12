"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
      <input
        type="email"
        required
        placeholder="邮箱"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        className="rounded-md border border-input bg-card px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="姓名（可选）"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className="rounded-md border border-input bg-card px-3 py-2 text-sm"
      />
      <input
        type="password"
        required
        minLength={8}
        placeholder="密码（≥8 位）"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        className="rounded-md border border-input bg-card px-3 py-2 text-sm"
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
          className="flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm"
        >
          <option value="OPERATOR">运营</option>
          <option value="REVIEWER">审核员</option>
          <option value="SUPER_ADMIN">超级管理员</option>
        </select>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          新建
        </Button>
      </div>
    </form>
  );
}
