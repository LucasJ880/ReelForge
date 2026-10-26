import Link from "next/link";
import { requirePageRole } from "@/lib/api-auth";
import { LocalTime } from "@/components/exchange/local-time";
import { QuoteHeader, type QuoteStat, type QuoteTone } from "@/components/exchange/quote-header";
import { SectionHead } from "@/components/exchange/section-head";
import {
  FRAME_QA_REPORT_WINDOWS,
  clampFrameQaWindow,
  getFrameQaReport,
  type FrameQaBucket,
  type FrameQaReport,
  type FrameQaShadowStat,
} from "@/lib/services/frame-qa-report-service";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * P01-C · /internal/frame-qa：帧质检运维页（只读）。
 *
 * 看三件事：拦截率与跳过率（阈值是不是太松 / 太严）、为什么跳过（预算、未配置、供应商没给地址）、
 * 影子检查命中率（黑边 / 近静止什么时候可以转正式拦截）。WOULD_BLOCK 是免费重抽用满后
 * 放行的片子，列出来给人工复核。不触发生成、不补检。
 */

const BUCKET_COPY: Record<FrameQaBucket, { label: string; caption: string; tone: QuoteTone }> = {
  PASSED: { label: "通过", caption: "抽帧未检出叠加文字", tone: "filled" },
  BLOCKED: { label: "拦截", caption: "检出文字，已判失败并免费重抽", tone: "fault" },
  WOULD_BLOCK: { label: "本该拦截", caption: "免费重抽用满，按上限放行，需人工复核", tone: "winner" },
  SKIPPED: { label: "跳过", caption: "质检本身没跑成，不等于通过", tone: "winner" },
  CHECKING: { label: "质检中", caption: "占位中，结论未落库", tone: "live" },
  UNCHECKED: { label: "未质检", caption: "已成片但没进过门禁（mock / 老路径）", tone: "neutral" },
};

function percent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

export default async function InternalFrameQaPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requirePageRole(["SUPER_ADMIN", "OPERATOR"]);
  const sp = await searchParams;
  const days = clampFrameQaWindow(sp.days);
  const report = await getFrameQaReport({ days });

  const readings: QuoteStat[] = report.byStatus.map((bucket) => {
    const copy = BUCKET_COPY[bucket.status];
    return {
      label: copy.label,
      value: bucket.count,
      caption: `${percent(bucket.ratio)} · ${copy.caption}`,
      tone: copy.tone,
    };
  });

  return (
    <div className="x-stack min-w-0">
      <QuoteHeader
        title="帧质检"
        subtitle="内部只读。成片进门禁后的结论分布、跳过原因、影子检查命中率与放行待复核清单；不触发生成，不补检。"
        primaryAction={null}
        modeSwitch={<WindowSwitch days={days} />}
        readings={readings}
        readingsLabel="帧质检读数"
        scope={
          <>
            最近 {report.windowDays} 天 · {report.total} 条 · 口径：质检时刻落在窗口内的成片，加上窗口内成片却从没进过门禁的条目（算未质检）
            {report.truncated ? ` · 只看了最近 ${report.total} 条，窗口内还有更多` : ""}
          </>
        }
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <section className="x-panel min-w-0 px-5 py-4">
          <SectionHead
            title="跳过原因"
            count={report.byStatus.find((bucket) => bucket.status === "SKIPPED")?.count ?? 0}
            countTone="winner"
            hint="来自 frameQaDetail.skipReason；比例按跳过行计"
          />
          {report.skipReasons.length === 0 ? (
            <p className="py-4 text-meta text-muted-foreground">窗口内没有跳过的质检。</p>
          ) : (
            <table className="mt-2 w-full text-meta">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1.5 font-medium">原因</th>
                  <th className="py-1.5 text-right font-medium">条数</th>
                  <th className="py-1.5 text-right font-medium">占比</th>
                </tr>
              </thead>
              <tbody>
                {report.skipReasons.map((row) => (
                  <tr key={row.reason} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 font-mono text-data text-foreground break-words">{row.reason}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{row.count}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{percent(row.ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="x-panel min-w-0 px-5 py-4">
          <SectionHead
            title="影子检查"
            count={report.shadow.sampled}
            hint="只记录不拦截；命中率稳定后才讨论转正式门禁"
          />
          <table className="mt-2 w-full text-meta">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1.5 font-medium">检查</th>
                <th className="py-1.5 text-right font-medium">跑过</th>
                <th className="py-1.5 text-right font-medium">命中</th>
                <th className="py-1.5 text-right font-medium">命中率</th>
                <th className="py-1.5 text-right font-medium">阈值</th>
              </tr>
            </thead>
            <tbody>
              <ShadowRow label="黑边" stat={report.shadow.blackBars} />
              <ShadowRow label="近静止" stat={report.shadow.nearStatic} />
            </tbody>
          </table>
          <p className="mt-3 font-mono text-data text-tertiary">
            带影子结果的行 {report.shadow.sampled} · ffmpeg 自身出错 {report.shadow.errors}
            {" · "}门禁提前跳过或超时的行没有影子结果
          </p>
        </section>
      </div>

      <section className="x-panel min-w-0 px-5 py-4">
        <SectionHead
          title="放行待复核"
          count={report.wouldBlock.length}
          countTone={report.wouldBlock.length > 0 ? "winner" : "neutral"}
          hint="同一段免费重抽用满后仍检出文字，按上限放行；最多列最近 50 条"
        />
        {report.wouldBlock.length === 0 ? (
          <p className="py-4 text-meta text-muted-foreground">窗口内没有按上限放行的成片。</p>
        ) : (
          <div
            className="mt-2 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            role="region"
            aria-label="放行待复核清单"
            tabIndex={0}
          >
            <table className="min-w-200 w-full text-meta">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1.5 font-medium">质检时刻</th>
                  <th className="py-1.5 font-medium">成片</th>
                  <th className="py-1.5 font-medium">批次</th>
                  <th className="py-1.5 text-right font-medium">拦截次数</th>
                  <th className="py-1.5 font-medium">检出</th>
                  <th className="py-1.5 font-medium">文件</th>
                </tr>
              </thead>
              <tbody>
                {report.wouldBlock.map((item) => (
                  <tr key={item.videoJobId} className="border-t border-border align-top">
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-data text-muted-foreground">
                      {item.checkedAt ? <LocalTime iso={item.checkedAt} locale="zh-CN" variant="datetime" /> : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-data">{item.videoJobId}</td>
                    <td className="py-2 pr-3 font-mono text-data text-muted-foreground">{item.batchJobId ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-gold">{item.blockCount}</td>
                    <td className="py-2 pr-3">
                      <p className="max-w-[48ch] text-foreground text-pretty">{item.summary}</p>
                      {item.issues.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 font-mono text-data text-muted-foreground">
                          {item.issues.map((issue, index) => (
                            <li key={index} className="max-w-[48ch] break-words">{issue}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {item.outputVideoUrl ? (
                        <a
                          href={item.outputVideoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          打开成片
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DriftSection drift={report.drift} />
    </div>
  );
}

function WindowSwitch({ days }: { days: number }) {
  return (
    <nav aria-label="统计窗口" className="flex items-center gap-1">
      {FRAME_QA_REPORT_WINDOWS.map((window) => {
        const active = window === days;
        return (
          <Link
            key={window}
            href={`/internal/frame-qa?days=${window}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-(--radius-md) border px-3 font-mono text-meta tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            {window} 天
          </Link>
        );
      })}
    </nav>
  );
}

function ShadowRow({ label, stat }: { label: string; stat: FrameQaShadowStat }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3">{label}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">{stat.checked}</td>
      <td className={cn("py-1.5 text-right font-mono tabular-nums", stat.detected > 0 ? "text-gold" : undefined)}>
        {stat.detected}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{percent(stat.rate)}</td>
      <td className="py-1.5 text-right font-mono tabular-nums text-tertiary">
        {stat.threshold === null ? "—" : stat.threshold}
      </td>
    </tr>
  );
}

function DriftSection({ drift }: { drift: FrameQaReport["drift"] }) {
  return (
    <section className="x-panel min-w-0 px-5 py-4">
      <SectionHead
        title="一致性漂移"
        count={drift.available ? drift.rows : undefined}
        hint="商品 / 人物一致性（frameQaDetail.drift）"
      />
      {drift.available ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 font-mono text-data tabular-nums sm:grid-cols-3">
          <div className="flex items-baseline gap-2">
            <dt className="x-label">命中</dt>
            <dd className={cn(drift.flagged > 0 ? "text-gold" : "text-foreground")}>{drift.flagged}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="x-label">命中率</dt>
            <dd className="text-muted-foreground">{percent(drift.flaggedRate)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="x-label">平均分</dt>
            <dd className="text-muted-foreground">{drift.meanScore === null ? "—" : drift.meanScore.toFixed(3)}</dd>
          </div>
        </dl>
      ) : (
        <p className="py-4 text-meta text-muted-foreground">
          未接入：窗口内没有任何一行带 drift 字段。P01-B 把商品 / 人物一致性检查写进 frameQaDetail 之后这里自动出数。
        </p>
      )}
    </section>
  );
}

