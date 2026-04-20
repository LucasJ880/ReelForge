"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LOCALES } from "@/lib/services/localization-service";

export function NewOrderForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    targetLocale: "en-US",
    sku: "",
    url: "",
    material: "",
    size: "",
    gsm: "",
    priceUsd: "",
    hint: "",
    imageUrls: "",
    maxRounds: 3,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const locale =
        SUPPORTED_LOCALES.find((l) => l.code === form.targetLocale) ??
        SUPPORTED_LOCALES[0];

      const payload = {
        title: form.title,
        targetCountry: locale.country,
        targetLanguage: locale.language,
        targetRegionVariant: locale.code,
        maxRounds: Number(form.maxRounds) || 3,
        productInput: {
          sku: form.sku || undefined,
          url: form.url || undefined,
          material: form.material || undefined,
          size: form.size || undefined,
          gsm: form.gsm ? Number(form.gsm) : undefined,
          price_usd: form.priceUsd ? Number(form.priceUsd) : undefined,
          hint: form.hint || undefined,
          image_urls: form.imageUrls
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      };

      const res = await fetch("/api/delivery-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建失败");
      }
      const data = await res.json();
      toast.success("交付单已创建");
      router.push(`/orders/${data.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="交付单标题" required>
        <input
          type="text"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="例：毛毯 A 款 · 圣诞档"
          className={INPUT}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="目标市场 / 语言" required>
          <select
            value={form.targetLocale}
            onChange={(e) => setForm({ ...form, targetLocale: e.target.value })}
            className={INPUT}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="最大赛马轮次" hint="默认 3 轮，可提前结算">
          <input
            type="number"
            min={1}
            max={6}
            value={form.maxRounds}
            onChange={(e) => setForm({ ...form, maxRounds: Number(e.target.value) })}
            className={INPUT}
          />
        </Field>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-secondary/30 p-4">
        <h3 className="text-sm font-medium">产品信息</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="SKU">
            <input
              type="text"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className={INPUT}
            />
          </Field>
          <Field label="产品链接（Amazon/独立站）">
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://…"
              className={INPUT}
            />
          </Field>
          <Field label="材质">
            <input
              type="text"
              value={form.material}
              onChange={(e) => setForm({ ...form, material: e.target.value })}
              placeholder="Microfiber Flannel"
              className={INPUT}
            />
          </Field>
          <Field label="尺寸">
            <input
              type="text"
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
              placeholder="50x60 inch"
              className={INPUT}
            />
          </Field>
          <Field label="克重 GSM">
            <input
              type="number"
              value={form.gsm}
              onChange={(e) => setForm({ ...form, gsm: e.target.value })}
              className={INPUT}
            />
          </Field>
          <Field label="售价（USD）">
            <input
              type="number"
              step="0.01"
              value={form.priceUsd}
              onChange={(e) => setForm({ ...form, priceUsd: e.target.value })}
              className={INPUT}
            />
          </Field>
        </div>
        <Field
          label="产品主图 / 参考图 URL"
          hint="多张用空格、逗号或换行分隔，最多 5 张"
        >
          <textarea
            rows={3}
            value={form.imageUrls}
            onChange={(e) => setForm({ ...form, imageUrls: e.target.value })}
            className={`${INPUT} font-mono text-xs`}
            placeholder="https://…/main.jpg"
          />
        </Field>
        <Field label="卖点提示 / 特殊备注">
          <textarea
            rows={3}
            value={form.hint}
            onChange={(e) => setForm({ ...form, hint: e.target.value })}
            className={INPUT}
            placeholder="例：主打亲肤 + 圣诞礼物场景 + 主色焦糖/奶白两款"
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          创建交付单
        </Button>
      </div>
    </form>
  );
}

const INPUT =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="block text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  );
}
