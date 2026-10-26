"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, NativeSelect } from "@/components/leads/form-fields";
import { MonoTag } from "@/components/exchange/mono-tag";
import { StatusTick } from "@/components/exchange/status-tick";
import { WallVideo } from "@/components/exchange/wall-controls";
import { uploadFilesToAssets } from "@/components/personal/upload-assets";
import type { Locale } from "@/i18n/config";
import { getOnboardingCopy } from "@/i18n/onboarding-copy";
import { BUSINESS_INDUSTRIES, type BusinessIndustry } from "@/lib/onboarding/industries";
import type { OnboardingState } from "@/lib/services/onboarding-service";
import { cn } from "@/lib/utils";

type StepKey = keyof OnboardingState["steps"];
type Copy = ReturnType<typeof getOnboardingCopy>;

const STEP_ORDER: readonly StepKey[] = ["business", "brand", "video", "leadPage"];
/// 老账号的默认工作区名，不当成店名预填
const PLACEHOLDER_NAMES = new Set(["My Workspace"]);

const pad = (value: number) => String(value).padStart(2, "0");
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

function firstOpenStep(steps: OnboardingState["steps"]): StepKey | null {
  return STEP_ORDER.find((key) => steps[key] !== "done") ?? null;
}

async function sendJson(url: string, method: "PUT" | "POST", body?: unknown): Promise<boolean> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.ok;
}

/**
 * 跳过 / 完成上手：记下时间（之后 /app 直接进创作页）再去创作。记录失败也照样放行——
 * 最坏是下次进 /app 还会先看到这一页，不会把人卡住。
 */
export function OnboardingExit({ mode, locale, solid = false }: { mode: "skip" | "finish"; locale: Locale; solid?: boolean }) {
  const router = useRouter();
  const copy = getOnboardingCopy(locale).welcome;
  const [busy, setBusy] = useState(false);
  async function exit() {
    setBusy(true);
    await sendJson("/api/onboarding/complete", "POST").catch(() => false);
    router.push("/app/create");
  }
  if (mode === "skip") {
    return (
      <Button variant="ghost" onClick={() => void exit()} disabled={busy}>
        {busy ? copy.finishing : copy.skip}
      </Button>
    );
  }
  return (
    <Button variant={solid ? "default" : "outline"} size="lg" onClick={() => void exit()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {busy ? copy.finishing : copy.finish}
      {busy ? null : <ArrowRight aria-hidden />}
    </Button>
  );
}

/**
 * 上手四步：生意 → 品牌 → 第一条视频 → 询盘页。
 * 默认展开第一个没做完的一步；它的主按钮是这一页唯一的实心钮（都做完了，实心钮交给「完成上手」）。
 * 保存后 router.refresh()：行情头读数与每一步的状态都从服务端真实数据重读。
 */
export function WelcomeSteps({ state, locale }: { state: OnboardingState; locale: Locale }) {
  const router = useRouter();
  const copy = getOnboardingCopy(locale);
  const active = firstOpenStep(state.steps);
  const [open, setOpen] = useState<StepKey | null>(active);

  function advance(from: StepKey) {
    const next = STEP_ORDER.slice(STEP_ORDER.indexOf(from) + 1).find((key) => state.steps[key] !== "done") ?? null;
    setOpen(next);
    router.refresh();
  }

  const industryLabel = state.profile.industry ? copy.industries[state.profile.industry] : null;
  const summaries: Record<StepKey, string | null> = {
    business: state.steps.business === "done"
      ? [state.businessName, industryLabel, state.profile.city].filter(Boolean).join(" · ")
      : null,
    brand: state.brandPackageName ? fill(copy.welcome.brand.ready, { name: state.brandPackageName }) : null,
    video: state.steps.video === "done"
      ? copy.welcome.video.done
      : state.steps.video === "started"
        ? copy.welcome.video.started
        : null,
    leadPage: state.leadPage.enabled
      ? copy.welcome.leadPage.live
      : state.leadPage.requestedAt
        ? copy.welcome.leadPage.requested
        : null,
  };
  const titles: Record<StepKey, string> = {
    business: copy.welcome.business.title,
    brand: copy.welcome.brand.title,
    video: copy.welcome.video.title,
    leadPage: copy.welcome.leadPage.title,
  };

  return (
    <div className="space-y-6">
      <ol className="space-y-3" aria-label={copy.welcome.readingsLabel}>
        {STEP_ORDER.map((key, index) => {
          const isOpen = open === key;
          const isActive = active === key;
          return (
            <li key={key} className="x-panel min-w-0 overflow-hidden" data-step={key} data-status={state.steps[key]}>
              <button
                type="button"
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-fast hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : key)}
              >
                <span className={cn("font-mono text-data tabular-nums", isOpen ? "text-accent" : "text-tertiary")}>
                  {pad(index + 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-subhead font-medium">{titles[key]}</span>
                  {!isOpen && summaries[key] ? (
                    <span className="block truncate text-meta text-muted-foreground">{summaries[key]}</span>
                  ) : null}
                </span>
                <StatusTick entity="setupStep" state={state.steps[key]} locale={locale} className="shrink-0" />
              </button>
              {isOpen ? (
                <div className="border-t border-border px-5 py-5">
                  {key === "business" ? (
                    <BusinessStep state={state} copy={copy} primary={isActive} onSaved={() => advance("business")} />
                  ) : null}
                  {key === "brand" ? (
                    <BrandStep state={state} copy={copy} primary={isActive} onSaved={() => advance("brand")} />
                  ) : null}
                  {key === "video" ? <VideoStep state={state} copy={copy} locale={locale} primary={isActive} /> : null}
                  {key === "leadPage" ? (
                    <LeadPageStep state={state} copy={copy} primary={isActive} onSaved={() => advance("leadPage")} />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <OnboardingExit mode="finish" locale={locale} solid={active === null} />
      </div>
    </div>
  );
}

function StepIntro({ body }: { body: string }) {
  return <p className="max-w-[62ch] text-body text-muted-foreground">{body}</p>;
}

function BusinessStep({
  state,
  copy,
  primary,
  onSaved,
}: {
  state: OnboardingState;
  copy: Copy;
  primary: boolean;
  onSaved: () => void;
}) {
  const t = copy.welcome.business;
  const [businessName, setBusinessName] = useState(PLACEHOLDER_NAMES.has(state.businessName) ? "" : state.businessName);
  const [industry, setIndustry] = useState<BusinessIndustry | "">(state.profile.industry ?? "");
  const [city, setCity] = useState(state.profile.city ?? "");
  const [website, setWebsite] = useState(state.profile.website ?? "");
  const [oneLiner, setOneLiner] = useState(state.profile.oneLiner ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!businessName.trim()) return setError(copy.register.errors.BUSINESS_REQUIRED);
    if (!industry) return setError(copy.register.errors.INDUSTRY_REQUIRED);
    setBusy(true);
    setError(null);
    const ok = await sendJson("/api/onboarding", "PUT", {
      businessName: businessName.trim(),
      industry,
      city: city.trim() || null,
      website: website.trim() || null,
      oneLiner: oneLiner.trim() || null,
    }).catch(() => false);
    setBusy(false);
    if (!ok) return setError(copy.welcome.failed);
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <StepIntro body={t.body} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="ob-business-name" label={t.businessName}>
          <Input id="ob-business-name" value={businessName} maxLength={80} required onChange={(e) => setBusinessName(e.target.value)} />
        </Field>
        <Field id="ob-industry" label={copy.register.industry}>
          <NativeSelect id="ob-industry" value={industry} required onChange={(e) => setIndustry(e.target.value as BusinessIndustry | "")}>
            <option value="" disabled>
              {copy.register.industryPlaceholder}
            </option>
            {BUSINESS_INDUSTRIES.map((key) => (
              <option key={key} value={key}>
                {copy.industries[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="ob-city" label={copy.register.city}>
          <Input id="ob-city" value={city} maxLength={80} placeholder={copy.register.cityPlaceholder} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field id="ob-website" label={t.website}>
          <Input id="ob-website" value={website} maxLength={160} placeholder={t.websitePlaceholder} onChange={(e) => setWebsite(e.target.value)} />
        </Field>
        <Field id="ob-one-liner" label={t.oneLiner} className="md:col-span-2">
          <Textarea id="ob-one-liner" value={oneLiner} maxLength={200} rows={2} placeholder={t.oneLinerPlaceholder} onChange={(e) => setOneLiner(e.target.value)} />
        </Field>
      </div>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Button type="submit" variant={primary ? "default" : "outline"} disabled={busy}>
        {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {t.save}
      </Button>
    </form>
  );
}

function BrandStep({
  state,
  copy,
  primary,
  onSaved,
}: {
  state: OnboardingState;
  copy: Copy;
  primary: boolean;
  onSaved: () => void;
}) {
  const t = copy.welcome.brand;
  const industry = state.profile.industry ?? "other";
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<{ id: string; url: string } | null>(null);
  const [brandName, setBrandName] = useState(PLACEHOLDER_NAMES.has(state.businessName) ? "" : state.businessName);
  const [contact, setContact] = useState("");
  const [cta, setCta] = useState(t.ctaDefaults[industry]);
  const [website, setWebsite] = useState(state.profile.website ?? "");
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.steps.brand === "done") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body">{fill(t.ready, { name: state.brandPackageName ?? brandName })}</p>
        <Button render={<Link href="/app/brands" />} variant="outline">
          {t.manage}
        </Button>
      </div>
    );
  }

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const [asset] = await uploadFilesToAssets([file], { forceRole: "logo", skipAiClassification: true });
      if (!asset) throw new Error(copy.welcome.failed);
      setLogo({ id: asset.assetId ?? asset.id, url: asset.url });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : copy.welcome.failed);
    } finally {
      setBusy(null);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!logo) return setError(t.logoRequired);
    if (!brandName.trim()) return setError(copy.register.errors.BUSINESS_REQUIRED);
    setBusy("save");
    setError(null);
    const ok = await sendJson("/api/brand-packaging", "PUT", {
      name: brandName.trim(),
      brandName: brandName.trim(),
      slogan: null,
      cta: cta.trim() || null,
      contactLines: contact.trim() ? [contact.trim()] : [],
      website: website.trim() || null,
      logoAssetId: logo.id,
      endCardAssetId: null,
      isDefault: true,
    }).catch(() => false);
    setBusy(null);
    if (!ok) return setError(copy.welcome.failed);
    onSaved();
  }

  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 space-y-5">
        <StepIntro body={t.body} />
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label={t.logo}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {busy === "upload" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ImagePlus aria-hidden />}
            {busy === "upload" ? t.uploading : logo ? t.replaceLogo : t.logo}
          </Button>
          <span className="text-meta text-muted-foreground">{t.logoHint}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="ob-brand-name" label={t.brandName}>
            <Input id="ob-brand-name" value={brandName} maxLength={120} required onChange={(e) => setBrandName(e.target.value)} />
          </Field>
          <Field id="ob-contact" label={t.contact}>
            <Input id="ob-contact" value={contact} maxLength={160} placeholder={t.contactPlaceholder} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field id="ob-cta" label={t.cta}>
            <Input id="ob-cta" value={cta} maxLength={160} onChange={(e) => setCta(e.target.value)} />
          </Field>
          <Field id="ob-brand-website" label={copy.welcome.business.website}>
            <Input id="ob-brand-website" value={website} maxLength={160} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
        </div>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <Button type="submit" variant={primary ? "default" : "outline"} disabled={busy !== null}>
          {busy === "save" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {t.save}
        </Button>
      </div>
      <figure className="min-w-0 space-y-2">
        <figcaption className="x-label">{t.preview}</figcaption>
        <div className="x-well flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-(--radius-md) px-4 text-center">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.url} alt="" className="max-h-16 max-w-[70%] object-contain" />
          ) : (
            <span className="x-hatch size-14 rounded-(--radius-md)" aria-hidden />
          )}
          <p className="text-subhead font-medium text-balance">{brandName || "—"}</p>
          {cta ? <p className="rounded-(--radius-sm) border border-border-strong px-2 py-1 text-meta">{cta}</p> : null}
          {contact ? <p className="font-mono text-data text-muted-foreground">{contact}</p> : null}
          {website ? <p className="truncate font-mono text-micro text-tertiary">{website}</p> : null}
        </div>
        <p className="text-micro text-tertiary">{t.previewNote}</p>
      </figure>
    </form>
  );
}

function VideoStep({
  state,
  copy,
  locale,
  primary,
}: {
  state: OnboardingState;
  copy: Copy;
  locale: Locale;
  primary: boolean;
}) {
  const t = copy.welcome.video;
  const prompt = state.profile.oneLiner?.trim();
  /// 这一步还没开始时，第一张推荐卡的「用这个风格」就是这一步的主行动（全页唯一实心钮）
  const isPrimaryAction = (index: number) => primary && index === 0 && state.steps.video === "todo";
  const createHref = (slug: string) =>
    `/app/create?styleTemplate=${encodeURIComponent(slug)}${prompt ? `&prompt=${encodeURIComponent(prompt)}` : ""}`;
  return (
    <div className="space-y-5">
      <StepIntro body={t.body} />
      <p className="font-mono text-data tabular-nums text-muted-foreground">
        {fill(t.quota, { used: state.quota.used, limit: state.quota.limit })}
      </p>
      {state.steps.video !== "todo" ? (
        <div className="flex flex-wrap items-center gap-3">
          <StatusTick entity="setupStep" state={state.steps.video} locale={locale} />
          <span className="text-body">{state.steps.video === "done" ? t.done : t.started}</span>
          <Button render={<Link href="/app/library" />} variant="ghost" size="sm">
            {t.library}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      ) : null}
      {state.templates.length > 0 ? (
        <ul className="x-wall grid-cols-1 sm:grid-cols-3">
          {state.templates.map((template, index) => (
            <li key={template.slug} className="flex min-w-0 flex-col">
              <div className="relative aspect-video overflow-hidden bg-sunken">
                <WallVideo src={template.video} poster={template.poster ?? undefined} label={template.name} />
                <span className="absolute left-1.5 top-1.5 rounded-(--radius-sm) bg-sunken/85">
                  <MonoTag className="border-0">{t.sampleTag}</MonoTag>
                </span>
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2.5">
                <span className="min-w-0 truncate text-meta">{template.name}</span>
                <Button
                  render={<Link href={createHref(template.slug)} />}
                  variant={isPrimaryAction(index) ? "default" : "outline"}
                  size="sm"
                >
                  {t.useTemplate}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted-foreground">{t.noTemplates}</p>
      )}
      <Button render={<Link href="/app/create" />} variant="ghost">
        {t.openCreate}
        <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}

function LeadPageStep({
  state,
  copy,
  primary,
  onSaved,
}: {
  state: OnboardingState;
  copy: Copy;
  primary: boolean;
  onSaved: () => void;
}) {
  const t = copy.welcome.leadPage;
  const industry = state.profile.industry ?? "other";
  const businessName = PLACEHOLDER_NAMES.has(state.businessName) ? "" : state.businessName;
  /// 预览：已保存的询盘页内容优先；没有就用档案拼一份草稿（申请开通时一并保存）
  const draft = {
    businessName: state.leadPage.businessName ?? businessName,
    headline: state.leadPage.headline ?? fill(t.defaultHeadline, { business: businessName || copy.welcome.business.businessName }),
    intro: state.leadPage.intro ?? state.profile.oneLiner ?? null,
    services: state.leadPage.services.length > 0 ? state.leadPage.services : t.defaultServices[industry],
    phone: state.leadPage.phone,
    region: state.leadPage.region ?? state.profile.city,
  };
  const hasSavedPage = Boolean(state.leadPage.businessName || state.leadPage.headline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      if (!hasSavedPage) {
        const saved = await sendJson("/api/leads/page", "PUT", {
          businessName: draft.businessName || null,
          headline: draft.headline,
          intro: draft.intro,
          services: draft.services,
          region: draft.region,
        });
        if (!saved) throw new Error(copy.welcome.failed);
      }
      const ok = await sendJson("/api/leads/page/activation-request", "POST");
      if (!ok) throw new Error(copy.welcome.failed);
      onSaved();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.welcome.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <StepIntro body={t.body} />
        {state.leadPage.enabled && state.leadPage.publicSlug ? (
          <p className="font-mono text-data text-foreground">/l/{state.leadPage.publicSlug}</p>
        ) : null}
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="flex flex-wrap items-center gap-3">
          {state.leadPage.enabled || state.leadPage.requestedAt ? (
            <span className="text-body">{state.leadPage.enabled ? t.live : t.requested}</span>
          ) : (
            <Button variant={primary ? "default" : "outline"} disabled={busy} onClick={() => void request()}>
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {busy ? t.requesting : t.request}
            </Button>
          )}
          <Button render={<Link href="/app/leads" />} variant="ghost">
            {t.manage}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
      <figure className="min-w-0 space-y-2">
        <figcaption className="x-label">{t.preview}</figcaption>
        <div className="x-well space-y-3 rounded-(--radius-md) p-4">
          <p className="text-meta text-muted-foreground">{draft.businessName || "—"}</p>
          <p className="text-subhead font-medium text-balance">{draft.headline}</p>
          {draft.intro ? <p className="text-meta text-muted-foreground">{draft.intro}</p> : null}
          <div className="space-y-1.5">
            <p className="x-label">{t.services}</p>
            <ul className="flex flex-wrap gap-1.5">
              {draft.services.map((service) => (
                <li key={service}>
                  <MonoTag className="normal-case">{service}</MonoTag>
                </li>
              ))}
            </ul>
          </div>
          {draft.region ? (
            <p className="text-meta">
              <span className="text-tertiary">{t.region} · </span>
              {draft.region}
            </p>
          ) : null}
          {draft.phone ? (
            <p className="font-mono text-data">
              <span className="text-tertiary">{t.call} · </span>
              {draft.phone}
            </p>
          ) : null}
        </div>
        <p className="text-micro text-tertiary">{t.previewNote}</p>
      </figure>
    </div>
  );
}
