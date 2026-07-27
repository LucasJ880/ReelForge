import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import type {
  MakingProcessStep,
  MakingProcessStepStatus,
} from "@/lib/services/unified-library-service";
import { cn } from "@/lib/utils";

const labels = {
  brief: { zh: "需求确认", en: "Brief locked" },
  storyboard: { zh: "分镜设计", en: "Storyboard" },
  generation: { zh: "视频生成", en: "Video generation" },
  "post-production": { zh: "后期制作", en: "Post-production" },
} as const;

const summaries: Record<string, { zh: string; en: string }> = {
  brief_locked: { zh: "创作方向与素材已确认", en: "Creative direction and assets confirmed" },
  brief_failed: { zh: "需求处理未通过", en: "Brief processing failed" },
  storyboard_approved: { zh: "分镜已确认并用于生成", en: "Storyboard approved for generation" },
  storyboard_failed: { zh: "分镜生成未完成", en: "Storyboard generation failed" },
  storyboard_generating: { zh: "正在生成分镜", en: "Generating storyboard" },
  storyboard_waiting: { zh: "分镜等待确认", en: "Storyboard awaiting approval" },
  storyboard_not_recorded: { zh: "历史项目无分镜记录", en: "No storyboard record for this legacy project" },
  generation_completed: { zh: "所有镜头均已生成", en: "All scenes generated" },
  generation_running: { zh: "正在生成视频镜头", en: "Generating video scenes" },
  generation_failed: { zh: "部分镜头生成失败", en: "One or more scenes failed" },
  generation_pending: { zh: "等待视频生成", en: "Waiting for video generation" },
  post_ready: { zh: "拼接与成片处理已完成", en: "Assembly and final processing complete" },
  post_failed: { zh: "成片处理未完成", en: "Final processing failed" },
  post_processing: { zh: "正在拼接并完成成片", en: "Assembling and finishing the video" },
  post_pending: { zh: "等待后期制作", en: "Waiting for post-production" },
};

function statusIcon(status: MakingProcessStepStatus) {
  if (status === "completed") {
    return <CheckCircle2 className="size-5 text-success" aria-hidden />;
  }
  if (status === "current") {
    return (
      <Loader2
        className="size-5 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (status === "failed") {
    return <TriangleAlert className="size-5 text-destructive" aria-hidden />;
  }
  return <CircleDashed className="size-5 text-muted-foreground" aria-hidden />;
}

function formatTimestamp(value: Date, english: boolean) {
  return new Intl.DateTimeFormat(english ? "en-CA" : "zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function MakingProcessTimeline({
  steps,
  english,
}: {
  steps: MakingProcessStep[];
  english: boolean;
}) {
  return (
    <section
      aria-labelledby="making-process-title"
      className="rounded-(--radius-lg) border border-border bg-card p-5 shadow-editorial md:p-6"
    >
      <div className="mb-5 flex items-center gap-2">
        <Clock3 className="size-5 text-primary" aria-hidden />
        <h2 id="making-process-title" className="font-heading text-subhead">
          {english ? "Making process" : "制作过程"}
        </h2>
      </div>
      <ol className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => {
          const label = labels[step.key];
          const summary = summaries[step.summary];
          return (
            <li
              key={step.key}
              className={cn(
                "relative rounded-(--radius-md) border p-4",
                step.status === "current"
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-background/60",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">{statusIcon(step.status)}</span>
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    <span className="mr-1.5 font-mono text-meta text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {english ? label.en : label.zh}
                  </p>
                  <p className="text-meta leading-relaxed text-muted-foreground">
                    {summary
                      ? english
                        ? summary.en
                        : summary.zh
                      : step.summary}
                    {step.total
                      ? ` · ${step.completed ?? 0}/${step.total}`
                      : ""}
                  </p>
                  {step.timestamp ? (
                    <time
                      dateTime={step.timestamp.toISOString()}
                      className="block font-mono text-meta tabular-nums text-muted-foreground"
                    >
                      {formatTimestamp(step.timestamp, english)}
                    </time>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
