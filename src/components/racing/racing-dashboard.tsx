"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BarChart3, ChevronDown, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";

type Snapshot = {
  id: string;
  windowHours: number;
  capturedAt: Date | string;
  metrics: unknown;
};

type RacingRound = {
  id: string;
  roundIndex: number;
  status: string;
  createdAt: Date | string;
  deliveryOrder: { id: string; title: string; maxRounds: number; status: string };
  variants: Array<{
    angleId: string;
    title: string;
    type: string;
    videoBriefId: string;
    briefStatus: string;
    videoUrl: string | null;
    thumbnailUrl: string | null;
    placement: null | {
      id: string;
      platform: string;
      externalPostId: string | null;
      publishUrl: string | null;
      status: string;
      snapshots: Snapshot[];
    };
  }>;
  confidence: {
    level: "LOW" | "MEDIUM" | "HIGH";
    score: number;
    variantCount: number;
    observedSnapshots: number;
    expectedSnapshots: number;
    snapshotCoverage: number;
    limitations: string[];
  };
  latestReport: null | {
    id: string;
    compositeScore: number | null;
    explanation: string | null;
    ranking: unknown;
    createdAt: Date | string;
  };
  generatedDistillation: null | {
    id: string;
    summary: string;
    structured: unknown;
  };
};

export function RacingDashboard({ rounds }: { rounds: RacingRound[] }) {
  if (rounds.length === 0) return null;
  return (
    <div className="space-y-5">
      {rounds.map((round) => <RacingRoundCard key={round.id} round={round} />)}
    </div>
  );
}

function RacingRoundCard({ round }: { round: RacingRound }) {
  const router = useRouter();
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const statusLabel: Record<string, string> = english
    ? { PLANNED: "Planned", ANGLES_READY: "Variants ready", METRICS_WINDOWS_PENDING: "Collecting", SCORING: "Analyzing", RANKED: "Ranked", DISTILLATION_PENDING: "Distilling", CLOSED: "Completed" }
    : { PLANNED: "待规划", ANGLES_READY: "变体已就绪", METRICS_WINDOWS_PENDING: "收集中", SCORING: "分析中", RANKED: "已排名", DISTILLATION_PENDING: "提炼中", CLOSED: "已完成" };
  const confidenceLabel = english
    ? { LOW: "Low confidence", MEDIUM: "Medium confidence", HIGH: "High confidence" }
    : { LOW: "低置信度", MEDIUM: "中置信度", HIGH: "高置信度" };
  const [expanded, setExpanded] = useState(round === undefined ? false : round.roundIndex === 1);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [briefId, setBriefId] = useState(round.variants[0]?.videoBriefId ?? "");
  const [platform, setPlatform] = useState("tiktok");
  const [externalPostId, setExternalPostId] = useState("");
  const [publishUrl, setPublishUrl] = useState("");
  const [windowHours, setWindowHours] = useState<12 | 24 | 48>(12);
  const [views, setViews] = useState("");
  const [completionRate, setCompletionRate] = useState("");
  const [retention3s, setRetention3s] = useState("");
  const [likes, setLikes] = useState("");
  const [shares, setShares] = useState("");

  const ranked = useMemo(() => {
    const raw = round.latestReport?.ranking;
    return Array.isArray(raw) ? raw as Array<{ videoBriefId: string; rank: number; score: number }> : [];
  }, [round.latestReport]);
  const limitations = english ? englishLimitations(round.confidence) : round.confidence.limitations;
  const recommendation = english && round.generatedDistillation
    ? englishRecommendation(round, ranked)
    : round.generatedDistillation?.summary;

  async function post(path: string, body?: unknown) {
    setError(null);
    setMessage(null);
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(json.error ?? (english ? "Action failed. Please try again." : "操作失败，请稍后重试"));
    return json;
  }

  function saveMetrics(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      try {
        const metrics = compactMetrics({
          views: numberOrUndefined(views),
          completion_rate: ratioOrUndefined(completionRate),
          retention_3s: ratioOrUndefined(retention3s),
          likes: numberOrUndefined(likes),
          shares: numberOrUndefined(shares),
        });
        await post(`/api/racing/rounds/${round.id}/metrics`, {
          videoBriefId: briefId,
          platform,
          externalPostId: externalPostId.trim(),
          publishUrl: publishUrl.trim() || null,
          windowHours,
          metrics,
        });
        setMessage(english ? `${windowHours}h metrics saved.` : `${windowHours}h 指标已保存。`);
        router.refresh();
      } catch (caught) {
        setError((caught as Error).message);
      }
    });
  }

  function analyze() {
    startTransition(async () => {
      try {
        await post(`/api/racing/rounds/${round.id}/analyze`);
        setMessage(english ? "Ranking, confidence, and next-round recommendations updated." : "本轮排名、置信度与下一轮建议已更新。");
        router.refresh();
      } catch (caught) {
        setError((caught as Error).message);
      }
    });
  }

  function scheduleNext() {
    if (!round.generatedDistillation) return;
    startTransition(async () => {
      try {
        await post(`/api/racing/rounds/${round.id}/next`, {
          baseDistillationId: round.generatedDistillation?.id,
        });
        setMessage(english ? "Next round created: 3 optimization slots + 2 exploration slots." : "下一轮已建立：3 个优化位 + 2 个探索位。");
        router.refresh();
      } catch (caught) {
        setError((caught as Error).message);
      }
    });
  }

  const confidenceVariant = round.confidence.level === "HIGH"
    ? "success"
    : round.confidence.level === "MEDIUM" ? "warning" : "secondary";

  return (
    <article className="overflow-hidden rounded-(--radius-lg) border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start justify-between gap-5 p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <p className="studio-label text-muted-foreground">{english ? "Round" : "轮次"} {round.roundIndex} · {statusLabel[round.status] ?? round.status}</p>
          <h2 className="mt-2 truncate font-heading text-title font-semibold">{round.deliveryOrder.title}</h2>
          <p className="mt-2 break-all font-mono text-meta text-muted-foreground">{round.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge variant={confidenceVariant}>{confidenceLabel[round.confidence.level]}</Badge>
          <ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </div>
      </button>

      <div className="grid grid-cols-3 border-y border-border bg-secondary/40">
        <Metric label={english ? "Variants" : "变体"} value={String(round.confidence.variantCount)} />
        <Metric label={english ? "Metric windows" : "指标窗口"} value={`${round.confidence.observedSnapshots}/${round.confidence.expectedSnapshots}`} />
        <Metric label={english ? "Evidence coverage" : "证据完整度"} value={`${Math.round(round.confidence.snapshotCoverage * 100)}%`} accent={round.confidence.level === "HIGH"} />
      </div>

      {expanded && (
        <div className="space-y-6 p-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-180 text-left text-body">
              <thead className="studio-label text-muted-foreground">
                <tr><th className="pb-3">{english ? "Variant" : "变体"}</th><th className="pb-3">{english ? "Placement" : "投放"}</th><th className="pb-3">{english ? "Window" : "窗口"}</th><th className="pb-3 text-right">{english ? "Rank / score" : "排名 / 分数"}</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {round.variants.map((variant) => {
                  const result = ranked.find((item) => item.videoBriefId === variant.videoBriefId);
                  return (
                    <tr key={variant.videoBriefId}>
                      <td className="py-3 pr-4"><p className="font-medium">{variant.title}</p><p className="font-mono text-meta text-muted-foreground">{variant.videoBriefId}</p></td>
                      <td className="py-3 pr-4"><p>{variant.placement?.platform ?? (english ? "Not published" : "尚未投放")}</p><p className="font-mono text-meta text-muted-foreground">{variant.placement?.externalPostId ?? "—"}</p></td>
                      <td className="py-3 pr-4 font-mono tabular-nums">{variant.placement?.snapshots.map((snapshot) => `${snapshot.windowHours}h`).join(" · ") || "—"}</td>
                      <td className="py-3 text-right font-mono tabular-nums">{result ? `#${result.rank} · ${result.score.toFixed(3)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <form onSubmit={saveMetrics} className="space-y-4 rounded-(--radius-md) border border-border bg-secondary/30 p-4">
              <div><p className="studio-label text-muted-foreground">{english ? "MANUAL PLACEMENT IMPORT" : "手动投放导入"}</p><h3 className="mt-1 font-heading text-subhead font-semibold">{english ? "Import placement metrics" : "录入投放与指标"}</h3></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={english ? "Video variant" : "视频变体"}><select required value={briefId} onChange={(event) => setBriefId(event.target.value)} className="studio-select">{round.variants.map((variant) => <option key={variant.videoBriefId} value={variant.videoBriefId}>{variant.title}</option>)}</select></Field>
                <Field label={english ? "Platform" : "平台"}><select value={platform} onChange={(event) => setPlatform(event.target.value)} className="studio-select"><option value="tiktok">TikTok</option><option value="instagram_reels">Instagram Reels</option><option value="youtube_shorts">YouTube Shorts</option><option value="facebook">Facebook</option></select></Field>
                <Field label={english ? "Post ID" : "贴文 ID"}><Input required value={externalPostId} onChange={(event) => setExternalPostId(event.target.value)} placeholder={english ? "Unique platform ID" : "平台侧唯一 ID"} /></Field>
                <Field label={english ? "Public URL (optional)" : "公开链接（可选）"}><Input type="url" value={publishUrl} onChange={(event) => setPublishUrl(event.target.value)} placeholder="https://…" /></Field>
                <Field label={english ? "Observation window" : "观察窗口"}><select value={windowHours} onChange={(event) => setWindowHours(Number(event.target.value) as 12 | 24 | 48)} className="studio-select"><option value={12}>12 {english ? "hours" : "小时"}</option><option value={24}>24 {english ? "hours" : "小时"}</option><option value={48}>48 {english ? "hours" : "小时"}</option></select></Field>
                <Field label={english ? "Views" : "播放量"}><Input type="number" min={0} value={views} onChange={(event) => setViews(event.target.value)} /></Field>
                <Field label={english ? "Completion rate" : "完播率"}><Input type="number" min={0} max={100} step="0.1" value={completionRate} onChange={(event) => setCompletionRate(event.target.value)} placeholder="0–100%" /></Field>
                <Field label={english ? "3-second retention" : "3 秒留存"}><Input type="number" min={0} max={100} step="0.1" value={retention3s} onChange={(event) => setRetention3s(event.target.value)} placeholder="0–100%" /></Field>
                <Field label={english ? "Likes" : "点赞"}><Input type="number" min={0} value={likes} onChange={(event) => setLikes(event.target.value)} /></Field>
                <Field label={english ? "Shares" : "分享"}><Input type="number" min={0} value={shares} onChange={(event) => setShares(event.target.value)} /></Field>
              </div>
              <Button type="submit" disabled={busy || !briefId}>{busy ? (english ? "Saving…" : "保存中…") : (english ? "Save metrics" : "保存指标")}</Button>
            </form>

            <section className="space-y-4 rounded-(--radius-md) border border-border bg-secondary/30 p-4">
              <div><p className="studio-label text-muted-foreground">{english ? "EVIDENCE-AWARE ANALYSIS" : "证据约束分析"}</p><h3 className="mt-1 font-heading text-subhead font-semibold">{english ? "Round findings" : "本轮结论"}</h3></div>
              {limitations.map((limitation) => <p key={limitation} className="text-meta text-muted-foreground">{limitation}</p>)}
              {round.generatedDistillation && <div className="border-l-2 border-accent pl-3"><p className="studio-label text-muted-foreground">{english ? "Next-round recommendation" : "下一轮建议"}</p><p className="mt-2 text-body">{recommendation}</p></div>}
              <Button type="button" variant="outline" onClick={analyze} disabled={busy || round.confidence.observedSnapshots === 0} className="w-full"><BarChart3 aria-hidden />{english ? "Generate ranking and recommendations" : "生成排名与建议"}</Button>
              {round.generatedDistillation && round.roundIndex < round.deliveryOrder.maxRounds && <Button type="button" onClick={scheduleNext} disabled={busy} className="w-full"><FlaskConical aria-hidden />{english ? "Create next round" : "建立下一轮"}<ArrowRight aria-hidden /></Button>}
            </section>
          </div>
          {error && <p role="alert" className="text-body text-danger">{error}</p>}
          {message && <p role="status" className="text-body text-success">{message}</p>}
        </div>
      )}
    </article>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="border-r border-border px-4 py-3 last:border-r-0"><p className="studio-label text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-title font-semibold tabular-nums ${accent ? "text-accent" : ""}`}>{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5 text-meta font-medium text-muted-foreground"><span>{label}</span>{children}</label>;
}

function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function englishLimitations(confidence: RacingRound["confidence"]): string[] {
  const limitations: string[] = [];
  if (confidence.variantCount < 5) {
    limitations.push(`Only ${confidence.variantCount} variant${confidence.variantCount === 1 ? "" : "s"}; directional findings do not establish statistical significance.`);
  }
  if (confidence.snapshotCoverage < 1) {
    limitations.push(`12/24/48-hour metric coverage is ${Math.round(confidence.snapshotCoverage * 100)}%.`);
  }
  if (confidence.observedSnapshots < confidence.expectedSnapshots && confidence.variantCount > 0) {
    limitations.push("At least one variant is missing a mature 48-hour window, so the ranking may still change.");
  }
  if (confidence.variantCount === 0) limitations.push("No comparable placement variants yet.");
  return limitations;
}

function englishRecommendation(
  round: RacingRound,
  ranked: Array<{ videoBriefId: string; rank: number; score: number }>,
): string {
  const leader = ranked.find((item) => item.rank === 1) ?? ranked[0];
  const title = round.variants.find((variant) => variant.videoBriefId === leader?.videoBriefId)?.title;
  if (!leader || !title) {
    return "Import placement metrics and analyze the round before scheduling the next experiment.";
  }
  return `${title} currently leads at ${leader.score.toFixed(3)}. Keep the next round focused on this direction while reserving exploration slots until all mature windows are complete.`;
}

function ratioOrUndefined(value: string) {
  const parsed = numberOrUndefined(value);
  if (parsed == null) return undefined;
  return parsed > 1 ? parsed / 100 : parsed;
}

function compactMetrics(metrics: Record<string, number | undefined>) {
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value != null));
}
