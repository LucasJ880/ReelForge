"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CREATIVE_INDUSTRIES,
  CREATIVE_OBJECTIVES,
  CREATIVE_PLATFORMS,
} from "@/lib/schemas/creative-evidence";
import {
  BRAND_TONES,
  type ClientBrief,
} from "@/lib/schemas/client-brief";
import { DURATION_OPTIONS } from "@/lib/duration/segment-planner";
import { useTranslation } from "@/i18n/useTranslation";

type FormState = {
  businessName: string;
  industry: ClientBrief["industry"];
  objective: ClientBrief["objective"];
  targetPlatforms: ClientBrief["targetPlatforms"];
  videoLengthSec: ClientBrief["videoLengthSec"];
  brandTone: ClientBrief["brandTone"];
  keyMessage: string;
  brand: {
    logoUrl: string;
    websiteUrl: string;
    phone: string;
    ctaText: string;
    primaryColor: string;
  };
  consents: ClientBrief["consents"];
};

const DEFAULT_STATE: FormState = {
  businessName: "",
  industry: "real_estate",
  objective: "get_leads",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 30,
  brandTone: "professional",
  keyMessage: "",
  brand: {
    logoUrl: "",
    websiteUrl: "",
    phone: "",
    ctaText: "",
    primaryColor: "",
  },
  consents: {
    ownsFootage: false,
    noUnauthorizedAvatar: false,
    noUnauthorizedVoiceClone: false,
  },
};

export function WizardNewClient() {
  const router = useRouter();
  const { t } = useTranslation();
  const [state, setState] = useState<FormState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allConsentsChecked =
    state.consents.ownsFootage &&
    state.consents.noUnauthorizedAvatar &&
    state.consents.noUnauthorizedVoiceClone;

  const submit = () => {
    setError(null);
    if (!allConsentsChecked) {
      setError(t("wizard.step1.errorConsentsRequired"));
      return;
    }
    if (state.businessName.trim().length < 2) {
      setError(t("wizard.step1.errorBusinessNameTooShort"));
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/wizard/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: buildBrief(state),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.message ??
            data.error ??
            t("wizard.step1.errorRequestFailed", { status: res.status }),
        );
        return;
      }
      const json = (await res.json()) as { id: string };
      router.push(`/wizard/${json.id}/step-2-card`);
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">{t("wizard.step1.basicInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t("wizard.step1.businessName")}>
            <Input
              value={state.businessName}
              placeholder={t("wizard.step1.businessNamePlaceholder")}
              onChange={(e) =>
                setState((s) => ({ ...s, businessName: e.target.value }))
              }
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("wizard.step1.industry")}>
              <SelectControl
                value={state.industry}
                options={CREATIVE_INDUSTRIES}
                onChange={(v) =>
                  setState((s) => ({ ...s, industry: v as FormState["industry"] }))
                }
                renderLabel={(v) => t(`industry.${v}`)}
              />
            </Field>
            <Field label={t("wizard.step1.objective")}>
              <SelectControl
                value={state.objective}
                options={CREATIVE_OBJECTIVES}
                onChange={(v) =>
                  setState((s) => ({ ...s, objective: v as FormState["objective"] }))
                }
                renderLabel={(v) => t(`objective.${v}`)}
              />
            </Field>
          </div>
          <Field label={t("wizard.step1.platforms")}>
            <div className="flex flex-wrap gap-1.5">
              {CREATIVE_PLATFORMS.map((p) => {
                const active = state.targetPlatforms.includes(p);
                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        targetPlatforms: active
                          ? (s.targetPlatforms.filter((x) => x !== p) as FormState["targetPlatforms"])
                          : ([...s.targetPlatforms, p] as FormState["targetPlatforms"]),
                      }))
                    }
                    className={cn(
                      "rounded-md border px-3 py-1 text-xs",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-white/15 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`platform.${p}`)}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={t("project.duration.label")}>
            <p className="-mt-0.5 text-[11px] text-muted-foreground">
              {t("project.duration.sublabel")}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DURATION_OPTIONS.map((opt) => {
                const active = state.videoLengthSec === opt.durationSec;
                return (
                  <button
                    type="button"
                    key={opt.durationSec}
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        videoLengthSec: opt.durationSec as FormState["videoLengthSec"],
                      }))
                    }
                    className={cn(
                      "rounded-md border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5",
                    )}
                  >
                    <div className="text-sm font-semibold">
                      {t(`project.duration.${opt.labelKey}`)}
                    </div>
                    <div className="text-[11px] text-muted-foreground/80">
                      {t(`project.duration.${opt.subKey}`)}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={t("wizard.step1.brandTone")}>
            <SelectControl
              value={state.brandTone}
              options={BRAND_TONES}
              onChange={(v) =>
                setState((s) => ({ ...s, brandTone: v as FormState["brandTone"] }))
              }
              renderLabel={(v) => t(`brandTone.${v}`)}
            />
          </Field>
          <Field label={t("wizard.step1.keyMessage")}>
            <Textarea
              value={state.keyMessage}
              maxLength={400}
              placeholder={t("wizard.step1.keyMessagePlaceholder")}
              onChange={(e) =>
                setState((s) => ({ ...s, keyMessage: e.target.value }))
              }
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("wizard.step1.brandAssetsCard")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label={t("wizard.step1.brandLogoUrl")}>
            <Input
              value={state.brand.logoUrl}
              placeholder={t("wizard.step1.brandLogoUrlPlaceholder")}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, logoUrl: e.target.value },
                }))
              }
            />
          </Field>
          <Field label={t("wizard.step1.brandWebsite")}>
            <Input
              value={state.brand.websiteUrl}
              placeholder={t("wizard.step1.brandWebsitePlaceholder")}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, websiteUrl: e.target.value },
                }))
              }
            />
          </Field>
          <Field label={t("wizard.step1.brandPhone")}>
            <Input
              value={state.brand.phone}
              placeholder={t("wizard.step1.brandPhonePlaceholder")}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, phone: e.target.value },
                }))
              }
            />
          </Field>
          <Field label={t("wizard.step1.brandCta")}>
            <Input
              value={state.brand.ctaText}
              placeholder={t("wizard.step1.brandCtaPlaceholder")}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, ctaText: e.target.value },
                }))
              }
            />
          </Field>
          <Field label={t("wizard.step1.brandPrimaryColor")}>
            <Input
              value={state.brand.primaryColor}
              placeholder={t("wizard.step1.brandPrimaryColorPlaceholder")}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, primaryColor: e.target.value },
                }))
              }
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-sm">
            {t("wizard.step1.consentsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <ConsentBox
            checked={state.consents.ownsFootage}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                consents: { ...s.consents, ownsFootage: v },
              }))
            }
            label={t("wizard.step1.consentOwnsFootage")}
          />
          <ConsentBox
            checked={state.consents.noUnauthorizedAvatar}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                consents: { ...s.consents, noUnauthorizedAvatar: v },
              }))
            }
            label={t("wizard.step1.consentNoUnauthorizedAvatar")}
          />
          <ConsentBox
            checked={state.consents.noUnauthorizedVoiceClone}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                consents: {
                  ...s.consents,
                  noUnauthorizedVoiceClone: v,
                },
              }))
            }
            label={t("wizard.step1.consentNoUnauthorizedVoiceClone")}
          />
        </CardContent>
      </Card>

      {error && (
        <div className="lg:col-span-3 flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="lg:col-span-3 flex justify-end">
        <Button onClick={submit} disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" />
          )}
          {t("wizard.step1.continueButton")}
        </Button>
      </div>
    </div>
  );
}

function buildBrief(s: FormState): ClientBrief {
  const brand: ClientBrief["brandAssets"] = {};
  if (s.brand.logoUrl.trim()) brand.logoUrl = s.brand.logoUrl.trim();
  if (s.brand.websiteUrl.trim()) brand.websiteUrl = s.brand.websiteUrl.trim();
  if (s.brand.phone.trim()) brand.phone = s.brand.phone.trim();
  if (s.brand.ctaText.trim()) brand.ctaText = s.brand.ctaText.trim();
  if (s.brand.primaryColor.trim())
    brand.primaryColor = s.brand.primaryColor.trim();
  return {
    businessName: s.businessName.trim(),
    industry: s.industry,
    objective: s.objective,
    targetPlatforms: s.targetPlatforms,
    videoLengthSec: s.videoLengthSec,
    brandTone: s.brandTone,
    brandAssets: brand,
    candidateCardSlugs: [],
    keyMessage: s.keyMessage.trim() || undefined,
    consents: s.consents,
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SelectControl({
  value,
  options,
  onChange,
  renderLabel,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  renderLabel?: (v: string) => string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {renderLabel ? renderLabel(o) : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ConsentBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5"
      />
      <span className="leading-snug">{label}</span>
    </label>
  );
}
