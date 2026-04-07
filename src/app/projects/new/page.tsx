"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

const suggestions = [
  "宠物用品推荐",
  "健身教程",
  "美食探店",
  "旅行攻略",
  "数码产品评测",
  "居家好物分享",
  "穿搭灵感",
  "读书推荐",
];

export default function NewProjectPage() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "creating" | "generating">("input");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim() || loading) return;

    setLoading(true);
    try {
      setStep("creating");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim() }),
      });
      if (!res.ok) throw new Error("创建失败");
      const project = await res.json();

      setStep("generating");
      const genRes = await fetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
      });

      if (!genRes.ok) {
        toast.warning("项目已创建，但内容生成失败，请在详情页重试");
      } else {
        toast.success("内容方案已生成");
      }

      router.push(`/projects/${project.id}`);
    } catch {
      toast.error("操作失败，请重试");
      setStep("input");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto pt-8 sm:pt-16">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-2">
          新作品
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          输入关键词，开始创作
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          AI 将根据关键词生成脚本、标题、Hashtags 和内容角度
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="rounded-2xl border border-zinc-200 bg-white p-1 focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
          <input
            type="text"
            placeholder="描述你想创作的视频方向..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            disabled={loading}
            autoFocus
            className="w-full bg-transparent px-4 py-4 text-base text-zinc-900 placeholder:text-zinc-300 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 4).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setKeyword(s)}
                  className="rounded-full bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-500 hover:bg-violet-50 hover:text-violet-600 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={!keyword.trim() || loading}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {loading
                ? step === "creating"
                  ? "创建中..."
                  : "生成中..."
                : "生成"}
            </button>
          </div>
        </div>
      </form>

      {step === "generating" && (
        <div className="mt-6 flex items-center gap-3 text-sm text-violet-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            AI 正在为「{keyword}」构思内容方案...
          </span>
        </div>
      )}
    </div>
  );
}
