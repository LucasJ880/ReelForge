import { BadgeCheck, FileCheck2 } from "lucide-react";
import { PetSection } from "./pet-section";
import { PetImage } from "./pet-image";
import { productProofReport } from "@/lib/demo/pet-content-kit-demo-data";

export function ProductProofReport() {
  const report = productProofReport;
  return (
    <PetSection
      id="proof-report"
      eyebrow="Product Proof Report · B2B 付费理由"
      title="把真实使用，变成品牌愿意付费的产品证据"
      description={report.summary}
      aside={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
          <FileCheck2 size={14} /> 真实使用证据报告
        </span>
      }
    >
      <div className="border border-border bg-card shadow-editorial overflow-hidden rounded-lg">
        <div className="grid lg:grid-cols-[320px_1fr]">
          {/* 封面 + 概要 */}
          <div className="relative min-h-56 overflow-hidden border-b border-border lg:border-b-0 lg:border-r">
            <PetImage
              src={report.coverImageUrl}
              alt="产品真实使用场景"
              fallbackLabel="真实使用场景"
            />
            <div className="absolute inset-x-0 bottom-0 bg-overlay p-4">
              <p className="text-xs font-medium text-card">
                {report.brandName}
              </p>
              <p className="text-base font-semibold text-card">
                {report.productName}
              </p>
              <p className="mt-1 text-meta text-card">{report.period}</p>
            </div>
          </div>

          {/* 数据 + 卖点 */}
          <div className="p-5 sm:p-6">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {report.metrics.map((m) => (
                <div
                  key={m.label}
                  className="rounded-lg border border-border bg-background p-3 text-center"
                >
                  <dt className="text-meta leading-4 text-muted-foreground">
                    {m.label}
                  </dt>
                  <dd className="mt-1 text-base font-semibold text-foreground">
                    {m.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  自动提炼卖点
                </h3>
                <ul className="mt-2 space-y-2">
                  {report.sellingPoints.map((s) => (
                    <li
                      key={s}
                      className="flex items-start gap-2 text-xs leading-6 text-muted-foreground"
                    >
                      <BadgeCheck
                        size={14}
                        className="mt-0.5 shrink-0 text-success"
                      />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  可用产品场景片段
                </h3>
                <ul className="mt-2 space-y-2">
                  {report.scenes.map((s) => (
                    <li
                      key={s}
                      className="flex items-start gap-2 text-xs leading-6 text-muted-foreground"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="mt-5 rounded-lg border border-success bg-success/10 px-4 py-3 text-xs leading-6 text-foreground/80">
              {report.whyPay}
            </p>
          </div>
        </div>
      </div>
    </PetSection>
  );
}
