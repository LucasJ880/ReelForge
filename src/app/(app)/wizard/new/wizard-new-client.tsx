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
  VIDEO_LENGTHS,
  type ClientBrief,
} from "@/lib/schemas/client-brief";

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
      setError("请勾选三项合规承诺后再创建项目。");
      return;
    }
    if (state.businessName.trim().length < 2) {
      setError("商家名称至少 2 个字符。");
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
        setError(data.message ?? data.error ?? `请求失败 (${res.status})`);
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
          <CardTitle className="text-sm">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="商家名称">
            <Input
              value={state.businessName}
              placeholder="e.g. Sunrise Realty"
              onChange={(e) =>
                setState((s) => ({ ...s, businessName: e.target.value }))
              }
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="行业">
              <SelectControl
                value={state.industry}
                options={CREATIVE_INDUSTRIES}
                onChange={(v) =>
                  setState((s) => ({ ...s, industry: v as FormState["industry"] }))
                }
              />
            </Field>
            <Field label="目标">
              <SelectControl
                value={state.objective}
                options={CREATIVE_OBJECTIVES}
                onChange={(v) =>
                  setState((s) => ({ ...s, objective: v as FormState["objective"] }))
                }
              />
            </Field>
          </div>
          <Field label="目标平台 (可多选)">
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
                    {p}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="视频时长">
              <SelectControl
                value={String(state.videoLengthSec)}
                options={VIDEO_LENGTHS.map((v) => String(v))}
                renderLabel={(v) => `${v}s`}
                onChange={(v) =>
                  setState((s) => ({
                    ...s,
                    videoLengthSec: Number(v) as FormState["videoLengthSec"],
                  }))
                }
              />
            </Field>
            <Field label="品牌口吻">
              <SelectControl
                value={state.brandTone}
                options={BRAND_TONES}
                onChange={(v) =>
                  setState((s) => ({ ...s, brandTone: v as FormState["brandTone"] }))
                }
              />
            </Field>
          </div>
          <Field label="关键信息（可选，<= 400 字符）">
            <Textarea
              value={state.keyMessage}
              maxLength={400}
              placeholder="本周末开放参观、限时报名、新装修体验……"
              onChange={(e) =>
                setState((s) => ({ ...s, keyMessage: e.target.value }))
              }
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">品牌资产 (可选)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Logo URL">
            <Input
              value={state.brand.logoUrl}
              placeholder="https://..."
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, logoUrl: e.target.value },
                }))
              }
            />
          </Field>
          <Field label="官网">
            <Input
              value={state.brand.websiteUrl}
              placeholder="https://..."
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, websiteUrl: e.target.value },
                }))
              }
            />
          </Field>
          <Field label="电话">
            <Input
              value={state.brand.phone}
              placeholder="(555) 123-4567"
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, phone: e.target.value },
                }))
              }
            />
          </Field>
          <Field label="CTA 文案">
            <Input
              value={state.brand.ctaText}
              placeholder="DM us today"
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  brand: { ...s.brand, ctaText: e.target.value },
                }))
              }
            />
          </Field>
          <Field label="主色 (HEX)">
            <Input
              value={state.brand.primaryColor}
              placeholder="#1E40AF"
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
          <CardTitle className="text-sm">合规承诺（必须三项全部勾选）</CardTitle>
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
            label="我拥有或获得授权使用所有上传的素材，且素材中出现的真人/宠物已知情同意。"
          />
          <ConsentBox
            checked={state.consents.noUnauthorizedAvatar}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                consents: { ...s.consents, noUnauthorizedAvatar: v },
              }))
            }
            label="我不会要求平台生成未经授权的数字人或冒充他人形象的视频。"
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
            label="我不会要求平台克隆未经授权的真人声音。"
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
          创建项目并进入 Step 2
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
