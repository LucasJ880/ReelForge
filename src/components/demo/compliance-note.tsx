import { ShieldCheck } from "lucide-react";
import { COMPLIANCE_NOTES } from "@/lib/demo/ai-video-workflow-demo-data";

export function ComplianceNote() {
  return (
    <section
      id="compliance"
      className="mx-auto w-full max-w-7xl px-5 pb-20 pt-6 sm:px-8 lg:px-10"
    >
      <div className="rounded-[2rem] border border-white/10 bg-card/60 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
            <ShieldCheck size={20} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
              Compliance &amp; scope
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              How we treat references, footage, and AI likeness.
            </h2>
            <ul className="mt-5 grid gap-3 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
              {COMPLIANCE_NOTES.map((note) => (
                <li
                  key={note}
                  className="flex gap-2 rounded-2xl bg-white/[0.04] px-4 py-3"
                >
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
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
