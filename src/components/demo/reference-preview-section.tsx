import { ExternalLink, Eye, Heart, Share2 } from "lucide-react";
import {
  REFERENCE_COMPLIANCE_TEXT,
  referencePreviews,
  type CreativeEvidenceCardSlug,
  type ReferencePreviewDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

/**
 * 不同平台的参考结构示意：3 段视频脚本时间轴（钩 → 卖点 → CTA）。
 * 因为合规要求不下载 / 自托管第三方视频缩略图，所以 thumbnail 区域用
 * 这套「结构示意」可视化来体现「我们学到了什么」，比单一 Lock icon
 * 信息密度高得多，也避免空旷感。
 */
const PLATFORM_STRUCTURE: Record<
  string,
  {
    tagline: string;
    beats: ReadonlyArray<{ label: string; pctWidth: number; tone: string }>;
  }
> = {
  TikTok: {
    tagline: "前 3 秒钩 + 中段卖点 + 情绪收尾",
    beats: [
      { label: "0-3s · 钩", pctWidth: 20, tone: "bg-primary" },
      { label: "3-12s · 卖点", pctWidth: 55, tone: "bg-success" },
      { label: "12-15s · CTA", pctWidth: 25, tone: "bg-warning" },
    ],
  },
  "Instagram Reels": {
    tagline: "仪式感开场 + 场景节奏 + 字幕承接",
    beats: [
      { label: "0-2s · 仪式开场", pctWidth: 18, tone: "bg-warning" },
      { label: "2-13s · 三段场景", pctWidth: 60, tone: "bg-primary" },
      { label: "13-15s · 字幕收", pctWidth: 22, tone: "bg-success" },
    ],
  },
  "YouTube Shorts": {
    tagline: "单镜叙事 + 强对称构图 + 自然图形",
    beats: [
      { label: "0-1s · 入画", pctWidth: 12, tone: "bg-success" },
      { label: "1-13s · 单镜推进", pctWidth: 65, tone: "bg-primary" },
      { label: "13-15s · 落字幕", pctWidth: 23, tone: "bg-warning" },
    ],
  },
};

const DEFAULT_STRUCTURE = {
  tagline: "钩 + 卖点 + CTA",
  beats: [
    { label: "钩", pctWidth: 25, tone: "bg-primary" },
    { label: "卖点", pctWidth: 50, tone: "bg-success" },
    { label: "CTA", pctWidth: 25, tone: "bg-warning" },
  ],
} as const;

interface Props {
  selectedSlug: CreativeEvidenceCardSlug;
}

export function ReferencePreviewSection({ selectedSlug }: Props) {
  const ordered = [...referencePreviews].sort((a, b) =>
    a.cardSlug === selectedSlug ? -1 : b.cardSlug === selectedSlug ? 1 : 0,
  );

  return (
    <DemoSection
      id="references"
      eyebrow="第 3 步 · 参考视频信号"
      title="我们学习的「高表现内容模式」。"
      description={
        <span>
          {REFERENCE_COMPLIANCE_TEXT}
          <span className="ml-2 text-foreground">
            禁止下载 / 自托管 / 去水印 / 复制原字幕配音。
          </span>
        </span>
      }
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {ordered.map((preview) => (
          <ReferenceCard
            key={`${preview.cardSlug}-${preview.platform}`}
            preview={preview}
            highlighted={preview.cardSlug === selectedSlug}
          />
        ))}
      </div>
    </DemoSection>
  );
}

function ReferenceCard({
  preview,
  highlighted,
}: {
  preview: ReferencePreviewDemo;
  highlighted: boolean;
}) {
  /*
   * 之前用 `ring-1 ring-primary/30` 做 selected 状态的 outline，但 ring 本质是
   * 绘制在 element 边界**外**的 box-shadow；当 article 自身又是 `overflow-hidden`
   * 加上 grid container 在某些 viewport 下贴近 section padding 边缘时，会出现
   * 「ring 在上/左/下被裁掉」的视觉残缺。
   *
   * 解决：把 outset ring 全部换成 **inset 视觉信号**（粗 border + 背景色 tint），
   * 这样 selected 状态完全画在 article 内部，永远不会被 overflow / parent 裁切；
   * 同时把 border 在两种状态都升到 border-2，避免选中切换时 layout 抖 1px。
   */
  return (
    <article
      className={
        "flex h-full flex-col overflow-hidden rounded-(--radius-lg) border-2 " +
        (highlighted
          ? "border-primary/55 bg-primary/6"
          : "border-border bg-card")
      }
    >
      <ReferenceThumbnail
        platform={preview.platform}
        placeholderLabel={preview.thumbnailPlaceholderLabel}
        highlighted={highlighted}
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-sm leading-6">{preview.caption}</p>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <Metric icon={<Eye size={12} />} label="播放" value={formatNum(preview.metrics.views)} />
          <Metric icon={<Heart size={12} />} label="点赞" value={formatNum(preview.metrics.likes)} />
          <Metric icon={<Share2 size={12} />} label="分享" value={formatNum(preview.metrics.shares)} />
        </div>

        <ul className="mt-1 space-y-1.5 text-xs leading-5 text-muted-foreground">
          {preview.takeaways.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {t}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{preview.metrics.observedAt}</span>
          <DisabledViewOriginal disabled={preview.externalUrlDisabled} url={preview.externalUrl} />
        </div>
      </div>
    </article>
  );
}

/**
 * 参考视频的「结构示意」缩略图：用一张 9:16 卡片表达「这条参考的视频
 * 节奏长什么样」，包含平台标签、风格描述和 3 段时间轴 chip。
 *
 * 设计动机：之前用 Lock + 「缩略图不做自托管」纯文字 placeholder 让卡片
 * 看起来非常空且像"未完成"。投资人看到会觉得是 mock 占位。换成结构示意
 * 后既履行了合规边界（确实没有去复制第三方缩略图），又把"我们学到了
 * 什么结构"这件事可视化出来，比原来的视觉密度高一截。
 */
function ReferenceThumbnail({
  platform,
  placeholderLabel,
  highlighted,
}: {
  platform: string;
  placeholderLabel: string;
  highlighted: boolean;
}) {
  const struct = PLATFORM_STRUCTURE[platform] ?? DEFAULT_STRUCTURE;
  return (
    <div className="relative aspect-9/16 max-h-72 w-full overflow-hidden border-b border-border bg-muted">
      <div className="absolute inset-0 flex flex-col justify-between p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-meta font-medium text-foreground shadow-editorial">
            {platform}
          </span>
          {highlighted ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-meta font-semibold text-primary-foreground">
              当前选中
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-meta font-medium uppercase tracking-widest text-muted-foreground">
              我们学到的结构
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug text-foreground">
              {placeholderLabel}
            </p>
            <p className="mt-1 text-meta leading-5 text-muted-foreground">
              {struct.tagline}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-border">
              {struct.beats.map((beat) => (
                <span
                  key={beat.label}
                  className={beat.tone}
                  style={{ width: `${beat.pctWidth}%` }}
                  aria-hidden="true"
                />
              ))}
            </div>
            <div className="flex justify-between gap-2 text-meta uppercase tracking-wide text-muted-foreground">
              {struct.beats.map((beat) => (
                <span key={beat.label} className="truncate">
                  {beat.label}
                </span>
              ))}
            </div>
          </div>

          <p className="text-meta leading-4 text-muted-foreground">
            合规：仅展示结构示意，不下载 / 不自托管原视频缩略图。
          </p>
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-(--radius-md) bg-muted px-2 py-1.5">
      <p className="flex items-center gap-1 text-meta uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function DisabledViewOriginal({
  disabled,
  url,
}: {
  disabled: boolean;
  url: string | null;
}) {
  if (disabled || !url) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-meta font-medium text-muted-foreground/70"
        title="示例预览中外链已禁用"
      >
        <ExternalLink size={12} /> 查看原视频
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-meta font-medium text-foreground hover:bg-muted"
    >
      <ExternalLink size={12} /> 查看原视频
    </a>
  );
}

function formatNum(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
