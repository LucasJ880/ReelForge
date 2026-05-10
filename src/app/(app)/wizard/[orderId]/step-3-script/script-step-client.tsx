"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WizardMockBanner } from "@/components/wizard/wizard-mock-banner";

type CurrentScript = Awaited<
  ReturnType<typeof import("@/lib/services/wizard-script-service").getCurrentWizardScript>
>;

export function ScriptStepClient({
  orderId,
  initialScript,
  cardSelected,
}: {
  orderId: string;
  initialScript: CurrentScript;
  cardSelected: boolean;
}) {
  const router = useRouter();
  const [script, setScript] = useState(initialScript);
  const [hook, setHook] = useState(initialScript?.hook ?? "");
  const [cta, setCta] = useState(initialScript?.cta ?? "");
  const [fullText, setFullText] = useState(initialScript?.fullText ?? "");
  const [generating, startGenerate] = useTransition();
  const [saving, startSave] = useTransition();
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [bannerLevel, setBannerLevel] = useState<"info" | "warn">("info");
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    startGenerate(async () => {
      const res = await fetch(
        `/api/wizard/projects/${orderId}/script`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? `请求失败 (${res.status})`);
        return;
      }
      const data = (await res.json()) as {
        scriptId: string;
        videoBriefId: string;
        scriptOutput: {
          language: string;
          title: string;
          hook: string;
          voiceover: string;
          cta: string;
          captions: { sceneIndex: number; text: string }[];
          complianceNotes: string[];
        };
        fromMock: boolean;
        reason?: string | null;
      };
      const composed = composeFullText(data.scriptOutput);
      setScript({
        scriptId: data.scriptId,
        videoBriefId: data.videoBriefId,
        language: data.scriptOutput.language,
        fullText: composed,
        hook: data.scriptOutput.hook,
        cta: data.scriptOutput.cta,
        version: (script?.version ?? 0) + 1,
        /// scriptOutput 由 server 写到 Script.metadata；UI 仅展示 hook/cta/fullText，
        /// 不需要在 client 持有完整对象。下次 server-side reload 会用 metadata 重建。
        scriptOutput: null,
      });
      setHook(data.scriptOutput.hook);
      setCta(data.scriptOutput.cta);
      setFullText(composed);
      if (data.fromMock) {
        setBannerLevel("info");
        setBannerMsg(
          `已生成 mock 脚本草稿（${data.reason ?? "未启用 OpenAI"}）。可以继续编辑文案后进入 Step 4——后续接入真 LLM 后会自动升级为高质量脚本。`,
        );
      } else {
        setBannerLevel("info");
        setBannerMsg("已生成新脚本（来自 OpenAI）。可以微调 hook / cta 后再进入 Step 4。");
      }
    });
  };

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await fetch(`/api/wizard/projects/${orderId}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hook, cta, fullText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? `请求失败 (${res.status})`);
        return;
      }
      setBannerLevel("info");
      setBannerMsg("已保存编辑。");
    });
  };

  return (
    <div className="space-y-5">
      {!cardSelected && (
        <WizardMockBanner
          level="warn"
          message="还未选择证据卡：脚本会基于商家 brief 自由生成。建议先回到 Step 2 选一张卡，效果更好。"
        />
      )}
      {bannerMsg && (
        <WizardMockBanner level={bannerLevel} message={bannerMsg} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">
            当前脚本{script ? ` · v${script.version}` : "（尚未生成）"}
          </CardTitle>
          <Button onClick={generate} disabled={generating} size="sm">
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-2" />
            )}
            {script ? "重新生成" : "生成脚本"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!script ? (
            <p className="text-xs text-muted-foreground">
              点击「生成脚本」开始。即使没有 OPENAI_API_KEY 也能继续。
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Hook（前 3 秒）">
                  <Input value={hook} onChange={(e) => setHook(e.target.value)} />
                </Field>
                <Field label="CTA（结尾）">
                  <Input value={cta} onChange={(e) => setCta(e.target.value)} />
                </Field>
              </div>
              <Field label="脚本全文（Markdown 可编辑）">
                <Textarea
                  value={fullText}
                  rows={18}
                  onChange={(e) => setFullText(e.target.value)}
                  className="font-mono text-xs"
                />
              </Field>
              <div className="flex gap-2 justify-end">
                <Button onClick={save} disabled={saving} variant="outline" size="sm">
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-2" />
                  )}
                  保存编辑
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <Link href={`/wizard/${orderId}/step-2-card`}>
          <Button variant="outline">返回 Step 2</Button>
        </Link>
        <Button
          onClick={() => router.push(`/wizard/${orderId}/step-4-storyboard`)}
          disabled={!script}
        >
          前往 Step 4 · 生成分镜 <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function composeFullText(s: {
  title: string;
  hook: string;
  voiceover: string;
  captions: { sceneIndex: number; text: string }[];
  cta: string;
  complianceNotes: string[];
}) {
  return [
    `# ${s.title}`,
    "",
    "## Hook",
    s.hook,
    "",
    "## Voiceover",
    s.voiceover,
    "",
    "## Captions",
    s.captions.length
      ? s.captions.map((c) => `  [Scene ${c.sceneIndex}] ${c.text}`).join("\n")
      : "(none)",
    "",
    "## CTA",
    s.cta,
    s.complianceNotes.length
      ? `\n## Compliance\n${s.complianceNotes.map((n) => `- ${n}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
