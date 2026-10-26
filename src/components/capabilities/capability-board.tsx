import { LocalTime } from "@/components/exchange/local-time";
import { QuoteHeader, type QuoteStat } from "@/components/exchange/quote-header";
import { StatusTick } from "@/components/exchange/status-tick";
import type { Locale } from "@/i18n/config";
import { getPlatformCopy } from "@/i18n/platform-copy";
import {
  CAPABILITY_KEYS,
  FEATURES,
  type CapabilityStatus,
  type PublicCapabilities,
  type PublicCapability,
} from "@/lib/capabilities/registry";
import { stateWord } from "@/lib/exchange/state-vocab";

/** 严重的排前面：暂停 → 不稳定 → 未开通 → 正常；同档按注册表顺序。 */
const SEVERITY: Record<CapabilityStatus, number> = {
  unavailable: 0,
  degraded: 1,
  not_configured: 2,
  available: 3,
};

export function orderCapabilities(items: PublicCapability[]): PublicCapability[] {
  return [...items].sort(
    (a, b) => SEVERITY[a.status] - SEVERITY[b.status] || CAPABILITY_KEYS.indexOf(a.key) - CAPABILITY_KEYS.indexOf(b.key),
  );
}

/**
 * C4 · 能力状态页（/app/status）：行情头读数墙（正常 / 不稳定 / 暂停 / 未开通，零就写零）+
 * 每个能力一格：状态记号（StatusTick，记号与颜色成对）+ 一句人话 + 检测时间 + 影响哪些功能。
 * 纯展示组件，服务端渲染；时间用 LocalTime 按访问者时区显示。
 */
export function CapabilityBoard({ capabilities, locale }: { capabilities: PublicCapabilities; locale: Locale }) {
  const copy = getPlatformCopy(locale).status;
  const { counts } = capabilities;
  const readings: QuoteStat[] = [
    {
      label: stateWord("capability", "available", locale),
      value: counts.available,
      caption: copy.operationalCaption,
      tone: counts.available > 0 ? "filled" : "neutral",
    },
    {
      label: stateWord("capability", "degraded", locale),
      value: counts.degraded,
      caption: copy.unstableCaption,
      tone: counts.degraded > 0 ? "winner" : "neutral",
    },
    {
      label: stateWord("capability", "unavailable", locale),
      value: counts.unavailable,
      caption: copy.pausedCaption,
      tone: counts.unavailable > 0 ? "fault" : "neutral",
    },
    {
      label: stateWord("capability", "not_configured", locale),
      value: counts.not_configured,
      caption: copy.notSetUpCaption,
    },
  ];
  const separator = locale === "en-US" ? ", " : "、";

  return (
    <div className="x-stack min-w-0" data-testid="capability-board">
      <QuoteHeader
        title={copy.title}
        subtitle={copy.subtitle}
        primaryAction={null}
        readings={readings}
        readingsLabel={copy.readingsLabel}
        scope={
          <>
            {copy.scope.replace("{count}", String(capabilities.items.length))}
            {capabilities.lastCheckedAt ? (
              <>
                {" · "}
                {copy.lastChecked} <LocalTime iso={capabilities.lastCheckedAt} locale={locale} variant="relative" />
              </>
            ) : null}
          </>
        }
      />
      {/* 奇数格时最后一格横跨两列：不留空格露出接缝底色 */}
      <ul
        aria-label={copy.listLabel}
        className="x-wall grid-cols-1 lg:grid-cols-2 lg:[&>*:last-child:nth-child(odd)]:col-span-2"
      >
        {orderCapabilities(capabilities.items).map((item) => (
          <li
            key={item.key}
            data-capability={item.key}
            data-status={item.status}
            className="flex min-w-0 flex-col gap-2.5 px-4 py-4 sm:px-5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 text-subhead font-medium text-foreground">{item.label[locale]}</h2>
              <StatusTick entity="capability" state={item.status} locale={locale} className="mt-1" />
            </div>
            <p className="max-w-[62ch] text-body text-muted-foreground text-pretty">{item.message[locale]}</p>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-data tabular-nums text-tertiary">
              <div className="flex gap-1.5">
                <dt>{copy.checkedAt}</dt>
                <dd className="text-muted-foreground">
                  {item.checkedAt ? <LocalTime iso={item.checkedAt} locale={locale} variant="relative" /> : copy.neverChecked}
                </dd>
              </div>
              {item.failingSince ? (
                <div className="flex gap-1.5">
                  <dt>{copy.failingSince}</dt>
                  <dd className="text-muted-foreground">
                    <LocalTime iso={item.failingSince} locale={locale} variant="datetime" />
                  </dd>
                </div>
              ) : null}
            </dl>
            {item.features.length > 0 ? (
              <p className="text-meta text-tertiary text-pretty">
                <span className="x-label">{copy.affects}</span>{" "}
                <span className="text-muted-foreground">
                  {item.features.map((feature) => FEATURES[feature].label[locale]).join(separator)}
                </span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
