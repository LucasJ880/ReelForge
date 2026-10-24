"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/i18n/config";
import { SELF_REPORTED_SOURCES, getGrowthCopy } from "@/i18n/growth-copy";
import { Field, FormAlert, NativeSelect } from "./form-fields";
import { compact, sendJson } from "./leads-api";

const EMPTY = { name: "", phone: "", email: "", serviceInterest: "", selfReportedSource: "", message: "" };

/** 手工登记（电话、到店、熟人介绍）：与公开表单同一套 7 天去重，合并时明确告诉商家。 */
export function ManualLeadForm({ locale }: { locale: Locale }) {
  const growth = getGrowthCopy(locale);
  const copy = growth.leads;
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const set = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!form.name.trim()) return setNotice({ tone: "error", text: growth.leadForm.invalid });
    if (!form.phone.trim() && !form.email.trim()) return setNotice({ tone: "error", text: copy.manualContactRequired });
    setBusy(true);
    const result = await sendJson<{ deduped?: boolean }>("/api/leads", "POST", compact(form));
    setBusy(false);
    if (!result.ok) {
      return setNotice({
        tone: "error",
        text: result.reason === "phone_invalid" ? growth.leadForm.phoneInvalid : result.reason === "contact_required" ? copy.manualContactRequired : copy.actionFailed,
      });
    }
    setForm(EMPTY);
    setNotice({ tone: "info", text: result.data.deduped ? copy.manualDeduped : copy.manualCreated });
    router.refresh();
  }

  return (
    <form onSubmit={submit} aria-label={copy.manualTitle} className="x-panel min-w-0 space-y-4 p-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="manual-name" label={growth.leadForm.name}>
          <Input id="manual-name" value={form.name} onChange={set("name")} maxLength={80} required />
        </Field>
        <Field id="manual-phone" label={growth.leadForm.phone}>
          <Input id="manual-phone" type="tel" value={form.phone} onChange={set("phone")} maxLength={32} />
        </Field>
        <Field id="manual-email" label={growth.leadForm.email}>
          <Input id="manual-email" type="email" value={form.email} onChange={set("email")} maxLength={254} />
        </Field>
        <Field id="manual-service" label={growth.leadForm.service}>
          <Input id="manual-service" value={form.serviceInterest} onChange={set("serviceInterest")} placeholder={growth.leadForm.servicePlaceholder} maxLength={120} />
        </Field>
      </div>
      <Field id="manual-source" label={growth.leadForm.source}>
        <NativeSelect id="manual-source" value={form.selfReportedSource} onChange={set("selfReportedSource")}>
          <option value="">{growth.leadForm.choose}</option>
          {SELF_REPORTED_SOURCES.map((key) => (
            <option key={key} value={key}>
              {growth.selfReported[key]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="manual-message" label={growth.leadForm.message}>
        <Textarea id="manual-message" value={form.message} onChange={set("message")} maxLength={1000} className="min-h-16" />
      </Field>
      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {copy.manualSubmit}
      </Button>
    </form>
  );
}
