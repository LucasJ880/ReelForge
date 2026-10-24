"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusTick } from "@/components/exchange/status-tick";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { Field, FormAlert, NativeSelect } from "./form-fields";
import { sendJson } from "./leads-api";

export type LeadPageDisplay = {
  businessName: string;
  headline: string;
  intro: string;
  services: string[];
  phone: string;
  region: string;
  locale: Locale | "";
};

/**
 * 询盘页设置：地址与开通状态只读（超管才能改，见管理员面板）；
 * 展示内容（店名、标题、介绍、服务项、电话、地区、默认语言）商家自己改。
 */
export function LeadPageSettings({
  locale,
  baseUrl,
  slug,
  enabled,
  display,
}: {
  locale: Locale;
  baseUrl: string;
  slug: string | null;
  enabled: boolean;
  display: LeadPageDisplay;
}) {
  const growth = getGrowthCopy(locale);
  const copy = growth.leads;
  const router = useRouter();
  const [form, setForm] = useState({ ...display, services: display.services.join("\n") });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const pageUrl = slug ? `${baseUrl}/l/${slug}` : null;

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    setBusy(true);
    const result = await sendJson("/api/leads/page", "PUT", {
      businessName: form.businessName,
      headline: form.headline,
      intro: form.intro,
      services: form.services
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 12),
      phone: form.phone,
      region: form.region,
      locale: form.locale || null,
    });
    setBusy(false);
    if (!result.ok) {
      return setNotice({ tone: "error", text: result.reason === "phone_invalid" ? growth.leadForm.phoneInvalid : copy.actionFailed });
    }
    setNotice({ tone: "info", text: copy.pageSaved });
    router.refresh();
  }

  return (
    <div className="x-panel min-w-0 space-y-5 p-5">
      <dl className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <dt className="x-label">{copy.pageTitle}</dt>
        <dd>
          <StatusTick tone={enabled ? "live" : "void"} label={enabled ? copy.pageEnabled : copy.pageDisabled} />
        </dd>
        <dt className="x-label">{copy.pageAddress}</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-3">
          {pageUrl ? (
            <>
              <span className="truncate font-mono text-data text-foreground">{pageUrl}</span>
              {enabled ? (
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-accent"
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden />
                  {copy.openPage}
                </a>
              ) : null}
            </>
          ) : (
            <span className="text-meta text-muted-foreground">{copy.pageNoAddress}</span>
          )}
        </dd>
      </dl>
      <p className="text-meta text-muted-foreground">{enabled ? copy.pageAdminOnly : copy.pageNotEnabledHint}</p>

      <form onSubmit={save} aria-label={copy.pageTitle} className="space-y-4 border-t border-border pt-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="page-business" label={copy.pageBusinessName}>
            <Input id="page-business" value={form.businessName} onChange={set("businessName")} maxLength={80} />
          </Field>
          <Field id="page-headline" label={copy.pageHeadline}>
            <Input id="page-headline" value={form.headline} onChange={set("headline")} placeholder={growth.leadPage.defaultHeadline} maxLength={120} />
          </Field>
          <Field id="page-phone" label={copy.pagePhone}>
            <Input id="page-phone" type="tel" value={form.phone} onChange={set("phone")} maxLength={32} />
          </Field>
          <Field id="page-region" label={copy.pageRegion}>
            <Input id="page-region" value={form.region} onChange={set("region")} maxLength={80} />
          </Field>
        </div>
        <Field id="page-intro" label={copy.pageIntro}>
          <Textarea id="page-intro" value={form.intro} onChange={set("intro")} placeholder={growth.leadPage.defaultIntro} maxLength={600} className="min-h-16" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="page-services" label={copy.pageServices} hint={copy.pageServicesHint}>
            <Textarea id="page-services" value={form.services} onChange={set("services")} className="min-h-24" />
          </Field>
          <Field id="page-locale" label={copy.pageLocale}>
            <NativeSelect id="page-locale" value={form.locale} onChange={set("locale")}>
              <option value="">{copy.pageLocaleAuto}</option>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {busy ? copy.saving : copy.pageSave}
        </Button>
      </form>
    </div>
  );
}
