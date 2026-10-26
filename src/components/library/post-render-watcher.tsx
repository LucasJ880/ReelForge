"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  isContentPostRenderActive,
  type ContentPostRenderView,
} from "@/lib/contracts/content-post-render";
import type { PendingPostRef } from "./render-pending-posts-button";

/**
 * 成品库「出图中 · 图文」分区的看守（C2）：每 2.5 秒拉一次这几帖的出图进度
 * （GET 同时在服务端推进对账），多出一张或任意一帖结束就刷新页面，让行移到该去的分区。
 * 页面回到前台时立即补一拍。不渲染任何东西。
 */
export function PostRenderWatcher({ items }: { items: PendingPostRef[] }) {
  const router = useRouter();
  const key = items.map((item) => `${item.planId}/${item.postId}`).join(",");
  const doneByPost = useRef(new Map<string, number>());

  useEffect(() => {
    if (!key) return;
    const refs = key.split(",").map((pair) => {
      const [planId, postId] = pair.split("/");
      return { planId: planId ?? "", postId: postId ?? "" };
    });
    let cancelled = false;
    let timer = 0;
    /// 同一时刻只有一拍在路上（切回前台补的那一拍不和定时的叠成两条链）。
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const views = await Promise.all(
        refs.map(async (ref) => {
          try {
            const res = await fetch(`/api/content-plans/${ref.planId}/posts/${ref.postId}/render`, {
              cache: "no-store",
            });
            const body = (await res.json().catch(() => null)) as
              | { ok: true; render: ContentPostRenderView }
              | null;
            return res.ok && body?.ok ? body.render : null;
          } catch {
            return null;
          }
        }),
      );
      polling = false;
      if (cancelled) return;
      let changed = false;
      for (const view of views) {
        if (!view) continue;
        const before = doneByPost.current.get(view.postId);
        doneByPost.current.set(view.postId, view.done);
        if (!isContentPostRenderActive(view) || (before !== undefined && view.done > before)) changed = true;
      }
      if (changed) router.refresh();
      timer = window.setTimeout(poll, 2_500);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || cancelled || polling) return;
      window.clearTimeout(timer);
      void poll();
    };
    timer = window.setTimeout(poll, 2_500);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, router]);

  return null;
}
