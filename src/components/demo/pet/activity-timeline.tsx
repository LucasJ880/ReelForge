import {
  Activity,
  Moon,
  PawPrint,
  Sparkles,
  UtensilsCrossed,
  Volume2,
} from "lucide-react";
import { PetSection } from "./pet-section";
import {
  activityTimeline,
  type ActivityEventDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

const TYPE_ICON = {
  eating: UtensilsCrossed,
  sleeping: Moon,
  playing: Activity,
  product: Sparkles,
  quiet: Volume2,
  greeting: PawPrint,
} as const;

export function ActivityTimeline() {
  return (
    <PetSection
      id="timeline"
      eyebrow="宠物行为时间线"
      title="AI 看得懂宠物的一整天"
      description="吃饭、睡觉、玩耍、使用产品、异常安静——系统自动识别行为类型并标记关键片段，让你随时了解宠物的日常。"
    >
      <ol className="relative space-y-4 before:absolute before:left-[1.35rem] before:top-2 before:bottom-2 before:w-px before:bg-border sm:before:left-[4.6rem]">
        {activityTimeline.map((event) => (
          <TimelineRow key={event.time} event={event} />
        ))}
      </ol>
    </PetSection>
  );
}

function TimelineRow({ event }: { event: ActivityEventDemo }) {
  const Icon = TYPE_ICON[event.type];
  return (
    <li className="relative flex items-start gap-3 sm:gap-4">
      <span className="hidden w-12 shrink-0 pt-2 text-right text-xs font-semibold tabular-nums text-muted-foreground sm:block">
        {event.time}
      </span>
      <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-success">
        <Icon size={18} />
      </span>
      <div className="border border-border bg-card shadow-editorial flex-1 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-muted-foreground sm:hidden">
            {event.time}
          </span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-meta font-semibold text-primary">
            {event.typeLabel}
          </span>
          <h3 className="text-sm font-semibold text-foreground">
            {event.title}
          </h3>
          {event.captured ? (
            <span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-meta font-medium text-success">
              已采集片段
            </span>
          ) : (
            <span className="ml-auto rounded-full bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning">
              提醒留意
            </span>
          )}
        </div>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {event.detail}
        </p>
      </div>
    </li>
  );
}
