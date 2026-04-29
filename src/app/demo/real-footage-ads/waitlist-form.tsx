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
    setState("submitting");
    setMessage("");

    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" placeholder="Evan Chen" required />
        <Field
          label="Email"
          name="email"
          type="email"
          placeholder="you@company.com"
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Business type"
          name="businessType"
          placeholder="DTC brand, local service, agency..."
          required
        />
        <label className="grid gap-2 text-sm">
          <span className="text-muted-foreground">Monthly ad/video volume</span>
          <select
            name="monthlyVolume"
            required
            className="h-11 rounded-2xl border border-white/12 bg-background/70 px-3 text-sm outline-none transition focus:border-primary"
            defaultValue=""
          >
            <option value="" disabled>
              Select range
            </option>
            <option value="1-10">1-10 videos/month</option>
            <option value="11-50">11-50 videos/month</option>
            <option value="51-200">51-200 videos/month</option>
            <option value="200+">200+ videos/month</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="text-muted-foreground">Biggest pain point</span>
        <textarea
          name="painPoint"
          required
          rows={4}
          maxLength={800}
          placeholder="What makes short-form ad production slow or expensive today?"
          className="resize-none rounded-2xl border border-white/12 bg-background/70 px-3 py-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary"
        />
      </label>
      <button
        type="submit"
        disabled={state === "submitting"}
        className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "submitting" && <Loader2 size={16} className="animate-spin" />}
        Request demo access
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
