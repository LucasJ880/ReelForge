"use client";

import { useState } from "react";
import { Building2, Camera, Globe2, MapPin, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  demoProject,
  type DemoProjectInput,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

const VIDEO_LENGTH_OPTIONS: ReadonlyArray<DemoProjectInput["videoLengthSec"]> = [
  15, 30, 45, 60,
];

const HUMAN_OPTIONS: ReadonlyArray<{
  key: DemoProjectInput["humanOnCamera"];
  label: string;
}> = [
  { key: "agent", label: "Agent on camera" },
  { key: "ai_avatar", label: "AI avatar (with consent)" },
  { key: "voiceover_only", label: "Voice-over only" },
];

export function DemoInputPanel() {
  const [length, setLength] = useState<DemoProjectInput["videoLengthSec"]>(
    demoProject.videoLengthSec,
  );
  const [human, setHuman] = useState<DemoProjectInput["humanOnCamera"]>(
    demoProject.humanOnCamera,
  );

  return (
    <DemoSection
      id="input"
      eyebrow="Step 1 · Customer input"
      title="Tell the system what you want this video to do."
      description={
        <span>
          这一步对应 <code className="rounded bg-white/5 px-1.5 py-0.5">/wizard/new</code>{" "}
          的客户输入面板。下面是一组示例输入，点击 chip 仅切换 active 状态，
          不会真正触发后端生成。
        </span>
      }
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-6 rounded-[2rem] border border-white/10 bg-card/60 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-4">
          <Field
            icon={<Building2 size={16} />}
            label="Industry"
            value={demoProject.industryLabel}
          />
          <Field
            icon={<Target size={16} />}
            label="Goal"
            value={demoProject.goalLabel}
          />
          <Field
            icon={<MapPin size={16} />}
            label="City"
            value={demoProject.city}
          />
          <Field
            icon={<Sparkles size={16} />}
            label="Key message"
            value={demoProject.keyMessage}
          />
        </div>

        <div className="grid gap-5">
          <ChipsRow
            icon={<Globe2 size={16} />}
            label="Platforms"
            chips={demoProject.platforms.map((p) => ({
              key: p.key,
              label: p.label,
              active: true,
            }))}
            onSelect={() => {
              /* visual only */
            }}
          />

          <ChipsRow
            icon={<Camera size={16} />}
            label="Has footage"
            chips={[
              { key: "yes", label: "Yes", active: demoProject.hasFootage },
              { key: "no", label: "No, plan a shoot", active: !demoProject.hasFootage },
            ]}
            onSelect={() => {
              /* visual only */
            }}
          />

          <ChipsRow
            icon={<Sparkles size={16} />}
            label="Human on camera"
            chips={HUMAN_OPTIONS.map((opt) => ({
              key: opt.key,
              label: opt.label,
              active: human === opt.key,
            }))}
            onSelect={(key) => setHuman(key as DemoProjectInput["humanOnCamera"])}
          />

          <ChipsRow
            icon={<Sparkles size={16} />}
            label="Video length"
            chips={VIDEO_LENGTH_OPTIONS.map((sec) => ({
              key: String(sec),
              label: `${sec}s`,
              active: length === sec,
            }))}
            onSelect={(key) =>
              setLength(
                Number(key) as DemoProjectInput["videoLengthSec"],
              )
            }
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        交互仅切换 UI active 状态 —— 第一版不接后端，避免误导客户认为已经在生成。
      </p>
    </DemoSection>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-sm font-medium leading-6">{value}</p>
    </div>
  );
}

function ChipsRow({
  icon,
  label,
  chips,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  chips: ReadonlyArray<{ key: string; label: string; active: boolean }>;
  onSelect: (key: string) => void;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onSelect(chip.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              chip.active
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05]",
            )}
            aria-pressed={chip.active}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
