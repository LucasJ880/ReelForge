"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type SubmitState = "idle" | "submitting" | "success" | "error";

/**
 * 静态 demo 模式：导出到对象存储/CDN 的纯静态站点没有后端，
 * 构建时注入 NEXT_PUBLIC_STATIC_DEMO=true 即只 mock 提交（保留 UI、假成功），
 * 不设此变量时（线上 Vercel）走真实接口，行为不变。
 */
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "true";

/**
 * 宠物套件体验申请表单。
 *
 * 复用现有 /api/demo/real-footage-ads/waitlist 接口（不改后端），
 * 仅前端文案宠物化 + 暖色主题适配。
 */
export function PetWaitlistForm() {
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

    // 静态 demo：不连后端，模拟一次成功提交以保留完整交互体验。
    if (STATIC_DEMO) {
      await new Promise((r) => setTimeout(r, 600));
      setState("success");
      setMessage("已收到，我们会尽快联系你安排体验。");
      try {
        formElement.reset();
      } catch {
        /* reset 失败不影响提交成功状态 */
      }
      return;
    }

    try {
      const res = await fetch("/api/demo/real-footage-ads/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error || "提交失败，请稍后重试。");
      setState("success");
      setMessage(data.message || "已收到，我们会尽快联系你安排体验。");
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
      return;
    }

    try {
      formElement.reset();
    } catch {
      /* reset 失败不影响提交成功状态 */
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
          label="身份 / 角色"
          name="businessType"
          placeholder="例如：投资人、宠物品牌、宠物店、MCN / 代运营、宠物主…"
          required
        />
        <label className="grid gap-2 text-sm">
          <span className="text-muted-foreground">最感兴趣的方向</span>
          <select
            name="monthlyVolume"
            required
            className="h-11 rounded-(--radius-md) border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring"
            defaultValue=""
          >
            <option value="" disabled>
              选择方向
            </option>
            <option value="b2c">宠物主陪伴内容（B2C）</option>
            <option value="b2b">品牌真实使用证据（B2B）</option>
            <option value="community">宠物社区 / 增长生态</option>
            <option value="invest">投资 / 战略合作</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="text-muted-foreground">你想用 Aivora 解决什么？</span>
        <textarea
          name="painPoint"
          required
          rows={4}
          maxLength={800}
          placeholder="例如：想给自家宠物每天自动生成可爱视频；品牌想要真实使用证据素材；想了解投资机会。"
          className="resize-none rounded-(--radius-md) border border-input bg-background px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring"
        />
      </label>
      <button
        type="submit"
        disabled={state === "submitting"}
        className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-(--radius-md) bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "submitting" && <Loader2 size={16} aria-hidden />}
        提交体验申请
      </button>
      {message && (
        <p
          role={state === "error" ? "alert" : "status"}
          className={`rounded-(--radius-lg) px-4 py-3 text-sm ${
            state === "success"
              ? "border border-success bg-success/10 text-success"
              : "border border-danger bg-danger/10 text-danger"
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
        className="h-11 rounded-(--radius-md) border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring"
      />
    </label>
  );
}
