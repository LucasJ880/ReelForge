import {
  Camera,
  Clock,
  Home,
  ImageIcon,
  ChefHat,
  Bed,
  User,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  storyboardShots,
  type StoryboardShotDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

const ICON_MAP: Record<StoryboardShotDemo["visualPlaceholder"]["iconKey"], React.ReactNode> = {
  agent: <User size={32} />,
  exterior: <Home size={32} />,
  living: <ImageIcon size={32} />,
  kitchen: <ChefHat size={32} />,
  bedroom: <Bed size={32} />,
  cta: <Camera size={32} />,
};

export function StoryboardGrid() {
  return (
    <DemoSection
      id="storyboard"
      eyebrow="第 5 步 · 分镜与拍摄指导"
      title="6 张可以直接交给经纪人或助理去拍的分镜卡。"
      description="每张分镜卡都是一条可以打印出去对照拍的指令：拍什么、怎么拍、是否必拍、容易踩哪些坑。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {storyboardShots.map((shot) => (
          <ShotCard key={shot.sceneIndex} shot={shot} />
        ))}
      </div>

      <p className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-muted-foreground">
        合计 {storyboardShots.length} 个镜头 · 总时长{" "}
        {storyboardShots.reduce((sum, s) => sum + s.durationSec, 0)} 秒 · 必拍{" "}
        {storyboardShots.filter((s) => s.requiredFlag).length} · 可选{" "}
        {storyboardShots.filter((s) => !s.requiredFlag).length}。输出结构对齐{" "}
        <code className="rounded bg-white/5 px-1.5 py-0.5">
          ShootingGuideDoc
        </code>{" "}
        （Phase 2）。
      </p>
    </DemoSection>
  );
}

function ShotCard({ shot }: { shot: StoryboardShotDemo }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-card/70">
      <div
        className={cn(
          "relative aspect-[9/12] w-full bg-gradient-to-br",
          shot.visualPlaceholder.gradient,
        )}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/30 backdrop-blur">
            {ICON_MAP[shot.visualPlaceholder.iconKey]}
          </div>
          <p className="mt-3 text-sm font-semibold tracking-wide">
            {shot.visualPlaceholder.accentLabel}
          </p>
        </div>

        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-mono text-white backdrop-blur">
            <Clock size={10} /> {shot.durationSec}s
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur",
              shot.requiredFlag
                ? "bg-rose-500/40 text-white"
                : "bg-white/10 text-white/85",
            )}
          >
            {shot.requiredFlag ? "必拍" : "可选"}
          </span>
        </div>

        {shot.captionText ? (
          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/55 px-3 py-2 text-center text-xs leading-5 text-white backdrop-blur">
            {shot.captionText}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
            镜头 {String(shot.sceneIndex).padStart(2, "0")} ·{" "}
            {shot.shotTypeLabel}
          </p>
          <h3 className="mt-1 text-sm font-semibold leading-snug">
            {shot.whatToFilm}
          </h3>
        </div>

        <div className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5">
          <p className="font-medium text-foreground">运镜指令</p>
          <p className="mt-1 text-muted-foreground">{shot.cameraInstruction}</p>
        </div>

        {shot.voiceoverSegment ? (
          <div className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5">
            <p className="font-medium text-foreground">对应口播</p>
            <p className="mt-1 italic text-muted-foreground">
              “{shot.voiceoverSegment}”
            </p>
          </div>
        ) : null}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            拍摄要点
          </p>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
            {shot.shootingRequirements.map((req) => (
              <li key={req} className="flex items-start gap-2">
                <CheckCircle2
                  size={11}
                  className="mt-1 shrink-0 text-emerald-300"
                />
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5 text-[10px]">
          <Tag>{compositionZh(shot.composition)}</Tag>
          <Tag>{movementZh(shot.cameraMovement)}</Tag>
          <Tag>{orientationZh(shot.orientation)}</Tag>
          {shot.humanRequired ? <Tag tone="primary">需要真人出镜</Tag> : null}
        </div>
      </div>
    </article>
  );
}

const COMPOSITION_ZH: Record<string, string> = {
  rule_of_thirds: "三分构图",
  centered: "居中构图",
  symmetrical: "对称构图",
  leading_lines: "引导线",
  frame_within_frame: "画中画",
  negative_space: "留白",
};

const MOVEMENT_ZH: Record<string, string> = {
  static: "静止",
  pan: "横摇",
  tilt: "俯仰",
  push_in: "推进",
  pull_out: "拉远",
  tracking: "跟拍",
  handheld: "手持",
  gimbal: "稳定器",
};

function compositionZh(c: string): string {
  return COMPOSITION_ZH[c] ?? c.replace(/_/g, " ");
}

function movementZh(m: string): string {
  return MOVEMENT_ZH[m] ?? m.replace(/_/g, " ");
}

function orientationZh(o: string): string {
  if (o === "portrait") return "竖屏";
  if (o === "landscape") return "横屏";
  if (o === "square") return "方屏";
  return o;
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "primary";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-medium",
        tone === "primary"
          ? "bg-primary/15 text-primary"
          : "bg-white/[0.05] text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
