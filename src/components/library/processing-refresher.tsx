"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 成片详情的看守（2026-10-28 闭环轮 E2E）：视频还在生成时每 15 秒刷新一次服务端数据，
 * 进度和成片自己长出来，不用商家手动刷新。页面在后台时不拉，回到前台立即补一拍。不渲染任何东西。
 */
export function ProcessingRefresher({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, router]);
  return null;
}
