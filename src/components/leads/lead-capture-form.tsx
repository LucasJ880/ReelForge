"use client";

import { useState } from "react";
import { Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusTick } from "@/components/exchange/status-tick";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/config";
import {
  LEAD_CONSENT_VERSION,
  PREFERRED_TIMES,
  SELF_REPORTED_SOURCES,
  fillGrowth,
  getGrowthCopy,
} from "@/i18n/growth-copy";
import { ConsentCheckbox, Field, FormAlert, HoneypotField, NativeSelect } from "./form-fields";
import { compact, sendJson } from "./leads-api";

const OTHER_SERVICE = "__other__";
/// 与 lead-service 的 isPlausiblePhone 同一口径：常见写法都放行，位数 7–15。
const PHONE_RE = /^\+?[0-9 ().-]{6,30}$/;

function plausiblePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "").length;
  return PHONE_RE.test(value.trim()) && digits >= 7 && digits <= 15;
}

/**
 * 商家询盘页的预约表单。归因（?t= 追踪码、utm_*）由页面从地址栏带进来，随表单提交；
 * 限流或故障时把商家电话作为备用联系方式给出（D4：人话报错）。
 */
export function LeadCaptureForm({
  locale,
  slug,
  business,
  services,
  phone,
  trackedCode,
  utm,
}: {
  locale: Locale;
  slug: string;
  business: string;
  services: string[];
  phone: string | null;
  trackedCode: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null };
}) {
  const growth = getGrowthCopy(locale);
  const copy = growth.leadForm;
  const [name, setName] = useState("");
  const [phoneValue, setPhoneValue] = useState("");
  const [email, setEmail] = useState("");
  const [service, setService] = useState(services.length ? "" : OTHER_SERVICE);
  const [serviceText, setServiceText] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState(false);

  const callHint = (fallback?: string) => {
    const number = fallback ?? phone;
    return number ? ` ${fillGrowth(copy.callFallback, { phone: number })}` : "";
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPhoneError(false);
    if (!name.trim()) return setError(copy.invalid);
    if (!plausiblePhone(phoneValue)) {
      setPhoneError(true);
      return setError(copy.phoneInvalid);
    }
    if (!consent) return setError(copy.consentRequired);
    setState("submitting");
    const serviceInterest = service === OTHER_SERVICE ? serviceText : service;
    const result = await sendJson("/api/public/leads", "POST", {
      ...compact({
        name,
        phone: phoneValue,
        email,
        serviceInterest,
        preferredTime,
        selfReportedSource: source,
        message,
      }),
      slug,
      trackedCode,
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmCampaign: utm.campaign,
      locale,
      consent: true,
      consentVersion: LEAD_CONSENT_VERSION,
      faxNumber: honeypot,
    });
    if (result.ok) {
      setState("done");
      return;
    }
    setState("idle");
    if (result.reason === "phone_invalid") {
      setPhoneError(true);
      return setError(copy.phoneInvalid);
    }
    if (result.reason === "consent_required") return setError(copy.consentRequired);
    if (result.reason === "invalid") return setError(copy.invalid);
    if (result.reason === "rate_limited") return setError(`${copy.rateLimited}${callHint(result.fallbackPhone)}`);
    setError(`${copy.genericError}${callHint()}`);
  }

  if (state === "done") {
    return (
      <div role="status" className="space-y-3 px-6 py-10" data-lead-form="submitted">
        <StatusTick entity="submission" state="received" locale={locale} />
        <p className="text-body text-muted-foreground">{fillGrowth(copy.successBody, { business })}</p>
        {phone ? (
          <Button render={<a href={`tel:${phone.replace(/[^\d+]/g, "")}`} />} variant="outline">
            <Phone aria-hidden />
            {phone}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} aria-label={copy.label} className="relative min-w-0 space-y-4 p-5 sm:p-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="lead-name" label={copy.name}>
          <Input id="lead-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={80} />
        </Field>
        <Field id="lead-phone" label={copy.phone}>
          <Input
            id="lead-phone"
            type="tel"
            inputMode="tel"
            value={phoneValue}
            onChange={(event) => setPhoneValue(event.target.value)}
            autoComplete="tel"
            required
            maxLength={32}
            aria-invalid={phoneError}
          />
        </Field>
      </div>
      <Field id="lead-email" label={copy.email}>
        <Input id="lead-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} />
      </Field>
      {services.length ? (
        <Field id="lead-service" label={copy.service}>
          <NativeSelect id="lead-service" value={service} onChange={(event) => setService(event.target.value)}>
            <option value="">{copy.choose}</option>
            {services.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value={OTHER_SERVICE}>{copy.serviceOther}</option>
          </NativeSelect>
        </Field>
      ) : null}
      {service === OTHER_SERVICE ? (
        <Field id="lead-service-text" label={services.length ? copy.serviceOther : copy.service}>
          <Input
            id="lead-service-text"
            value={serviceText}
            onChange={(event) => setServiceText(event.target.value)}
            placeholder={copy.servicePlaceholder}
            maxLength={120}
          />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="lead-time" label={copy.preferredTime}>
          <NativeSelect id="lead-time" value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)}>
            <option value="">{copy.choose}</option>
            {PREFERRED_TIMES.map((key) => (
              <option key={key} value={key}>
                {growth.preferredTimes[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lead-source" label={copy.source}>
          <NativeSelect id="lead-source" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">{copy.choose}</option>
            {SELF_REPORTED_SOURCES.map((key) => (
              <option key={key} value={key}>
                {growth.selfReported[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id="lead-message" label={copy.message}>
        <Textarea id="lead-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} className="min-h-20" />
      </Field>

      <HoneypotField name="faxNumber" label={copy.honeypot} value={honeypot} onChange={setHoneypot} />

      <ConsentCheckbox id="lead-consent" checked={consent} onChange={setConsent}>
        {fillGrowth(copy.consent, { business })}
      </ConsentCheckbox>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <Button type="submit" disabled={state === "submitting"} className="w-full">
        {state === "submitting" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {state === "submitting" ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}

/** 询盘页语言切换：写 cookie 后整页刷新（与全站切语言同一条路），之后以访客选择为准。 */
export function LeadLocaleToggle({ locale, label }: { locale: Locale; label: string }) {
  const { setLocale } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "en-US" ? "zh-CN" : "en-US")}
      className="h-8 rounded-(--radius-md) border border-border px-3 text-meta text-muted-foreground hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {label}
    </button>
  );
}
