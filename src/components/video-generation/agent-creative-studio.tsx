"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  Clapperboard,
  Images,
  Loader2,
  MessageSquareText,
  Send,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { CreateModeTabs } from "@/components/product-images/create-mode-tabs";
import { FileDropzone } from "@/components/ui/dropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { UnifiedCreativeInput } from "@/components/video-generation/unified-creative-input";
import { uploadFilesToAssets } from "@/components/personal/upload-assets";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { useTranslation } from "@/i18n/useTranslation";
import { cn } from "@/lib/utils";
import type { OrderCreativeDraft } from "@/lib/services/order-creative-draft";
import type { UploadedAsset } from "@/types/video-generation";

export type QualityTemplateSkill =
  | "tpl_event_watch_party"
  | "tpl_viral_result_first"
  | "tpl_viral_pain_solution"
  | "tpl_ugc_review"
  | "tpl_viral_sensory_texture";

export type AgentTemplateRecommendation = {
  skillId: QualityTemplateSkill;
  batchTemplateId: string | null;
  name: string;
  nameZh: string;
  coverImage: string;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

export function AgentCreativeStudio({
  initialAssets = [],
  initialStyleTemplateId,
  recommendations,
}: {
  initialAssets?: UploadedAsset[];
  initialStyleTemplateId?: string;
  recommendations: AgentTemplateRecommendation[];
}) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).create;
  const agent = copy.agent;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<UploadedAsset[]>(initialAssets);
  const [brief, setBrief] = useState<{ prompt: string; duration: 15 | 30 | 60 } | null>(null);
  const [selectedTemplateSkill, setSelectedTemplateSkill] = useState<QualityTemplateSkill>(
    isQualityTemplateSkill(initialStyleTemplateId)
      ? initialStyleTemplateId
      : "tpl_viral_result_first",
  );
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const productionRef = useRef<HTMLElement>(null);

  const quickPrompts = useMemo(
    () => [
      {
        icon: Clapperboard,
        label: agent.quickCommerce,
        text: locale === "en-US"
          ? "Create a conversion-focused product video with a strong opening hook and clear proof."
          : "做一条带货脚本片，开头钩子要强，中段清晰证明产品卖点。",
      },
      {
        icon: MessageSquareText,
        label: agent.quickUgc,
        text: locale === "en-US"
          ? "Create a believable 15-second UGC product review with a consistent person and product."
          : "做一条 15 秒真实 UGC 口播，人物和产品全程保持一致。",
      },
      {
        icon: Trophy,
        label: agent.quickEvent,
        text: locale === "en-US"
          ? "Create a World Cup video for young adults in one believable watch-party setting."
          : "世界杯，年轻人，同一个真实客厅看球场景，人物和产品保持一致。",
      },
      {
        icon: Sparkles,
        label: agent.quickAuto,
        text: locale === "en-US"
          ? "Recommend the safest high-quality creative direction for this product."
          : "你来推荐最稳、最适合这个产品的高质量创意方向。",
      },
    ],
    [agent, locale],
  );

  const productionPrompt = brief?.prompt
    ?? messages.filter((message) => message.role === "user").map((message) => message.content).join("; ");
  const draft: OrderCreativeDraft = {
    rawPrompt: productionPrompt,
    selectedDuration: brief?.duration ?? 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "auto_end_card",
    cta: "",
    brandName: "",
    website: "",
    sourceTitle: "Aivora Agent Director",
  };
  const selectedRecommendation = recommendations.find(
    (recommendation) => recommendation.skillId === selectedTemplateSkill,
  );
  const productionKey = [
    productionPrompt,
    brief?.duration ?? 15,
    selectedTemplateSkill,
    attachments.map((asset) => asset.id).join(","),
  ].join("|");

  async function handleUpload(files: File[] | FileList | null) {
    if (!files) return;
    const available = 10 - attachments.length;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, available);
    if (imageFiles.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await uploadFilesToAssets(imageFiles, { forceRole: "product_image" });
      setAttachments((current) => [...current, ...uploaded]);
      toast.success(agent.uploaded.replace("{count}", String(uploaded.length)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : agent.error);
    } finally {
      setUploading(false);
    }
  }

  async function send(raw: string) {
    const content = raw.trim();
    if (!content || sending) return;
    setInput("");
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setSelectedTemplateSkill(inferTemplateSkill(nextMessages.map((message) => message.content).join(" ")));
    setSending(true);
    try {
      const response = await fetch("/api/personal/agent-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-20),
          imageCount: attachments.length,
          locale,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? agent.error);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: String(result.reply) },
      ]);
      if (result.readyToGenerate && result.suggestedPrompt) {
        setBrief({
          prompt: String(result.suggestedPrompt),
          duration: result.suggestedDuration === 30 || result.suggestedDuration === 60
            ? result.suggestedDuration
            : 15,
        });
      }
      requestAnimationFrame(() => {
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: agent.error }]);
    } finally {
      setSending(false);
    }
  }

  function reviewProduction() {
    productionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="editorial-page-stack">
      <header className="studio-hero max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="studio-label text-muted-foreground">{copy.kicker}</p>
          <Badge variant="secondary">{agent.status}</Badge>
        </div>
        <h1 className="editorial-display">{copy.title}</h1>
        <p className="max-w-2xl text-body text-muted-foreground">{copy.subtitle}</p>
        <CreateModeTabs active="video" />
      </header>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-md) border border-border bg-accent-soft text-foreground">
                <Bot className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <CardTitle>{agent.conversation}</CardTitle>
                <p className="mt-1 text-meta text-muted-foreground">{agent.conversationHint}</p>
              </div>
            </div>
            <Badge variant={brief ? "success" : "secondary"}>{brief ? agent.ready : agent.waiting}</Badge>
          </div>
        </CardHeader>

        <CardContent className="grid min-w-0 p-0 xl:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="order-2 space-y-6 border-t border-border bg-muted p-5 sm:p-6 xl:order-1 xl:border-t-0 xl:border-r" aria-label={agent.assets}>
            <section className="space-y-3">
              <div>
                <h2 className="font-heading text-subhead font-semibold">{agent.assets}</h2>
                <p className="mt-1 text-meta text-muted-foreground">{agent.assetsHint}</p>
              </div>
              <FileDropzone
                title={agent.upload}
                description="PNG / JPG / WebP"
                uploading={uploading}
                disabled={attachments.length >= 10}
                onFiles={(files) => void handleUpload(files)}
              />
              {attachments.length > 0 ? (
                <ul className="grid grid-cols-4 gap-2 xl:grid-cols-3" aria-label={agent.assets}>
                  {attachments.map((asset, index) => (
                    <li key={asset.id} className="group relative aspect-square overflow-hidden rounded-(--radius-md) border border-border bg-card">
                      <Image src={asset.url} alt={`${agent.assets} ${index + 1}`} fill unoptimized sizes="80px" className="object-cover" />
                      <button
                        type="button"
                        onClick={() => setAttachments((current) => current.filter((item) => item.id !== asset.id))}
                        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full border border-border bg-overlay text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`${locale === "en-US" ? "Remove asset" : "移除素材"} ${index + 1}`}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="rounded-(--radius-md) border border-dashed border-border bg-card p-3 text-meta text-muted-foreground">{agent.uploadEmpty}</p>}
            </section>

            <section className="border-t border-border pt-5">
              <h2 className="studio-label text-muted-foreground">{agent.steps}</h2>
              <ol className="mt-4 space-y-3 text-meta text-muted-foreground">
                {[agent.stepAssets, agent.stepBrief, agent.stepTemplate].map((step, index) => (
                  <li key={step} className="flex items-center gap-3">
                    <span className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono tabular-nums",
                      index === 0 && attachments.length > 0 || index === 1 && messages.length > 0 || index === 2 && brief
                        ? "border-primary bg-accent-soft text-foreground"
                        : "border-border bg-card",
                    )}>
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          </aside>

          <section className="order-1 flex min-w-0 flex-col xl:order-2" aria-label={agent.conversation}>
            <div ref={chatScrollRef} className="min-h-72 flex-1 space-y-4 overflow-y-auto p-5 sm:min-h-96 sm:p-6" aria-live="polite">
              <ChatBubble role="assistant">{agent.welcome}</ChatBubble>
              {messages.map((message, index) => <ChatBubble key={`${message.role}-${index}`} role={message.role}>{message.content}</ChatBubble>)}
              {sending ? <ChatBubble role="assistant"><span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{agent.thinking}</span></ChatBubble> : null}
            </div>

            <div className="space-y-4 border-t border-border bg-muted p-5 sm:p-6">
              <div className="flex gap-2 overflow-x-auto pb-1" aria-label={agent.quickLabel}>
                {quickPrompts.map(({ icon: Icon, label, text }) => (
                  <Button key={label} type="button" variant="outline" size="sm" className="shrink-0 bg-card" disabled={sending} onClick={() => void send(text)}>
                    <Icon aria-hidden />{label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 text-meta font-medium">
                  {agent.promptLabel}
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send(input);
                      }
                    }}
                    rows={2}
                    placeholder={agent.promptPlaceholder}
                    className="mt-2 resize-none bg-card"
                  />
                </label>
                <Button type="button" disabled={sending || !input.trim()} onClick={() => void send(input)} className="sm:self-end">
                  <Send aria-hidden />{agent.send}
                </Button>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      <section className="space-y-4" aria-labelledby="agent-template-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="studio-label text-muted-foreground">QUALITY LOCK</p>
            <h2 id="agent-template-heading" className="mt-2 font-heading text-title font-semibold">{agent.templateHeading}</h2>
            <p className="mt-1 max-w-2xl text-body text-muted-foreground">{agent.templateHint}</p>
          </div>
          <Button render={<Link href="/app/templates" />} variant="ghost">{agent.browseAll}<ArrowRight aria-hidden /></Button>
        </div>
        <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {recommendations.map((recommendation) => {
            const selected = recommendation.skillId === selectedTemplateSkill;
            return (
              <li key={recommendation.skillId} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedTemplateSkill(recommendation.skillId)}
                  className={cn(
                    "studio-panel group w-full overflow-hidden text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    selected && "border-primary",
                  )}
                  aria-pressed={selected}
                >
                  <span className="relative block aspect-video overflow-hidden bg-secondary">
                    <Image src={recommendation.coverImage} alt={locale === "en-US" ? recommendation.name : recommendation.nameZh} fill unoptimized sizes="(min-width:1280px) 18vw, (min-width:640px) 50vw, 100vw" className="object-cover transition-transform duration-base group-hover:scale-[1.02] motion-reduce:transition-none" />
                  </span>
                  <span className="flex items-center justify-between gap-2 p-3">
                    <span className="min-w-0 truncate text-meta font-semibold text-foreground">{locale === "en-US" ? recommendation.name : recommendation.nameZh}</span>
                    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {selected ? <Check className="size-3" aria-hidden /> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={reviewProduction}><Images aria-hidden />{agent.review}</Button>
          {selectedRecommendation?.batchTemplateId ? (
            <Button render={<Link href={`/app/batches/new?template=${encodeURIComponent(selectedRecommendation.batchTemplateId)}`} />} variant="outline">{agent.batch}<ArrowRight aria-hidden /></Button>
          ) : null}
        </div>
      </section>

      <section ref={productionRef} className="scroll-mt-20 space-y-4" aria-labelledby="agent-production-heading">
        <div>
          <p className="studio-label text-muted-foreground">PRODUCTION BRIEF</p>
          <h2 id="agent-production-heading" className="mt-2 font-heading text-title font-semibold">{agent.directHeading}</h2>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">{agent.directHint}</p>
        </div>
        <UnifiedCreativeInput
          key={productionKey}
          userType="platform"
          initialDraft={draft}
          initialAssets={attachments}
          initialStyleTemplateId={selectedTemplateSkill}
        />
      </section>
    </div>
  );
}

function ChatBubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div className={role === "user" ? "flex justify-end" : "flex justify-start"}>
      <div className={cn(
        "max-w-[92%] rounded-(--radius-lg) border px-4 py-3 text-body leading-relaxed sm:max-w-[78%]",
        role === "user" ? "border-primary bg-accent-soft text-foreground" : "border-border bg-card text-foreground",
      )}>
        {children}
      </div>
    </div>
  );
}

function isQualityTemplateSkill(value: string | undefined): value is QualityTemplateSkill {
  return value === "tpl_event_watch_party"
    || value === "tpl_viral_result_first"
    || value === "tpl_viral_pain_solution"
    || value === "tpl_ugc_review"
    || value === "tpl_viral_sensory_texture";
}

export function inferTemplateSkill(prompt: string): QualityTemplateSkill {
  if (/(世界杯|world\s*cup|足球|football|soccer|看球|球赛|watch\s*party|match\s*day)/i.test(prompt)) return "tpl_event_watch_party";
  if (/(痛点|问题|解决|before|after|对比|证明|proof|demo)/i.test(prompt)) return "tpl_viral_pain_solution";
  if (/(ugc|口播|手持|测评|review|testimonial)/i.test(prompt)) return "tpl_ugc_review";
  if (/(质感|微距|材质|奢侈|珠宝|美妆|macro|texture|luxury|jewelry)/i.test(prompt)) return "tpl_viral_sensory_texture";
  return "tpl_viral_result_first";
}
