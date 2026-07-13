"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  ArrowRight,
  ImagePlus,
  Loader2,
  Send,
  Clapperboard,
  Mic,
  Flame,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [messages, sending]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const capacity = 10 - images.length;
      const list = Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, capacity);
      const assets = await uploadFilesToAssets(list, {
        forceRole: "product_image",
      });
      setImages((prev) => [...prev, ...assets]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
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
    <div className="space-y-6">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      <header className="max-w-4xl space-y-4">
        <Badge variant="secondary">AI Creative Director</Badge>
        <h1 className="editorial-display">
          Agent <em>导演</em>
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          上传产品图，说清创意方向，再由导演与你一起整理成可执行的短视频脚本。
        </p>
      </header>

      <Card className="min-w-0">
        <CardHeader className="border-b border-border">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-md) bg-accent-soft text-foreground">
                <Bot className="size-4 stroke-[1.5]" aria-hidden />
              </span>
              <div className="min-w-0">
                <CardTitle>创意对话</CardTitle>
                <CardDescription>剧本、UGC 口播或爆款节奏，都可以直接描述。</CardDescription>
              </div>
            </div>
            <Badge variant={brief ? "success" : "secondary"}>
              {brief ? "需求已就绪" : "等待创意"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-2">
          <section aria-labelledby="agent-assets-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="agent-assets-heading" className="text-subhead font-medium">
                  产品素材
                </h2>
                <p className="text-meta text-muted-foreground">
                  最多 10 张，也可以先聊需求。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading || images.length >= 10}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                上传产品图
              </Button>
            </div>
            {images.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {images.map((img, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={img.id}
                    src={img.url}
                    alt={`产品素材 ${index + 1}`}
                    className="size-12 rounded-(--radius-md) border border-border object-cover"
                  />
                ))}
                <Badge variant="secondary">{images.length}/10</Badge>
              </div>
            )}
          </section>

          <section aria-label="与 AI 导演的对话" className="space-y-4 border-y border-border py-5">
            <div
              ref={scrollRef}
              className="max-h-96 min-h-64 space-y-3 overflow-y-auto"
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
                        ? "max-w-[85%] rounded-(--radius-lg) border border-primary bg-accent-soft px-4 py-3 text-body text-foreground sm:max-w-[70%]"
                        : "max-w-[90%] rounded-(--radius-lg) border border-border bg-muted px-4 py-3 text-body text-foreground sm:max-w-[75%]"
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

            <div className="flex flex-wrap gap-2" aria-label="快捷创意方向">
              {QUICK_CHIPS.map((chip) => {
                const Icon = chip.icon;
                return (
                  <Button
                    key={chip.label}
                    type="button"
                    variant="outline"
                    size="xs"
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
                创意需求
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
                  placeholder="例如：15 秒 UGC 口播，美国市场，突出防摔。"
                  className="resize-none"
                />
              </label>
              <Button
                type="button"
                onClick={() => send(input)}
                disabled={sending || !input.trim()}
                aria-label="发送创意需求"
              >
                <Send />
                发送
              </Button>
            </div>
          </section>

          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-meta text-muted-foreground">
              {brief
                ? "需求已就绪，可以进入脚本与出片流程。"
                : "聊清楚需求后，可随时进入创作流程继续编辑。"}
            </p>
            <Button type="button" onClick={goCreate}>
              {brief ? "进入脚本创作" : "直接开始创作"}
              <ArrowRight />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
