"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

export interface BriefRenderPollTarget {
  briefId: string;
  /** planning | generating | assembling */
  active: boolean;
}

/**
 * While any video is in-flight, poll render-status so local dev
 * does not depend on Vercel cron (Phase 4 mock / real E2E).
 */
export function BriefRenderAutoRefresh({
  targets,
}: {
  targets: BriefRenderPollTarget[];
}) {
  const router = useRouter();
  const activeBriefIds = useMemo(
    () => targets.filter((t) => t.active).map((t) => t.briefId),
    [targets],
  );

  useEffect(() => {
    if (activeBriefIds.length === 0) return;

    let cancelled = false;

    async function tick() {
      await Promise.all(
        activeBriefIds.map((briefId) =>
          fetch(`/api/briefs/${briefId}/render-status`, { method: "POST" }).catch(
            () => null,
          ),
        ),
      );
      if (!cancelled) router.refresh();
    }

    void tick();
    const interval = setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeBriefIds, router]);

  return null;
}
