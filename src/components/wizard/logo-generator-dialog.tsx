"use client";

import { useState } from "react";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LOGO_STYLE_KEYS, type LogoStyleKey } from "@/lib/services/logo-service";
import { cn } from "@/lib/utils";

const STYLE_KEY_TO_I18N: Record<LogoStyleKey, string> = {
  modern: "logo.style.modern",
  minimal: "logo.style.minimal",
  luxury: "logo.style.luxury",
  playful: "logo.style.playful",
  tech: "logo.style.tech",
  natural: "logo.style.natural",
  local: "logo.style.local",
};

export interface LogoGeneratorDialogProps {
  /// DeliveryOrder id（创建项目后才有）
  projectId: string;
  /// 已知的业务名（默认填到表单），可空
  defaultBusinessName?: string;
  /// 选中后回调：写入父组件的 brandAssets.logoUrl
  onSelected?: (url: string) => void;
  /// 触发按钮 label key（可覆盖默认 "logo.actions.generate"）
  triggerLabelKey?: string;
  /// 触发按钮 variant
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  /// 是否禁用（如 projectId 还没创建时）
  disabled?: boolean;
}

export function LogoGeneratorDialog({
  projectId,
  defaultBusinessName,
  onSelected,
  triggerLabelKey = "brand.aiGenerateCta",
  triggerVariant = "secondary",
  disabled,
}: LogoGeneratorDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState(defaultBusinessName ?? "");
  const [industry, setIndustry] = useState("");
  const [style, setStyle] = useState<LogoStyleKey>("modern");
  const [colors, setColors] = useState("");
  const [slogan, setSlogan] = useState("");
  const [iconIdea, setIconIdea] = useState("");

  const [generating, setGenerating] = useState(false);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [fromMock, setFromMock] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setErrorMsg(null);
    setCandidates([]);
    setPickedUrl(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/logo/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim() || "Brand",
          industry: industry.trim() || null,
          style,
          colors: colors.trim() || null,
          slogan: slogan.trim() || null,
          iconIdea: iconIdea.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t("logo.states.failed"));
      setGenerationId(data.generationId);
      setCandidates(data.urls ?? []);
      setFromMock(Boolean(data.fromMock));
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelect() {
    if (!generationId || !pickedUrl) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/logo/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId, url: pickedUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t("logo.states.failed"));
      onSelected?.(pickedUrl);
      setOpen(false);
      setCandidates([]);
      setGenerationId(null);
      setPickedUrl(null);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={triggerVariant}
            size="sm"
            disabled={disabled}
            className="gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            {t(triggerLabelKey)}
          </Button>
        }
      />

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("logo.title")}</DialogTitle>
          <DialogDescription>{t("logo.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormRow label={t("logo.form.businessName")}>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Acme"
              />
            </FormRow>
            <FormRow label={t("logo.form.industry")}>
              <Input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Smart home / Beauty / SaaS"
              />
            </FormRow>
          </div>

          <FormRow label={t("logo.form.style")}>
            <div className="flex flex-wrap gap-2">
              {LOGO_STYLE_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStyle(key)}
                  className={cn(
                    "rounded-(--radius-md) border px-3 py-1.5 text-xs transition-colors",
                    style === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5",
                  )}
                >
                  {t(STYLE_KEY_TO_I18N[key])}
                </button>
              ))}
            </div>
          </FormRow>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormRow label={t("logo.form.colors")}>
              <Input
                value={colors}
                onChange={(e) => setColors(e.target.value)}
                placeholder="warm beige + matte black"
              />
            </FormRow>
            <FormRow label={t("logo.form.slogan")}>
              <Input
                value={slogan}
                onChange={(e) => setSlogan(e.target.value)}
                placeholder="Your tagline"
              />
            </FormRow>
          </div>

          <FormRow label={t("logo.form.iconIdea")}>
            <Textarea
              rows={2}
              value={iconIdea}
              onChange={(e) => setIconIdea(e.target.value)}
              placeholder="A leaf merging into a smart blind icon"
            />
          </FormRow>

          {fromMock && candidates.length > 0 && (
            <p className="text-xs text-amber-400/90">
              {t("logo.states.mockNotice")}
            </p>
          )}
          {errorMsg && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}

          {candidates.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {candidates.map((url) => {
                const picked = url === pickedUrl;
                return (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPickedUrl(url)}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-(--radius-lg) border-2 transition-all",
                      picked
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-white/10 hover:border-white/30",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Logo candidate"
                      className="h-full w-full object-cover"
                    />
                    {picked && (
                      <div className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          {candidates.length === 0 ? (
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !businessName.trim()}
            >
              {generating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {generating
                ? t("logo.states.generating")
                : t("logo.actions.generate")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCandidates([]);
                  setGenerationId(null);
                  setPickedUrl(null);
                }}
                disabled={submitting}
              >
                {t("logo.actions.regenerate")}
              </Button>
              <Button
                type="button"
                onClick={handleSelect}
                disabled={!pickedUrl || submitting}
              >
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {t("logo.actions.select")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
