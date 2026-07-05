"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  ImagePlus,
  Loader2,
  Send,
  Clapperboard,
  Mic,
  Flame,
  Wand2,
} from "lucide-react";
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
    "你好，我是你的 AI 导演 🎬 把产品图传上来，然后像聊天一样告诉我你要什么——比如“我要一条带货剧本片”“我要 UGC 口播”“帮我复刻爆款”。不知道说啥就点下面的快捷按钮，我来带你。",
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
      behavior: "smooth",
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
          content: "网络有点抖，刚才没听清 😅 再说一遍？",
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
    <div className="flex h-[calc(100vh-7.5rem)] flex-col">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      <div className="glass-card flex min-h-0 flex-1 flex-col p-5">
        {/* 头部 */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/25 border border-sky-300/40">
              <Bot className="h-4 w-4 text-sky-200" />
            </span>
            <h1 className="text-sm font-semibold text-white">
              Agent 导演 · 像聊天一样出片
            </h1>
          </div>
          <p className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
            传产品图 → 说你要什么（剧本 / UGC口播 / 复刻爆款）→ 它带你一步步出成片
          </p>
        </div>

        {/* 产品图行 */}
        <div className="flex flex-wrap items-center gap-3 pb-3">
          <button
            type="button"
            className="glass-btn text-xs"
            disabled={uploading || images.length >= 10}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
            上传产品图
          </button>
          {images.length === 0 ? (
            <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
              还没传图 — 也可以先聊需求
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              {images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.url}
                  alt=""
                  className="h-10 w-10 rounded-lg border border-white/15 object-cover"
                />
              ))}
              <span className="text-[11px]" style={{ color: "var(--glass-text-dim)" }}>
                {images.length}/10
              </span>
            </div>
          )}
        </div>

        {/* 对话区 */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2 pr-1"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={
                  m.role === "user"
                    ? "max-w-[78%] rounded-2xl rounded-br-md border border-sky-300/35 bg-sky-500/25 px-4 py-2.5 text-sm text-sky-50"
                    : "max-w-[85%] rounded-2xl rounded-bl-md border border-white/12 bg-white/8 px-4 py-2.5 text-sm text-white/90"
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-white/12 bg-white/8 px-4 py-2.5 text-sm text-white/60">
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> 导演思考中…
              </div>
            </div>
          )}
        </div>

        {error && <p className="pt-1 text-xs text-rose-300">{error}</p>}

        {/* 快捷 chips */}
        <div className="flex flex-wrap gap-2 pt-3">
          {QUICK_CHIPS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.label}
                type="button"
                className="glass-btn text-xs"
                disabled={sending}
                onClick={() => send(c.text)}
              >
                <Icon className="h-3.5 w-3.5" />
                {c.label}
              </button>
            );
          })}
        </div>

        {/* 输入区 */}
        <div className="flex items-end gap-3 pt-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="像聊天一样说需求…例：我要 15 秒 UGC 口播，美国市场，突出防摔（Enter发送，Shift+Enter换行）"
            className="glass-input min-h-[56px] flex-1 resize-none"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={sending || !input.trim()}
            className="glass-btn-primary h-[52px] w-[52px] rounded-full p-0"
            aria-label="发送"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 底部状态条 */}
      <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-black/35 px-4 py-2.5 backdrop-blur-xl">
        <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
          {brief
            ? "需求已就绪 — 点右侧按钮进入出片流程"
            : "就绪 — 聊清楚需求后即可一键出片"}
        </span>
        <button
          type="button"
          onClick={goCreate}
          className="glass-btn-primary text-xs"
        >
          ▶ {brief ? "去出片：生成脚本" : "跳过对话，直接创作"}
        </button>
      </div>
    </div>
  );
}
