"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  ArrowRight,
  Loader2,
  Send,
  Clapperboard,
  Mic,
  Flame,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileDropzone } from "@/components/ui/dropzone";
import { CardAnchor } from "@/components/editorial/card-anchor";
import { EditorialStepper } from "@/components/editorial/editorial-stepper";
import { Textarea } from "@/components/ui/textarea";
import type { UploadedAsset } from "@/types/video-generation";
import {
  saveCreatePrefill,
  uploadFilesToAssets,
} from "@/components/personal/upload-assets";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const WELCOME: ChatMessage = {
  role: "assistant",
  content:
    "你好，我是你的 AI 导演。把产品图传上来，然后像聊天一样告诉我你要什么——比如“我要一条带货剧本片”“我要 UGC 口播”“帮我复刻爆款”。不知道说什么就点下面的快捷按钮，我来带你。",
};

const QUICK_CHIPS = [
  { icon: Clapperboard, label: "带货剧本片", text: "我要一条带货剧本片，突出产品核心卖点" },
  { icon: Mic, label: "UGC口播", text: "我要 15 秒 UGC 口播风格，真人实拍感强一点" },
  { icon: Flame, label: "复刻爆款", text: "帮我按最近的爆款节奏复刻一条，钩子要强" },
  { icon: Wand2, label: "你看着办", text: "你看着办，帮我做一条最适合这个产品的短视频" },
];

export default function AgentDirectorPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [images, setImages] = useState<UploadedAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<{
    prompt: string;
    duration: 15 | 30 | 60;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [messages, sending]);

  async function handleUpload(files: File[] | FileList | null) {
    if (!files || (files instanceof FileList ? files.length === 0 : files.length === 0))
      return;
    setError(null);
    setUploading(true);
    try {
      const capacity = 10 - images.length;
      const list = Array.from(files instanceof FileList ? files : files)
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, capacity);
      const assets = await uploadFilesToAssets(list, {
        forceRole: "product_image",
      });
      setImages((prev) => [...prev, ...assets]);
      toast.success(`已上传 ${assets.length} 张产品图`);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setSending(true);
    try {
      const res = await fetch("/api/personal/agent-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          /// 欢迎语不算历史，避免干扰模型
          messages: nextMessages.slice(1).slice(-20),
          imageCount: images.length,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        throw new Error(j.error ?? "导演走神了，请重试");
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: j.reply as string },
      ]);
      if (j.readyToGenerate && j.suggestedPrompt) {
        setBrief({
          prompt: j.suggestedPrompt as string,
          duration: (j.suggestedDuration as 15 | 30 | 60 | null) ?? 15,
        });
      }
    } catch (e) {
      setError((e as Error).message);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "网络有点抖，刚才没听清。请再说一遍。",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function goCreate() {
    saveCreatePrefill({
      prompt: brief?.prompt ?? messages.filter((m) => m.role === "user").map((m) => m.content).join("；"),
      duration: brief?.duration ?? 15,
      attachments: images,
      mode: "fast",
    });
    router.push("/personal/create-video?from=agent");
  }

  return (
    <div className="editorial-page-stack">
      <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-3xl space-y-4">
          <Badge variant="secondary">AI Creative Director</Badge>
          <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="editorial-display">Agent</span>
            <span className="font-sans text-section font-medium tracking-normal text-foreground">
              创意导演
            </span>
          </h1>
          <p className="max-w-2xl text-body text-muted-foreground">
            上传产品素材，用自然语言说清目标。导演会与你一起收敛创意，并整理成可以直接执行的短视频脚本。
          </p>
        </div>
        <div className="hidden items-center gap-2 text-meta text-muted-foreground lg:flex">
          <span className="size-2 rounded-full bg-success" aria-hidden />
          对话工作台已就绪
        </div>
      </header>

      <Card className="min-w-0 gap-0 py-0">
        <CardHeader className="border-b border-border py-5">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <CardAnchor icon={Bot} label="创意对话" />
              <div className="min-w-0">
                <CardTitle>创意对话</CardTitle>
                <CardDescription>从模糊想法到可执行脚本，一次聊清楚。</CardDescription>
              </div>
            </div>
            <Badge variant={brief ? "success" : "secondary"}>
              {brief ? "需求已就绪" : "等待创意"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="grid min-w-0 p-0 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            aria-label="产品素材与创作流程"
            className="grid gap-6 border-b border-border bg-muted p-5 sm:grid-cols-[minmax(0,1fr)_18rem] sm:p-6 xl:block xl:space-y-6 xl:border-r xl:border-b-0"
          >
            <section aria-labelledby="agent-assets-heading" className="space-y-4">
              <div className="space-y-1">
                <h2 id="agent-assets-heading" className="text-subhead font-medium">
                  产品素材
                </h2>
                <p className="text-meta text-muted-foreground">
                  上传 1–10 张清晰产品图，导演会优先参考。
                </p>
              </div>
              <FileDropzone
                title="上传产品图"
                description="支持 JPG / PNG / WebP，最多 10 张"
                uploading={uploading}
                disabled={images.length >= 10}
                onFiles={(files) => void handleUpload(files)}
              />
              {images.length > 0 ? (
                <div className="grid grid-cols-4 gap-2 xl:grid-cols-3">
                  {images.map((img, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt={`产品素材 ${index + 1}`}
                      className="aspect-square w-full rounded-(--radius-md) border border-border object-cover"
                    />
                  ))}
                  <div className="flex aspect-square items-center justify-center rounded-(--radius-md) border border-dashed border-border bg-card text-meta text-muted-foreground">
                    {images.length}/10
                  </div>
                </div>
              ) : (
                <div className="rounded-(--radius-md) border border-dashed border-border bg-card p-4">
                  <p className="text-meta text-muted-foreground">
                    暂无素材。你也可以先描述想法，稍后再补充图片。
                  </p>
                </div>
              )}
            </section>

            <section
              className="hidden space-y-3 border-l border-border pl-6 sm:block xl:border-t xl:border-l-0 xl:pt-5 xl:pl-0"
              aria-labelledby="agent-flow-heading"
            >
              <h2 id="agent-flow-heading" className="text-meta font-semibold text-foreground">
                本次创作
              </h2>
              <EditorialStepper
                currentIndex={brief ? 2 : images.length > 0 ? 1 : 0}
                steps={[
                  { id: "assets", title: "上传产品素材" },
                  { id: "brief", title: "说明受众与卖点" },
                  { id: "script", title: "确认脚本并开始创作" },
                ]}
              />
            </section>
          </aside>

          <section aria-label="与 AI 导演的对话" className="flex min-w-0 flex-col">
            <div
              ref={scrollRef}
              className="max-h-[32rem] min-h-80 flex-1 space-y-4 overflow-y-auto p-5 sm:p-6 xl:min-h-[28rem]"
              role="region"
              aria-label="创意对话记录"
              aria-live="polite"
              tabIndex={0}
            >
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[88%] rounded-(--radius-lg) border border-primary bg-accent-soft px-4 py-3 text-body text-foreground sm:max-w-[72%]"
                        : "max-w-[92%] rounded-(--radius-lg) border border-border bg-card px-4 py-3 text-body text-foreground sm:max-w-[78%]"
                    }
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-(--radius-lg) border border-border bg-muted px-4 py-3 text-meta text-muted-foreground">
                    <Loader2 className="size-4 animate-spin stroke-[1.5]" aria-hidden />
                    导演思考中
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4 border-t border-border bg-muted p-5 sm:p-6">
              <div className="flex flex-wrap gap-2" aria-label="快捷创意方向">
                {QUICK_CHIPS.map((chip) => {
                  const Icon = chip.icon;
                  return (
                    <Button
                      key={chip.label}
                      type="button"
                      variant="outline"
                      size="xs"
                      className="bg-card"
                      disabled={sending}
                      onClick={() => send(chip.text)}
                    >
                      <Icon />
                      {chip.label}
                    </Button>
                  );
                })}
              </div>

              <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 space-y-2 text-meta font-medium">
                  告诉导演你想做什么
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(input);
                      }
                    }}
                    rows={2}
                    placeholder="例如：15 秒 UGC 口播，面向美国市场，重点突出防摔。"
                    className="resize-none"
                  />
                </label>
                <Button
                  type="button"
                  onClick={() => send(input)}
                  disabled={sending || !input.trim()}
                  aria-label="发送创意需求"
                  className="sm:self-end"
                >
                  <Send />
                  发送
                </Button>
              </div>
            </div>
          </section>
        </CardContent>

        <div className="flex min-w-0 flex-col gap-4 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {error ? (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          ) : (
            <p className="text-meta text-muted-foreground">
              {brief
                ? "需求已整理完成，可以进入脚本与出片流程。"
                : "也可以跳过对话，直接进入创作页继续编辑。"}
            </p>
          )}
          <Button type="button" onClick={goCreate}>
            {brief ? "进入脚本创作" : "直接开始创作"}
            <ArrowRight />
          </Button>
        </div>
      </Card>
    </div>
  );
}
