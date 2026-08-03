"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * 一键把「待生成配图」的整批图文出完（PRD O1 验收：一句话到一周可发内容，
 * 无需逐帖手工补齐）。仍由商家主动点一次——不做无感自动扣费。
 * 逐帖串行调用既有 render API，失败的帖子留在待生成区可单独重试。
 */

const COPY = {
  "zh-CN": {
    idle: "一键生成全部配图（{n} 帖）",
    running: "出图中 {done}/{total}…",
    partial: "完成 {ok} 帖，{fail} 帖失败（可去本周内容单独重试）",
  },
  "en-US": {
    idle: "Generate all images ({n} posts)",
    running: "Rendering {done}/{total}…",
    partial: "{ok} done, {fail} failed (retry them in This Week)",
  },
} as const;

export type PendingPostRef = { planId: string; postId: string };

export function RenderPendingPostsButton({ items }: { items: PendingPostRef[] }) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = COPY[locale === "en-US" ? "en-US" : "zh-CN"];
  const [progress, setProgress] = useState<{ done: number; failed: number } | null>(null);
  const [summary, setSummary] = useState<{ ok: number; fail: number } | null>(null);
  const running = progress !== null;

  async function handleRun() {
    setSummary(null);
    setProgress({ done: 0, failed: 0 });
    let failed = 0;
    for (const [index, item] of items.entries()) {
      try {
        const res = await fetch(
          `/api/content-plans/${item.planId}/posts/${item.postId}/render`,
          { method: "POST" },
        );
        if (!res.ok) failed += 1;
      } catch {
        failed += 1;
      }
      setProgress({ done: index + 1, failed });
    }
    setProgress(null);
    if (failed > 0) setSummary({ ok: items.length - failed, fail: failed });
    router.refresh();
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {summary ? (
        <span className="text-meta text-muted-foreground">
          {copy.partial
            .replace("{ok}", String(summary.ok))
            .replace("{fail}", String(summary.fail))}
        </span>
      ) : null}
      <Button type="button" size="sm" disabled={running} onClick={() => void handleRun()}>
        {running ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Sparkles aria-hidden />
        )}
        {running
          ? copy.running
              .replace("{done}", String(progress?.done ?? 0))
              .replace("{total}", String(items.length))
          : copy.idle.replace("{n}", String(items.length))}
      </Button>
    </div>
  );
}
