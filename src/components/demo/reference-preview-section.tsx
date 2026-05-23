import { ExternalLink, Lock, Eye, Heart, Share2 } from "lucide-react";
import {
  REFERENCE_COMPLIANCE_TEXT,
  referencePreviews,
  type CreativeEvidenceCardSlug,
  type ReferencePreviewDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

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
        "flex h-full flex-col overflow-hidden rounded-3xl border-2 transition " +
        (highlighted
          ? "border-primary/55 bg-primary/[0.06]"
          : "border-white/10 bg-card/60")
      }
    >
      <div className="relative aspect-9/16 max-h-72 w-full bg-gradient-to-br from-white/5 via-white/[0.03] to-transparent">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <Lock size={20} className="text-muted-foreground/70" />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {preview.thumbnailPlaceholderLabel}
          </p>
          <p className="text-[10px] leading-4 text-muted-foreground/70">
            缩略图不做自托管，仅显示占位。
          </p>
        </div>
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
          {preview.platform}
        </span>
        {highlighted ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary/85 px-2.5 py-1 text-[10px] font-semibold text-primary-foreground shadow-sm">
            当前选中
          </span>
        ) : null}
        <SampleDataBadge label="示例" />
      </div>

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
    <div className="rounded-xl bg-white/[0.03] px-2 py-1.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
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
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-muted-foreground/70"
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
      className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:bg-white/10"
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
