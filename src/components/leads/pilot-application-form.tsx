"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusTick } from "@/components/exchange/status-tick";
import type { Locale } from "@/i18n/config";
import {
  MONTHLY_LEAD_SPEND,
  PILOT_CONSENT_VERSION,
  fillGrowth,
  getGrowthCopy,
} from "@/i18n/growth-copy";
import { ConsentCheckbox, Field, FormAlert, HoneypotField, NativeSelect } from "./form-fields";
import { compact, sendJson } from "./leads-api";

const EMPTY = {
  name: "",
  company: "",
  industry: "",
  city: "",
  email: "",
  phone: "",
  whatsapp: "",
  wechat: "",
  website: "",
  monthlyLeadSpend: "",
  message: "",
};

type FormState = typeof EMPTY;

/**
 * 公开首页「申请 30 天试点」：至少一种联系方式 + 同意（带版本号）。
 * 蜜罐字段 faxNumber 由服务端识别；限流与故障时给出备用邮箱（有配置才给）。
 */
export function PilotApplicationForm({ locale, fallbackEmail }: { locale: Locale; fallbackEmail: string | null }) {
  const copy = getGrowthCopy(locale).pilotForm;
  const spendCopy = getGrowthCopy(locale).spend;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const hasContact = [form.email, form.phone, form.whatsapp, form.wechat].some((value) => value.trim());

  function messageFor(reason: string, email?: string): string {
    const withContact = (text: string) => {
      const contact = email ?? fallbackEmail;
      return contact ? `${text} ${fillGrowth(copy.rateLimitedContact, { email: contact })}` : text;
    };
    if (reason === "contact_required") return copy.contactRequired;
    if (reason === "consent_required") return copy.consentRequired;
    if (reason === "invalid" || reason === "phone_invalid") return copy.invalid;
    if (reason === "rate_limited") return withContact(copy.rateLimited);
    return withContact(copy.genericError);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!hasContact) return setError(copy.contactRequired);
    if (!consent) return setError(copy.consentRequired);
    setState("submitting");
    const result = await sendJson("/api/public/pilot-applications", "POST", {
      ...compact(form),
      monthlyLeadSpend: form.monthlyLeadSpend || null,
      locale,
      consent: true,
      consentVersion: PILOT_CONSENT_VERSION,
      faxNumber: honeypot,
    });
    if (result.ok) {
      setState("done");
      return;
    }
    setState("idle");
    setError(messageFor(result.reason, result.fallbackEmail));
  }

  if (state === "done") {
    return (
      <div role="status" className="space-y-3 px-6 py-10" data-pilot-application="submitted">
        <StatusTick tone="filled" label={copy.successTitle} />
        <p className="text-body text-muted-foreground">{copy.successBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} aria-label={copy.label} className="relative min-w-0 space-y-5 p-5 sm:p-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pilot-name" label={copy.name}>
          <Input id="pilot-name" value={form.name} onChange={set("name")} autoComplete="name" maxLength={80} />
        </Field>
        <Field id="pilot-company" label={copy.company}>
          <Input id="pilot-company" value={form.company} onChange={set("company")} autoComplete="organization" maxLength={120} />
        </Field>
        <Field id="pilot-industry" label={copy.industry}>
          <Input id="pilot-industry" value={form.industry} onChange={set("industry")} placeholder={copy.industryPlaceholder} maxLength={80} />
        </Field>
        <Field id="pilot-city" label={copy.city}>
          <Input id="pilot-city" value={form.city} onChange={set("city")} autoComplete="address-level2" maxLength={80} />
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-(--radius-md) border border-border p-4">
        <legend className="px-1 text-meta font-medium text-foreground">{copy.contactGroup}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pilot-email" label={copy.email}>
            <Input id="pilot-email" type="email" value={form.email} onChange={set("email")} autoComplete="email" maxLength={254} aria-invalid={Boolean(error) && !hasContact} />
          </Field>
          <Field id="pilot-phone" label={copy.phone}>
            <Input id="pilot-phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" maxLength={32} aria-invalid={Boolean(error) && !hasContact} />
          </Field>
          <Field id="pilot-whatsapp" label={copy.whatsapp}>
            <Input id="pilot-whatsapp" type="tel" value={form.whatsapp} onChange={set("whatsapp")} maxLength={32} />
          </Field>
          <Field id="pilot-wechat" label={copy.wechat}>
            <Input id="pilot-wechat" value={form.wechat} onChange={set("wechat")} maxLength={40} />
          </Field>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pilot-website" label={copy.website}>
          <Input id="pilot-website" value={form.website} onChange={set("website")} autoComplete="url" maxLength={200} />
        </Field>
        <Field id="pilot-spend" label={copy.spend}>
          <NativeSelect id="pilot-spend" value={form.monthlyLeadSpend} onChange={set("monthlyLeadSpend")}>
            <option value="">{copy.spendPlaceholder}</option>
            {MONTHLY_LEAD_SPEND.map((key) => (
              <option key={key} value={key}>
                {spendCopy[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id="pilot-message" label={copy.message}>
        <Textarea id="pilot-message" value={form.message} onChange={set("message")} maxLength={1000} className="min-h-20" />
      </Field>

      <HoneypotField name="faxNumber" label={copy.honeypot} value={honeypot} onChange={setHoneypot} />

      <ConsentCheckbox id="pilot-consent" checked={consent} onChange={setConsent}>
        {copy.consent}
      </ConsentCheckbox>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <Button type="submit" disabled={state === "submitting"} className="w-full">
        {state === "submitting" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {state === "submitting" ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
