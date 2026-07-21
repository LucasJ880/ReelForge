"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OpsCreditsResponse } from "@/lib/contracts/ops-credits";

type FetchState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; data: OpsCreditsResponse }
  | { phase: "error" };

export function OpsCreditsCluster({ english }: { english: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>({ phase: "idle" });
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const response = await fetch("/api/internal/ops-credits", { cache: "no-store" });
      const payload = (await response.json()) as OpsCreditsResponse | { ok: false };
      if (!response.ok || payload.ok !== true) throw new Error("ops credits unavailable");
      setState({ phase: "ready", data: payload });
    } catch {
      setState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const points =
    state.phase === "ready" ? state.data.availablePoints.toLocaleString() : "—";

  return (
    <div ref={rootRef} data-testid="ops-credits-cluster" className="relative hidden shrink-0 md:block">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          if (state.phase === "error") void load();
        }}
        aria-expanded={open}
        aria-label={english ? "Shuyu credits" : "Shuyu 积分"}
        className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-accent-soft px-3 font-mono text-meta tabular-nums text-foreground"
      >
        {points}
        <span className="text-muted-foreground">{english ? "pts" : "积分"}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 space-y-2 rounded-(--radius-md) border border-border bg-card p-4 shadow-lg">
          {state.phase === "ready" ? (
            <>
              <div className="flex items-center justify-between text-meta">
                <span className="text-muted-foreground">{english ? "Spent today" : "今日消耗"}</span>
                <span className="font-mono tabular-nums">{state.data.todaySpentPoints.toLocaleString()} pts</span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2 text-meta">
                <span className="text-muted-foreground">
                  {state.data.videoPlan.model} · {state.data.videoPlan.resolution}
                </span>
                <span className="font-mono tabular-nums">
                  {state.data.videoPlan.salePoints.toLocaleString()} {english ? "pts/video" : "pts/条"}
                </span>
              </div>
              <p className="border-t border-border pt-2 text-meta text-muted-foreground">
                {english
                  ? "Unified access · live GET /prices · internal operators only"
                  : "统一接入 · GET /prices 实时 · 仅内部运营可见"}
              </p>
            </>
          ) : (
            <p className="text-meta text-muted-foreground">
              {state.phase === "loading"
                ? (english ? "Loading credits…" : "正在读取积分…")
                : (english ? "Credits unavailable. Click the pill to retry." : "积分暂不可用，点击胶囊重试。")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
