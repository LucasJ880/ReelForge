import { Mic, Type, MessageSquare, AlertTriangle } from "lucide-react";
import {
  creativeEvidenceCards,
  generatedScript,
  type CreativeEvidenceCardSlug,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

interface Props {
  selectedSlug: CreativeEvidenceCardSlug;
}

export function AIScriptSection({ selectedSlug }: Props) {
  const selectedCard = creativeEvidenceCards.find(
    (c) => c.slug === selectedSlug,
  );
  const isDefault = selectedSlug === generatedScript.forCardSlug;

  return (
    <DemoSection
      id="script"
      eyebrow="Step 4 · AI script"
      title="An original client script — never a copy of the reference."
      description={
        <span>
          For direction:{" "}
          <strong className="text-foreground">{selectedCard?.title}</strong>.{" "}
          {isDefault ? (
            <span>
              下面是这次默认方向的完整脚本草稿。其它方向的草稿可在切换 direction
              后由 wizard 流程实时生成。
            </span>
          ) : (
            <span className="text-amber-300">
              其它方向的完整脚本会在 /wizard/[orderId]/step-3-script 真实生成；
              这里展示默认方向的样例。
            </span>
          )}
        </span>
      }
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-white/10 bg-card/70 p-6">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Video title
              </p>
              <h3 className="mt-2 text-xl font-semibold leading-snug">
                {generatedScript.title}
              </h3>
            </div>

            <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                <MessageSquare size={14} /> First 3-second hook
              </p>
              <p className="mt-2 text-base font-medium leading-7">
                {generatedScript.hook}
              </p>
            </div>

            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                <Mic size={14} /> Voice-over script
              </p>
              <p className="mt-2 whitespace-pre-line rounded-2xl bg-white/[0.03] p-4 text-sm leading-7">
                {generatedScript.voiceover}
              </p>
            </div>

            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                <Type size={14} /> On-screen captions
              </p>
              <ul className="mt-2 space-y-1.5">
                {generatedScript.captions.map((c) => (
                  <li
                    key={c.sceneIndex}
                    className="flex items-start gap-3 rounded-2xl bg-white/[0.03] px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-primary">
                      Shot {String(c.sceneIndex).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.startSec}-{c.endSec}s
                    </span>
                    <span className="flex-1">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                CTA
              </p>
              <p className="mt-2 text-sm font-medium leading-6">
                {generatedScript.cta}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-3xl border border-white/10 bg-card/60 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Platform notes
            </p>
            <ul className="mt-3 space-y-2.5">
              {generatedScript.platformNotes.map((note) => (
                <li key={note.platform}>
                  <p className="text-sm font-medium">{note.platform}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {note.note}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.05] p-5">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">
              <AlertTriangle size={14} /> Compliance notes
            </p>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              {generatedScript.complianceNotes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Originality self-check
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              copiedFromReference ={" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5">false</code>
              {" "}— 模型在生成时显式声明本脚本是客户原创版本，与任何 reference
              video 的字幕、配音或镜头脚本不同。
            </p>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
