import { ShieldCheck } from "lucide-react";
import { COMPLIANCE_NOTES } from "@/lib/demo/ai-video-workflow-demo-data";

export function ComplianceNote() {
  return (
    <section
      id="compliance"
      className="mx-auto w-full max-w-7xl px-5 pb-20 pt-6 sm:px-8 lg:px-10"
    >
      <div className="rounded-(--radius-lg) border border-border bg-card p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius-lg) bg-success/10 text-success">
            <ShieldCheck size={20} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-success">
              合规边界
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              关于参考视频、客户素材、AI 数字人的使用边界。
            </h2>
            <ul className="mt-5 grid gap-3 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
              {COMPLIANCE_NOTES.map((note) => (
                <li
                  key={note}
                  className="flex gap-2 rounded-(--radius-lg) bg-muted px-4 py-3"
                >
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
