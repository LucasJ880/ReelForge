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
        setError(data.message ?? `请求失败 (${res.status})`);
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
      /// 把 storyboard 转成 ScenePlan 形式给 UI 复用
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
          `已生成 mock 分镜 + 拍摄指导草稿（${data.reason ?? "未启用 OpenAI"}）。结构、必拍标记、上传提示都是真实可用的——客户照拍即可。`,
        );
      } else {
        setBannerLevel("info");
        setBannerMsg(
          `已生成 ${data.storyboard.shots.length} 个镜头（来自 OpenAI）。${
            data.durationConsistencyIssues.length
              ? "时长有偏差：" +
                data.durationConsistencyIssues.join("；")
              : ""
          }`,
        );
      }
    });
  };

  return (
    <div className="space-y-5">
      {!scriptReady && (
        <WizardMockBanner
          level="warn"
          message="还没有生成脚本：请先回到 Step 3 生成或编辑脚本。"
        />
      )}
      {bannerMsg && (
        <WizardMockBanner level={bannerLevel} message={bannerMsg} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">
            {storyboard
              ? `当前分镜 · ${storyboard.scenePlans.length} 镜头`
              : "尚未生成分镜"}
          </CardTitle>
          <Button onClick={generate} disabled={generating || !scriptReady} size="sm">
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-2" />
            )}
            {storyboard ? "重新生成" : "生成分镜"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!storyboard ? (
            <p className="text-xs text-muted-foreground">
              点击「生成分镜」开始。生成会清掉旧的 ScenePlan 并新建一组。
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
          <Button variant="outline">返回 Step 3</Button>
        </Link>
        <Button
          onClick={() => router.push(`/wizard/${orderId}/step-5-upload`)}
          disabled={!storyboard}
        >
          前往 Step 5 · 上传素材 <ArrowRight className="h-4 w-4 ml-2" />
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
  const guide = (shot.shootingGuide ?? {}) as ShootingGuideShape;
  return (
    <div className="rounded-lg border border-white/10 bg-card/40 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className="bg-foreground text-background border-foreground text-[10px]">
            Shot {shot.sceneIndex}
          </Badge>
          <span className="text-muted-foreground">{shot.durationSec}s</span>
        </div>
        <div className="flex items-center gap-1">
          {shot.requiredFlag ? (
            <Badge className="bg-rose-500/15 text-rose-200 border border-rose-400/30 text-[10px]">
              必拍
            </Badge>
          ) : (
            <Badge className="bg-white/5 text-muted-foreground border border-white/10 text-[10px]">
              可选
            </Badge>
          )}
          {shot.humanRequired && (
            <Badge className="bg-sky-500/15 text-sky-200 border border-sky-400/30 text-[10px]">
              <Users className="h-2.5 w-2.5 mr-1" /> 真人
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
          道具：{guide.requiredProps.join(" · ")}
        </p>
      )}
      {guide.captionText && (
        <p className="text-emerald-200/90">
          字幕：{guide.captionText}
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
