"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * 一键把「待生成配图」的整批图文开出去（PRD O1 验收：一句话到一周可发内容，
 * 无需逐帖手工补齐）。仍由商家主动点一次——不做无感自动扣费。
 *
 * C2：出图改走 Shuyu 异步——这里逐帖调用既有 render API 只是「开一轮」（202 立即返回），
 * 不再等图出完；出图中的帖子在成品库「出图中」分区看进度（PostRenderWatcher 出完自动刷新）。
 * 已经在出图的帖子跳过（服务端也是幂等的：正在出图的再点只返回进度，不会重复提交）。
 * 没能开始的帖子留在待生成区，可去本周内容单独重试或弃用。
 */

const COPY = {
  "zh-CN": {
    idle: "一键生成全部配图（{n} 帖）",
    running: "提交中 {done}/{total}…",
    started: "已开始出图 {ok} 帖，出完会自动出现在成片区",
    partial: "已开始 {ok} 帖，{fail} 帖没能开始（可去本周内容单独重试）",
  },
  "en-US": {
    idle: "Generate all images ({n} posts)",
    running: "Submitting {done}/{total}…",
    started: "Started {ok} posts — they appear under Finished when done",
    partial: "{ok} started, {fail} couldn't start (retry them in This Week)",
  },
} as const;

export type PendingPostRef = { planId: string; postId: string };

export function RenderPendingPostsButton({
  items,
  renderingItems = [],
}: {
  items: PendingPostRef[];
  /** 已经在出图的帖子：不再提交（避免对同一帖开第二轮）。 */
  renderingItems?: PendingPostRef[];
}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = COPY[locale === "en-US" ? "en-US" : "zh-CN"];
  const [progress, setProgress] = useState<{ done: number } | null>(null);
  const [summary, setSummary] = useState<{ ok: number; fail: number } | null>(null);
  const running = progress !== null;
  const skip = new Set(renderingItems.map((item) => item.postId));
  const queue = items.filter((item) => !skip.has(item.postId));

  async function handleRun() {
    setSummary(null);
    setProgress({ done: 0 });
    let failed = 0;
    for (const [index, item] of queue.entries()) {
      try {
        /// 202 = 这一轮开始出图（或本来就在出图，服务端原样返回进度）；200 = 已出齐 / 回滚线路同步出完。
        const res = await fetch(
          `/api/content-plans/${item.planId}/posts/${item.postId}/render`,
          { method: "POST" },
        );
        if (!res.ok) failed += 1;
      } catch {
        failed += 1;
      }
      setProgress({ done: index + 1 });
    }
    setProgress(null);
    setSummary({ ok: queue.length - failed, fail: failed });
    router.refresh();
  }

  if (queue.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {summary ? (
        <span className="text-meta text-muted-foreground">
          {(summary.fail > 0 ? copy.partial : copy.started)
            .replace("{ok}", String(summary.ok))
            .replace("{fail}", String(summary.fail))}
        </span>
      ) : null}
      <Button type="button" size="sm" disabled={running} onClick={() => void handleRun()}>
        {running ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <ImagePlus aria-hidden />
        )}
        {running
          ? copy.running
              .replace("{done}", String(progress?.done ?? 0))
              .replace("{total}", String(queue.length))
          : copy.idle.replace("{n}", String(queue.length))}
      </Button>
    </div>
  );
}
