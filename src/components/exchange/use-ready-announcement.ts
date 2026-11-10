"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ExchangePulse } from "@/lib/exchange/pulse";
import { nextReadyAnnouncement } from "@/lib/exchange/ready-announcement";

type AnnouncementCopy = { toast: string; action: string; tabTitle: string };

/**
 * 成片做好时在站内说一声（2026-11-10）。出片中位约 10 分钟、长的要四十多分钟，之前做好了没有任何提示，
 * 商家只能自己回成品库刷新。现在：壳层脉搏带回「最近做好的一条」，比上次见到的新就弹一条可点的提示；
 * 标签页在后台时把标签页标题换成「成片做好了」，切回来再还原。只提示打开页面之后做好的，不翻旧账。
 */
export function useReadyAnnouncement({
  pulse,
  pathname,
  copy,
  onOpen,
}: {
  pulse: ExchangePulse;
  pathname: string;
  copy: AnnouncementCopy;
  onOpen: (href: string) => void;
}): void {
  /// 基线：首屏那一刻已经做好的不算新；之后每提示一条就前移
  const seenAt = useRef(pulse.latestReady?.at ?? pulse.at);
  const restoreTitle = useRef<string | null>(null);
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const restore = () => {
      if (document.visibilityState !== "visible" || restoreTitle.current === null) return;
      document.title = restoreTitle.current;
      restoreTitle.current = null;
    };
    document.addEventListener("visibilitychange", restore);
    return () => document.removeEventListener("visibilitychange", restore);
  }, []);

  const latest = pulse.latestReady ?? null;
  useEffect(() => {
    const announcement = nextReadyAnnouncement(latest, seenAt.current, pathname);
    if (!announcement) return;
    seenAt.current = announcement.at;
    if (announcement.silent) return;
    toast.success(copy.toast.replace("{title}", announcement.title), {
      duration: 20_000,
      action: { label: copy.action, onClick: () => openRef.current(announcement.href) },
    });
    if (document.visibilityState !== "visible" && restoreTitle.current === null) {
      restoreTitle.current = document.title;
      document.title = `${copy.tabTitle} · ${restoreTitle.current}`;
    }
    /// 只在「最近做好的一条」换了的时候判断；换页不重弹
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, latest?.at]);
}
