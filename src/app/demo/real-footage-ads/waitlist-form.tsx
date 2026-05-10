"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function RealFootageWaitlistForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState("submitting");
    setMessage("");

    const form = new FormData(formElement);
    const payload = {
      name: String(form.get("name") || ""),
      businessType: String(form.get("businessType") || ""),
      monthlyVolume: String(form.get("monthlyVolume") || ""),
      painPoint: String(form.get("painPoint") || ""),
      email: String(form.get("email") || ""),
    };

    try {
      const res = await fetch("/api/demo/real-footage-ads/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error || "提交失败，请稍后重试。");
      setState("success");
      setMessage(data.message || "已收到，我们会联系你安排 demo。");
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
      return;
    }

    try {
      formElement.reset();
    } catch {
      // Reset is a UI convenience; a successful lead submission should remain successful.
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="姓名" name="name" placeholder="如：陈先生" required />
        <Field
          label="邮箱"
          name="email"
          type="email"
          placeholder="you@company.com"
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="行业 / 业务类型"
          name="businessType"
          placeholder="例如：地产经纪、宠物店、本地服务、代运营机构…"
          required
        />
        <label className="grid gap-2 text-sm">
          <span className="text-muted-foreground">每月发布的视频量</span>
          <select
            name="monthlyVolume"
            required
            className="h-11 rounded-2xl border border-white/12 bg-background/70 px-3 text-sm outline-none transition focus:border-primary"
            defaultValue=""
          >
            <option value="" disabled>
              选择范围
            </option>
            <option value="1-10">每月 1-10 条</option>
            <option value="11-50">每月 11-50 条</option>
            <option value="51-200">每月 51-200 条</option>
            <option value="200+">每月 200 条以上</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="text-muted-foreground">最大的痛点是什么？</span>
        <textarea
          name="painPoint"
          required
          rows={4}
          maxLength={800}
          placeholder="目前是什么环节最拖慢或最贵？例如：脚本拖太久、剪辑师排不开、不知道怎么拍。"
          className="resize-none rounded-2xl border border-white/12 bg-background/70 px-3 py-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary"
        />
      </label>
      <button
        type="submit"
        disabled={state === "submitting"}
        className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "submitting" && <Loader2 size={16} className="animate-spin" />}
        提交体验申请
      </button>
      {message && (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            state === "success"
              ? "bg-emerald-500/10 text-emerald-200"
              : "bg-red-500/10 text-red-200"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        maxLength={160}
        placeholder={placeholder}
        className="h-11 rounded-2xl border border-white/12 bg-background/70 px-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary"
      />
    </label>
  );
}
