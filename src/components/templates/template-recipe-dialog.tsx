"use client";

import { BookOpenText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TEMPLATE_LIBRARY_COPY, fillCount } from "@/components/templates/template-library-copy";
import { parseTemplateShots } from "@/components/templates/template-shot-timeline";
import { summarizeRecipeGuards } from "@/components/templates/recipe-summary";

/**
 * 质量配方弹窗（1025 · B2.5）：给客户看人话摘要——镜头节奏、锁定参数、排除了哪几类瑕疵。
 * 不再展示英文提示词原文与「Negative Prompt」：那是给生成模型的指令，不是给商家的说明。
 * 摘要从同一份 promptSkeleton / negativePrompt 读出，和批量生成实际用的配方一致。
 */
export function TemplateRecipeDialog({
  name,
  version,
  promptSkeleton,
  negativePrompt,
  english,
  summary,
  lockedParams,
  triggerVariant = "ghost",
}: {
  name: string;
  version: number;
  promptSkeleton: string;
  negativePrompt: string;
  english: boolean;
  summary?: string | null;
  lockedParams?: {
    stability?: "high" | "balanced";
    humanInteraction?: "none" | "controlled";
    duration?: number;
    aspectRatio?: string;
  };
  triggerVariant?: "ghost" | "outline";
}) {
  const locale = english ? "en-US" : "zh-CN";
  const timelineCopy = TEMPLATE_LIBRARY_COPY[locale].timeline;
  const shots = parseTemplateShots(promptSkeleton);
  const guards = summarizeRecipeGuards(negativePrompt, locale);
  const params = lockedParams
    ? [
        lockedParams.duration ? `${lockedParams.duration}s` : null,
        lockedParams.aspectRatio ?? null,
        lockedParams.stability === "high" ? (english ? "Stability first" : "稳定优先") : lockedParams.stability ? (english ? "Creative balance" : "创意均衡") : null,
        lockedParams.humanInteraction === "none" ? (english ? "No people" : "无真人") : lockedParams.humanInteraction ? (english ? "Controlled interaction" : "交互受控") : null,
      ].filter((value): value is string => Boolean(value))
    : [];

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant={triggerVariant} size="sm">
            <BookOpenText aria-hidden />
            {english ? "View recipe" : "查看质量配方"}
          </Button>
        }
      />
      <DialogContent className="max-h-[min(88vh,52rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {english
              ? `Template v${version} · what this template locks in every batch video.`
              : `模板 v${version} · 这个模板在批量生成的每一条里锁住了什么。`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {summary ? <p className="text-body text-foreground">{summary}</p> : null}

          {params.length > 0 ? (
            <section className="space-y-2">
              <h3 className="x-label">{english ? "Locked settings" : "锁定参数"}</h3>
              <p className="font-mono text-data tabular-nums text-foreground">{params.join(" · ")}</p>
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="x-label">{english ? "Shot rhythm" : "镜头节奏"}</h3>
            {shots.length > 0 ? (
              <ol className="x-wall">
                {shots.map((shot) => (
                  <li key={`${shot.start}-${shot.beat}`} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                    <span className="text-body text-foreground">{timelineCopy.beats[shot.beat] ?? shot.beat}</span>
                    <span className="font-mono text-data tabular-nums text-muted-foreground">
                      {shot.start}–{shot.end}s
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-meta text-muted-foreground">{timelineCopy.none}</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="x-label">
              {english
                ? `Quality guards · ${guards.ruleCount} rules`
                : fillCount("质量约束 · 共 {n} 条", guards.ruleCount)}
            </h3>
            {guards.groups.length > 0 ? (
              <ul className="space-y-1.5">
                {guards.groups.map((group) => (
                  <li key={group.id} className="flex items-start gap-2 text-meta text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-tertiary" aria-hidden />
                    <span>{group.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-meta text-muted-foreground">
              {english
                ? "Your uploaded product images are the reference; product accuracy and continuity always win over spectacle."
                : "你上传的产品图就是参照；产品真实性与连续性永远优先于视觉奇观。"}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
