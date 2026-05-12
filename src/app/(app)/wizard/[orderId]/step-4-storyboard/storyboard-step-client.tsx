"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Camera,
  Loader2,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WizardMockBanner } from "@/components/wizard/wizard-mock-banner";
import { useTranslation } from "@/i18n/useTranslation";

type CurrentStoryboard = Awaited<
  ReturnType<typeof import("@/lib/services/wizard-storyboard-service").getCurrentWizardStoryboard>
>;

type ShootingGuideShape = {
  whatToFilm?: string;
  shotType?: string;
  composition?: string;
  cameraMovement?: string;
  orientation?: string;
  requiredProps?: string[];
  commonMistakes?: string[];
  uploadHints?: string[];
  lightingNote?: string;
  audioNote?: string;
  captionText?: string;
  voiceoverSegment?: string;
};

export function StoryboardStepClient({
  orderId,
  scriptReady,
  initialStoryboard,
}: {
  orderId: string;
  scriptReady: boolean;
  initialStoryboard: CurrentStoryboard;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [storyboard, setStoryboard] = useState(initialStoryboard);
  const [generating, startGenerate] = useTransition();
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [bannerLevel, setBannerLevel] = useState<"info" | "warn">("info");
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    startGenerate(async () => {
      const res = await fetch(
        `/api/wizard/projects/${orderId}/storyboard`,
        { method: "POST" },
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
        scenePlanIds: string[];
        storyboard: { totalDurationSec: number; shots: Shot[] };
        shootingGuideItems: ShootingGuideShape[];
        fromMock: boolean;
        reason?: string | null;
        durationConsistencyIssues: string[];
      };
      const newScenePlans = data.storyboard.shots.map((shot, i) => ({
        id: data.scenePlanIds[i] ?? `tmp-${i}`,
        sceneIndex: shot.sceneIndex,
        durationSec: shot.durationSec,
        visualIntent: shot.visualIntent,
        requiredFlag: shot.requiredFlag,
        humanRequired: shot.humanRequired,
        onCameraNote: shot.onCameraNote ?? null,
        shootingGuide: data.shootingGuideItems[i] as unknown,
      }));
      setStoryboard({
        scriptId: data.scriptId,
        scenePlans: newScenePlans,
      });
      if (data.fromMock) {
        setBannerLevel("info");
        setBannerMsg(
          t("wizard.step4.bannerMockGenerated", {
            reason: data.reason ?? "OpenAI not configured",
          }),
        );
      } else {
        setBannerLevel("info");
        setBannerMsg(
          t("wizard.step4.bannerLiveGenerated", {
            count: data.storyboard.shots.length,
            note: data.durationConsistencyIssues.length
              ? " " + data.durationConsistencyIssues.join("; ")
              : "",
          }),
        );
      }
    });
  };

  return (
    <div className="space-y-5">
      {!scriptReady && (
        <WizardMockBanner
          level="warn"
          message={t("wizard.step4.noScriptWarning")}
        />
      )}
      {bannerMsg && (
        <WizardMockBanner level={bannerLevel} message={bannerMsg} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">
            {storyboard
              ? t("wizard.step4.cardTitleCount", {
                  count: storyboard.scenePlans.length,
                })
              : t("wizard.step4.cardTitleEmpty")}
          </CardTitle>
          <Button onClick={generate} disabled={generating || !scriptReady} size="sm">
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-2" />
            )}
            {storyboard
              ? t("wizard.step4.regenerateButton")
              : t("wizard.step4.generateButton")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!storyboard ? (
            <p className="text-xs text-muted-foreground">
              {t("wizard.step4.intro")}
            </p>
          ) : (
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
              {storyboard.scenePlans.map((s) => (
                <ShotCard key={s.id} shot={s} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <Link href={`/wizard/${orderId}/step-3-script`}>
          <Button variant="outline">{t("wizard.step4.back")}</Button>
        </Link>
        <Button
          onClick={() => router.push(`/wizard/${orderId}/step-5-upload`)}
          disabled={!storyboard}
        >
          {t("wizard.step4.continueButton")}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

type Shot = {
  sceneIndex: number;
  durationSec: number;
  visualIntent: string;
  requiredFlag: boolean;
  humanRequired: boolean;
  onCameraNote?: string;
};

function ShotCard({
  shot,
}: {
  shot: {
    id: string;
    sceneIndex: number;
    durationSec: number;
    visualIntent: string;
    requiredFlag: boolean;
    humanRequired: boolean;
    onCameraNote: string | null;
    shootingGuide: unknown;
  };
}) {
  const { t } = useTranslation();
  const guide = (shot.shootingGuide ?? {}) as ShootingGuideShape;
  return (
    <div className="rounded-lg border border-white/10 bg-card/40 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className="bg-foreground text-background border-foreground text-[10px]">
            {t("wizard.step4.shotLabel", { index: shot.sceneIndex })}
          </Badge>
          <span className="text-muted-foreground">{shot.durationSec}s</span>
        </div>
        <div className="flex items-center gap-1">
          {shot.requiredFlag ? (
            <Badge className="bg-rose-500/15 text-rose-200 border border-rose-400/30 text-[10px]">
              {t("wizard.step4.requiredBadge")}
            </Badge>
          ) : (
            <Badge className="bg-white/5 text-muted-foreground border border-white/10 text-[10px]">
              {t("wizard.step4.optionalBadge")}
            </Badge>
          )}
          {shot.humanRequired && (
            <Badge className="bg-sky-500/15 text-sky-200 border border-sky-400/30 text-[10px]">
              <Users className="h-2.5 w-2.5 mr-1" /> {t("wizard.step4.humanBadge")}
            </Badge>
          )}
        </div>
      </div>
      <p className="text-foreground/85">{guide.whatToFilm ?? shot.visualIntent}</p>
      <div className="flex flex-wrap gap-1">
        {guide.shotType && <ChipIcon icon={Camera} text={guide.shotType} />}
        {guide.composition && <Chip text={guide.composition} />}
        {guide.cameraMovement && <Chip text={guide.cameraMovement} />}
        {guide.orientation && <Chip text={guide.orientation} />}
      </div>
      {guide.requiredProps && guide.requiredProps.length > 0 && (
        <p className="text-muted-foreground">
          {t("wizard.step4.propsLabel")}：{guide.requiredProps.join(" · ")}
        </p>
      )}
      {guide.captionText && (
        <p className="text-emerald-200/90">
          {t("wizard.step4.captionLabel")}：{guide.captionText}
        </p>
      )}
      {guide.commonMistakes && guide.commonMistakes.length > 0 && (
        <ul className="text-amber-200/90 list-disc list-inside">
          {guide.commonMistakes.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]">
      {text}
    </span>
  );
}

function ChipIcon({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]">
      <Icon className="h-2.5 w-2.5" /> {text}
    </span>
  );
}
