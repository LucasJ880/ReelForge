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
  { key: "founder", label: "品牌创始人 / 真人出镜" },
  { key: "ai_avatar", label: "AI 数字人剪影（需授权）" },
  { key: "voiceover_only", label: "仅画外音 · 无人出镜" },
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
      eyebrow="第 1 步 · 客户输入"
      title="告诉系统这条视频要做什么、给谁看。"
      description={
        <span>
          这一步对应{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">/business/create-ad-video</code>{" "}
          的 Unified Creative Input。下面是一组示例输入，点击选项仅切换高亮状态，
          不会真正触发后端生成。
        </span>
      }
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-6 rounded-lg border border-border bg-card p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-4">
          <Field
            icon={<Building2 size={16} />}
            label="行业"
            value={demoProject.industryLabel}
          />
          <Field
            icon={<Target size={16} />}
            label="推广目标"
            value={demoProject.goalLabel}
          />
          <Field
            icon={<MapPin size={16} />}
            label="所在城市"
            value={demoProject.city}
          />
          <Field
            icon={<Sparkles size={16} />}
            label="核心信息"
            value={demoProject.keyMessage}
          />
        </div>

        <div className="grid gap-5">
          <ChipsRow
            icon={<Globe2 size={16} />}
            label="发布平台"
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
            label="是否已有素材"
            chips={[
              { key: "yes", label: "已有素材", active: demoProject.hasFootage },
              { key: "no", label: "暂无，需要安排拍摄", active: !demoProject.hasFootage },
            ]}
            onSelect={() => {
              /* visual only */
            }}
          />

          <ChipsRow
            icon={<Sparkles size={16} />}
            label="出镜方式"
            chips={HUMAN_OPTIONS.map((opt) => ({
              key: opt.key,
              label: opt.label,
              active: human === opt.key,
            }))}
            onSelect={(key) => setHuman(key as DemoProjectInput["humanOnCamera"])}
          />

          <ChipsRow
            icon={<Sparkles size={16} />}
            label="视频时长"
            chips={VIDEO_LENGTH_OPTIONS.map((sec) => ({
              key: String(sec),
              label: `${sec} 秒`,
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
        点击只会切换演示页的高亮状态 —— 第一版不接后端，避免误导客户以为已经在生成。
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
    <div className="rounded-lg border border-border bg-muted p-4">
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
              "rounded-full border px-3 py-1.5 text-xs font-medium",
              chip.active
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border bg-muted text-muted-foreground hover:bg-muted",
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
