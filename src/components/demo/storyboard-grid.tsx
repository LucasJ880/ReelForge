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
      eyebrow="Step 5 · Storyboard / shooting guide"
      title="6 shots a real estate agent can hand to a phone shooter."
      description="每一张分镜卡都是一条可以直接打印出去拍的指令。包含拍什么、怎么拍、必拍 vs 可选、容易踩的坑。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {storyboardShots.map((shot) => (
          <ShotCard key={shot.sceneIndex} shot={shot} />
        ))}
      </div>

      <p className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-muted-foreground">
        Total: {storyboardShots.length} shots ·{" "}
        {storyboardShots.reduce((sum, s) => sum + s.durationSec, 0)}s ·
        {storyboardShots.filter((s) => s.requiredFlag).length} required ·
        {storyboardShots.filter((s) => !s.requiredFlag).length} optional. Output
        format aligned with{" "}
        <code className="rounded bg-white/5 px-1.5 py-0.5">
          ShootingGuideDoc
        </code>{" "}
        (Phase 2).
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
            {shot.requiredFlag ? "Required" : "Optional"}
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
            Shot {String(shot.sceneIndex).padStart(2, "0")} ·{" "}
            {shot.shotTypeLabel}
          </p>
          <h3 className="mt-1 text-sm font-semibold leading-snug">
            {shot.whatToFilm}
          </h3>
        </div>

        <div className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5">
          <p className="font-medium text-foreground">Camera instruction</p>
          <p className="mt-1 text-muted-foreground">{shot.cameraInstruction}</p>
        </div>

        {shot.voiceoverSegment ? (
          <div className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5">
            <p className="font-medium text-foreground">Spoken line</p>
            <p className="mt-1 italic text-muted-foreground">
              “{shot.voiceoverSegment}”
            </p>
          </div>
        ) : null}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Shooting requirements
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
          <Tag>{`${shot.composition.replace(/_/g, " ")}`}</Tag>
          <Tag>{`${shot.cameraMovement.replace(/_/g, " ")}`}</Tag>
          <Tag>{shot.orientation}</Tag>
          {shot.humanRequired ? <Tag tone="primary">human required</Tag> : null}
        </div>
      </div>
    </article>
  );
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
