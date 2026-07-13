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
      eyebrow="第 4 步 · AI 脚本"
      title="客户原创版本的脚本，绝不复制参考视频。"
      description={
        <span>
          当前方向：
          <strong className="text-foreground">{selectedCard?.title}</strong>。
          {isDefault ? (
            <span>
              下面是默认方向的完整脚本草稿。其它方向的完整草稿会在 Aivora
              的 Unified Creative Input 中实时生成。
            </span>
          ) : (
            <span className="text-warning">
              其它方向的完整脚本会由 Aivora 的 prompt intelligence
              引擎在生成时实时产出；这里展示默认方向的样例。
            </span>
          )}
        </span>
      }
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-(--radius-lg) border border-border bg-card p-6">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                视频标题
              </p>
              <h3 className="mt-2 text-xl font-semibold leading-snug">
                {generatedScript.title}
              </h3>
            </div>

            <div className="rounded-(--radius-lg) border border-primary/25 bg-primary/[0.06] p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                <MessageSquare size={14} /> 前 3 秒 Hook
              </p>
              <p className="mt-2 text-base font-medium leading-7">
                {generatedScript.hook}
              </p>
            </div>

            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                <Mic size={14} /> 完整口播
              </p>
              <p className="mt-2 whitespace-pre-line rounded-(--radius-lg) bg-muted p-4 text-sm leading-7">
                {generatedScript.voiceover}
              </p>
            </div>

            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                <Type size={14} /> 屏幕字幕
              </p>
              <ul className="mt-2 space-y-1.5">
                {generatedScript.captions.map((c) => (
                  <li
                    key={c.sceneIndex}
                    className="flex items-start gap-3 rounded-(--radius-lg) bg-muted px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-primary">
                      镜头 {String(c.sceneIndex).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.startSec}-{c.endSec}s
                    </span>
                    <span className="flex-1">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-(--radius-lg) bg-muted p-4">
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
          <div className="rounded-(--radius-lg) border border-border bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              各平台改写建议
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

          <div className="rounded-(--radius-lg) border border-warning bg-warning/10 p-5">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-warning">
              <AlertTriangle size={14} /> 合规提示
            </p>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              {generatedScript.complianceNotes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-(--radius-lg) border border-success bg-success/[0.05] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-success">
              原创性自检
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              copiedFromReference ={" "}
              <code className="rounded bg-muted px-1.5 py-0.5">false</code>
              {" "}— 模型在生成时显式声明本脚本为客户原创版本，与任何参考视频的字幕、
              配音或镜头脚本均不相同。
            </p>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
