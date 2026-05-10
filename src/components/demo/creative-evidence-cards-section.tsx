"use client";

import { CheckCircle2, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  creativeEvidenceCards,
  type CreativeEvidenceCardDemo,
  type CreativeEvidenceCardSlug,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

interface Props {
  selectedSlug: CreativeEvidenceCardSlug;
  onSelect: (slug: CreativeEvidenceCardSlug) => void;
}

export function CreativeEvidenceCardsSection({ selectedSlug, onSelect }: Props) {
  return (
    <DemoSection
      id="evidence-cards"
      eyebrow="第 2 步 · 创意方向"
      title="3 张「有数据支撑」的方向卡，不是 AI 拍脑袋的建议。"
      description="每张方向卡都基于一组高表现参考视频的结构信号生成。点击卡片切换默认方向，下方脚本与分镜的标签会跟着更新。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {creativeEvidenceCards.map((card) => (
          <CardOption
            key={card.slug}
            card={card}
            selected={card.slug === selectedSlug}
            onSelect={() =>
              onSelect(card.slug as CreativeEvidenceCardSlug)
            }
          />
        ))}
      </div>
    </DemoSection>
  );
}

function CardOption({
  card,
  selected,
  onSelect,
}: {
  card: CreativeEvidenceCardDemo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-3xl border bg-card/70 p-5 text-left transition",
        selected
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-white/10 hover:border-white/30 hover:bg-card/90",
      )}
      aria-pressed={selected}
    >
      {/* Top header row：左 = 标签 + 选中态徽标（独立 flex 容器，避免与右侧 score chip 重叠）；右 = score chip。 */}
      <div className="flex items-start justify-between gap-3">
        <div
          data-testid="evidence-card-left-badges"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            {card.tags[0]}
          </p>
          {selected ? (
            <span
              data-testid="evidence-card-selected-badge"
              className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
            >
              <CheckCircle2 size={11} />
              已选中
            </span>
          ) : null}
        </div>
        <div
          data-testid="evidence-card-score-chip"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-200"
        >
          <Sparkles size={12} />
          <span className="font-mono tabular-nums">{card.recommendationScore}</span>
        </div>
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug">{card.title}</h3>

      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {card.clientPreviewSummary}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Stat
          label="参考视频数"
          value={`${card.publicMetrics.references}`}
        />
        <Stat
          label={card.publicMetrics.averageViews ? "平均播放" : "最高播放"}
          value={
            card.publicMetrics.averageViews
              ? formatViews(card.publicMetrics.averageViews)
              : formatViews(card.publicMetrics.highestViews ?? 0)
          }
        />
        <Stat
          label="互动率"
          value={`${card.publicMetrics.engagementRate?.toFixed(1) ?? "—"}%`}
        />
        <Stat label="Hook 类型" value={hookTypeZh(card.hookPattern.hookType)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Tag label={`拍摄难度 · ${zhDifficulty(card.shootingDifficulty)}`} tone="neutral" />
        <Tag
          label={`转化潜力 · ${zhDifficulty(card.conversionPotential)}`}
          tone={card.conversionPotential === "High" ? "positive" : "neutral"}
        />
        <Tag
          label={`信任度 · ${zhDifficulty(card.trustFactor)}`}
          tone={card.trustFactor === "High" ? "positive" : "neutral"}
        />
      </div>

      <p className="mt-auto pt-4">
        <span className="block rounded-2xl bg-white/[0.04] p-3 text-xs leading-5 text-muted-foreground">
          <TrendingUp size={12} className="mb-0.5 mr-1 inline text-primary" />
          {card.whyItWorks}
        </span>
      </p>
    </button>
  );
}

function zhDifficulty(level: "Low" | "Medium" | "High"): string {
  if (level === "Low") return "低";
  if (level === "Medium") return "中";
  return "高";
}

const HOOK_TYPE_ZH: Record<string, string> = {
  POV: "第一视角",
  Curiosity: "好奇心",
  Stat: "数据反差",
  Reveal: "结果揭晓",
  Pain: "痛点",
  Demo: "演示",
  Question: "提问",
  Authority: "权威背书",
};

function hookTypeZh(t: string): string {
  return HOOK_TYPE_ZH[t] ?? t;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Tag({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "positive";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone === "positive"
          ? "bg-emerald-500/10 text-emerald-200"
          : "bg-white/[0.05] text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}K`;
  return String(views);
}
