"use client";

import { useEffect, useState } from "react";
import { Aperture, Gauge, type LucideIcon } from "lucide-react";
import { videoRouteCatalogSchema, type VideoRouteCatalog } from "@/lib/contracts/video-route-catalog";
import { cn } from "@/lib/utils";

/**
 * 创作台「生成线路」卡（2026-10-29 Evan）：标准 = Shuyu，默认、便宜；高质量 = Runway，客户主动选；
 * 下面列出 Shuyu 开放给我们的全部视频类别（已接入 / 待接入）。数据来自 /api/video-generation/routes/catalog，
 * 第一次展开「更多设置」时才去取。取不到也不挡路：照常按标准线路出片。
 */
export type CustomerRouteChoice = "buddy" | "runway";

const COPY = {
  zh: {
    standardTitle: "标准 · 默认",
    standardDetail: (family: string | null, resolution: string | null) =>
      family ? `Aivora 视频通道 · ${family} · ${resolution ?? ""}`.replace(/ · $/u, "") : "Aivora 视频通道",
    standardDown: "标准线路此刻不可用，提交时会提示你稍后再试。",
    premiumTitle: "高质量",
    premiumDetail: (model: string, resolution: string) => `Runway · ${model} · ${resolution} · 出片更慢`,
    fallbackNote: "标准线路生成失败时，会自动换到高质量线路重拍，不用重新提交。",
    catalogSummary: (count: number) => `Shuyu 开放的视频模型（${count} 类）`,
    integrated: "已接入",
    integratedSome: (list: string) => `已接入 ${list}`,
    notYet: "待接入",
    isDefault: "默认",
    upTo: (sec: number) => `最长 ${sec} 秒`,
    loading: "正在读取线路…",
    failed: "线路信息暂时读不到，照常按标准线路出片。",
  },
  en: {
    standardTitle: "Standard · default",
    standardDetail: (family: string | null, resolution: string | null) =>
      family ? `Aivora video route · ${family} · ${resolution ?? ""}`.replace(/ · $/u, "") : "Aivora video route",
    standardDown: "The standard route is unavailable right now; you'll be asked to try again later.",
    premiumTitle: "High quality",
    premiumDetail: (model: string, resolution: string) => `Runway · ${model} · ${resolution} · slower`,
    fallbackNote: "If the standard route fails, the video is re-shot on the high-quality route automatically.",
    catalogSummary: (count: number) => `Video models open to us on Shuyu (${count})`,
    integrated: "Integrated",
    integratedSome: (list: string) => `Integrated: ${list}`,
    notYet: "Not yet",
    isDefault: "Default",
    upTo: (sec: number) => `up to ${sec}s`,
    loading: "Loading routes…",
    failed: "Route details are unavailable; the standard route is used as usual.",
  },
};

export function CustomerRoutePicker({
  value,
  onChange,
  disabled,
  active,
  english,
}: {
  value: CustomerRouteChoice;
  onChange: (value: CustomerRouteChoice) => void;
  disabled: boolean;
  /// 「更多设置」展开过才去取目录
  active: boolean;
  english: boolean;
}) {
  const copy = english ? COPY.en : COPY.zh;
  const [catalog, setCatalog] = useState<VideoRouteCatalog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || catalog || failed) return;
    const controller = new AbortController();
    fetch("/api/video-generation/routes/catalog", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((payload: unknown) => {
        const parsed = videoRouteCatalogSchema.safeParse(payload);
        if (parsed.success) setCatalog(parsed.data);
        else setFailed(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [active, catalog, failed]);

  /// 高质量对这个账号关了（开关 / 名单变了）：退回标准，派发时不带 runway
  useEffect(() => {
    if (catalog && !catalog.premium.offered && value === "runway") onChange("buddy");
  }, [catalog, value, onChange]);

  return (
    <div className="space-y-3" data-testid="customer-route-picker">
      <div className="grid gap-2 @md:grid-cols-2">
        <RouteOption
          active={value === "buddy"}
          icon={Gauge}
          title={copy.standardTitle}
          detail={copy.standardDetail(catalog?.standard.defaultFamily ?? null, catalog?.standard.defaultResolution ?? null)}
          disabled={disabled}
          onClick={() => onChange("buddy")}
        />
        {catalog?.premium.offered ? (
          <RouteOption
            active={value === "runway"}
            icon={Aperture}
            title={copy.premiumTitle}
            detail={copy.premiumDetail(catalog.premium.model, catalog.premium.resolution)}
            disabled={disabled}
            onClick={() => onChange("runway")}
          />
        ) : null}
      </div>
      {catalog && !catalog.standard.available && value === "buddy" ? (
        <p className="text-meta text-danger">{copy.standardDown}</p>
      ) : null}
      {catalog?.standard.fallsBackToPremium ? <p className="text-meta text-muted-foreground">{copy.fallbackNote}</p> : null}
      {active && !catalog && !failed ? <p className="text-meta text-muted-foreground">{copy.loading}</p> : null}
      {failed ? <p className="text-meta text-muted-foreground">{copy.failed}</p> : null}
      {catalog && catalog.families.length > 0 ? (
        <details className="rounded-(--radius-md) border border-border px-3 py-2" data-testid="shuyu-model-catalog">
          <summary className="cursor-pointer text-meta font-medium text-foreground">
            {copy.catalogSummary(catalog.families.length)}
          </summary>
          <ul className="mt-2 divide-y divide-border">
            {catalog.families.map((family) => (
              <li key={family.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 text-body text-foreground">
                  {family.label}
                  {family.isDefault ? <span className="ml-2 x-label text-accent">{copy.isDefault}</span> : null}
                </span>
                <span className="font-mono text-data tabular-nums text-muted-foreground">
                  {family.resolutions.join(" / ")}
                  {family.maxDurationSec ? ` · ${copy.upTo(family.maxDurationSec)}` : ""}
                  {" · "}
                  <span className={family.integrated ? "text-success" : undefined}>
                    {!family.integrated
                      ? copy.notYet
                      : family.integratedResolutions.length < family.resolutions.length
                        ? copy.integratedSome(family.integratedResolutions.join(" / "))
                        : copy.integrated}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** 与创作台片尾二选一同一套语言：选中只用信号色细线与信号色字，不铺实心色块。 */
function RouteOption({
  active,
  icon: Icon,
  title,
  detail,
  disabled,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  title: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={() => {
        if (!active) onClick();
      }}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-(--radius-md) border px-3 py-2.5 text-left transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
        active ? "border-(--accent-line) text-accent" : "border-border text-foreground hover:border-border-strong",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-accent" : "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        <span className="mt-0.5 block text-meta text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}
