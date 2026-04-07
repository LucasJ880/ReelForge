"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Zap, ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function NewBatchPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [duration, setDuration] = useState("5");
  const [ratio, setRatio] = useState("9:16");
  const [resolution, setResolution] = useState("720p");
  const [concurrency, setConcurrency] = useState("2");
  const [autoVideo, setAutoVideo] = useState(true);

  const set = (fn: (v: string) => void) => (v: string | null) => {
    if (v !== null) fn(v);
  };

  const keywords = keywordsText
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || keywords.length === 0 || loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          keywords,
          videoParams: { duration: parseInt(duration), ratio, resolution },
          concurrency: parseInt(concurrency),
          autoGenerateVideo: autoVideo,
          autoStart: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "创建失败");
      }

      const batch = await res.json();
      toast.success(`批次已创建，${keywords.length} 个项目开始处理`);
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto pt-4">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-2">
          批量生成
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          一次创建多个视频
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          输入多个关键词，系统将逐个生成内容和视频
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Batch name */}
        <div>
          <label className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-2 block">
            批次名称
          </label>
          <input
            type="text"
            placeholder="例如：宠物用品系列..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-300 focus:outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 transition-all"
          />
        </div>

        {/* Keywords */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium">
              关键词列表
            </label>
            <span className="text-[11px] text-zinc-300 tabular-nums">
              已识别 {keywords.length} 个
            </span>
          </div>
          <textarea
            placeholder={"宠物用品推荐\n健身教程\n美食探店\n旅行攻略\n数码产品评测"}
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            disabled={loading}
            rows={8}
            className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-mono text-zinc-900 placeholder:text-zinc-300 focus:outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 transition-all resize-none"
          />
        </div>

        {/* Advanced */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            高级设置
            <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </button>
          {!showAdvanced && (
            <p className="text-[11px] text-zinc-300 mt-1">
              默认：5秒 · 9:16竖屏 · 720p · 并发2
            </p>
          )}
          {showAdvanced && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <FieldSelect label="视频时长" value={duration} onValueChange={set(setDuration)}
                options={[{ v: "5", l: "5 秒" }, { v: "10", l: "10 秒" }]} />
              <FieldSelect label="画面比例" value={ratio} onValueChange={set(setRatio)}
                options={[{ v: "9:16", l: "9:16 竖屏" }, { v: "16:9", l: "16:9 横屏" }, { v: "1:1", l: "1:1 方形" }]} />
              <FieldSelect label="分辨率" value={resolution} onValueChange={set(setResolution)}
                options={[{ v: "720p", l: "720p" }, { v: "1080p", l: "1080p" }]} />
              <FieldSelect label="并发数" value={concurrency} onValueChange={set(setConcurrency)}
                options={[{ v: "1", l: "1 保守" }, { v: "2", l: "2 推荐" }, { v: "3", l: "3 较快" }, { v: "5", l: "5 最快" }]} />
              <div className="col-span-2 flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="autoVideo"
                  checked={autoVideo}
                  onChange={(e) => setAutoVideo(e.target.checked)}
                  className="rounded border-zinc-300"
                />
                <label htmlFor="autoVideo" className="text-sm text-zinc-600">
                  自动生成视频
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!name.trim() || keywords.length === 0 || loading}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4" />
          )}
          {loading ? "创建中..." : `创建并启动（${keywords.length} 个视频）`}
        </button>
      </form>
    </div>
  );
}

function FieldSelect({
  label, value, onValueChange, options,
}: {
  label: string;
  value: string;
  onValueChange: (v: string | null) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-1.5 block">
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="text-sm border-zinc-200">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
