"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WizardMockBanner } from "@/components/wizard/wizard-mock-banner";
import { useTranslation } from "@/i18n/useTranslation";

type CurrentScript = Awaited<
  ReturnType<typeof import("@/lib/services/wizard-script-service").getCurrentWizardScript>
>;

export function ScriptStepClient({
  orderId,
  initialScript,
  cardSelected,
}: {
  orderId: string;
  initialScript: CurrentScript;
  cardSelected: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [script, setScript] = useState(initialScript);
  const [hook, setHook] = useState(initialScript?.hook ?? "");
  const [cta, setCta] = useState(initialScript?.cta ?? "");
  const [fullText, setFullText] = useState(initialScript?.fullText ?? "");
  const [generating, startGenerate] = useTransition();
  const [saving, startSave] = useTransition();
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [bannerLevel, setBannerLevel] = useState<"info" | "warn">("info");
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    startGenerate(async () => {
      const res = await fetch(
        `/api/wizard/projects/${orderId}/script`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.message ??
            t("wizard.step1.errorRequestFailed", { status: res.status }),
        );
        return;
      }
      const data = (await res.json()) as {
        scriptId: string;
        videoBriefId: string;
        scriptOutput: {
          language: string;
          title: string;
          hook: string;
          voiceover: string;
          cta: string;
          captions: { sceneIndex: number; text: string }[];
          complianceNotes: string[];
        };
        fromMock: boolean;
        reason?: string | null;
      };
      const composed = composeFullText(data.scriptOutput);
      setScript({
        scriptId: data.scriptId,
        videoBriefId: data.videoBriefId,
        language: data.scriptOutput.language,
        fullText: composed,
        hook: data.scriptOutput.hook,
        cta: data.scriptOutput.cta,
        version: (script?.version ?? 0) + 1,
        scriptOutput: null,
      });
      setHook(data.scriptOutput.hook);
      setCta(data.scriptOutput.cta);
      setFullText(composed);
      if (data.fromMock) {
        setBannerLevel("info");
        setBannerMsg(
          t("wizard.step3.bannerMockGenerated", {
            reason: data.reason ?? "OpenAI not configured",
          }),
        );
      } else {
        setBannerLevel("info");
        setBannerMsg(t("wizard.step3.bannerLiveGenerated"));
      }
    });
  };

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await fetch(`/api/wizard/projects/${orderId}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hook, cta, fullText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.message ??
            t("wizard.step1.errorRequestFailed", { status: res.status }),
        );
        return;
      }
      setBannerLevel("info");
      setBannerMsg(t("wizard.step3.bannerSaved"));
    });
  };

  return (
    <div className="space-y-5">
      {!cardSelected && (
        <WizardMockBanner
          level="warn"
          message={t("wizard.step3.noDirectionWarning")}
        />
      )}
      {bannerMsg && (
        <WizardMockBanner level={bannerLevel} message={bannerMsg} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">
            {script
              ? t("wizard.step3.cardTitleVersion", { version: script.version })
              : t("wizard.step3.cardTitleEmpty")}
          </CardTitle>
          <Button onClick={generate} disabled={generating} size="sm">
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-2" />
            )}
            {script
              ? t("wizard.step3.regenerateButton")
              : t("wizard.step3.generateButton")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!script ? (
            <p className="text-xs text-muted-foreground">
              {t("wizard.step3.intro")}
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("wizard.step3.hookField")}>
                  <Input value={hook} onChange={(e) => setHook(e.target.value)} />
                </Field>
                <Field label={t("wizard.step3.ctaField")}>
                  <Input value={cta} onChange={(e) => setCta(e.target.value)} />
                </Field>
              </div>
              <Field label={t("wizard.step3.fullTextField")}>
                <Textarea
                  value={fullText}
                  rows={18}
                  onChange={(e) => setFullText(e.target.value)}
                  className="font-mono text-xs"
                />
              </Field>
              <div className="flex gap-2 justify-end">
                <Button onClick={save} disabled={saving} variant="outline" size="sm">
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-2" />
                  )}
                  {t("wizard.step3.saveButton")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <Link href={`/wizard/${orderId}/step-2-card`}>
          <Button variant="outline">{t("wizard.step3.back")}</Button>
        </Link>
        <Button
          onClick={() => router.push(`/wizard/${orderId}/step-4-storyboard`)}
          disabled={!script}
        >
          {t("wizard.step3.continueButton")}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function composeFullText(s: {
  title: string;
  hook: string;
  voiceover: string;
  captions: { sceneIndex: number; text: string }[];
  cta: string;
  complianceNotes: string[];
}) {
  return [
    `# ${s.title}`,
    "",
    "## Hook",
    s.hook,
    "",
    "## Voiceover",
    s.voiceover,
    "",
    "## Captions",
    s.captions.length
      ? s.captions.map((c) => `  [Scene ${c.sceneIndex}] ${c.text}`).join("\n")
      : "(none)",
    "",
    "## CTA",
    s.cta,
    s.complianceNotes.length
      ? `\n## Compliance\n${s.complianceNotes.map((n) => `- ${n}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
