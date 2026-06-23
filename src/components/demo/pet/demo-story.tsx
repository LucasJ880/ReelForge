import {
  User,
  Camera,
  Compass,
  Layers,
  Sparkles,
  Building2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PetSection } from "./pet-section";
import {
  DEMO_STORY,
  type DemoStoryStepDemo,
  type StoryActor,
} from "@/lib/demo/pet-content-kit-demo-data";

const ACTOR: Record<StoryActor, { icon: LucideIcon; chip: string; dot: string }> = {
  owner: { icon: User, chip: "bg-secondary text-foreground/70", dot: "bg-foreground/40" },
  camera: {
    icon: Camera,
    chip: "bg-(--pet-orange)/12 text-(--pet-orange)",
    dot: "bg-(--pet-orange)",
  },
  collar: {
    icon: Compass,
    chip: "bg-amber-500/12 text-amber-700",
    dot: "bg-amber-500",
  },
  mat: {
    icon: Layers,
    chip: "bg-(--pet-teal)/12 text-(--pet-teal)",
    dot: "bg-(--pet-teal)",
  },
  ai: {
    icon: Sparkles,
    chip: "bg-primary/12 text-primary",
    dot: "bg-primary",
  },
  brand: {
    icon: Building2,
    chip: "bg-(--pet-teal)/12 text-(--pet-teal)",
    dot: "bg-(--pet-teal)",
  },
};

export function DemoStory() {
  const s = DEMO_STORY;
  return (
    <PetSection
      id="demo-story"
      eyebrow={s.eyebrow}
      title={s.title}
      description={s.description}
    >
      <ol className="relative space-y-4 border-l border-border pl-6">
        {s.steps.map((step) => (
          <StoryStep key={`${step.time}-${step.title}`} step={step} />
        ))}
      </ol>
      <p className="mt-6 rounded-2xl border border-(--pet-teal)/25 bg-(--pet-teal)/6 px-4 py-3 text-xs leading-6 text-foreground/80 sm:text-sm">
        {s.closing}
      </p>
    </PetSection>
  );
}

function StoryStep({ step }: { step: DemoStoryStepDemo }) {
  const actor = ACTOR[step.actor];
  const Icon = actor.icon;
  return (
    <li className="relative">
      <span
        className={`absolute -left-[1.78rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-background ${actor.dot}`}
      />
      <div className="pet-surface rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-background px-2.5 py-1 text-xs font-bold tabular-nums text-foreground">
            {step.time}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${actor.chip}`}
          >
            <Icon size={13} /> {step.actorLabel}
          </span>
          {step.output ? (
            <span className="ml-auto rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
              ↳ {step.output}
            </span>
          ) : null}
        </div>
        <h3 className="mt-3 text-sm font-semibold text-foreground">
          {step.title}
        </h3>
        <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
          {step.body}
        </p>
      </div>
    </li>
  );
}
