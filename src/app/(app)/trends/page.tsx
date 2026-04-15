"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Loader2,
  CheckSquare,
  Square,
  Flame,
  Eye,
  Heart,
  MessageCircle,
  ExternalLink,
  X,
  Plus,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

interface TrendCandidate {
  sourceUrl: string;
  platform: "tiktok" | "instagram" | "facebook";
  title: string;
  description?: string;
  authorName?: string;
  thumbnailUrl?: string;
  viewCount: number;
  likeCount: number;
  commentCount?: number;
  shareCount?: number;
  duration?: number;
  hashtags?: string[];
}

interface TrendReference {
  id: string;
  sourceUrl: string | null;
  platform: string;
  title: string | null;
  description: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  duration: number | null;
  styleAnalysis: Record<string, string> | null;
  visualAnalysis: Record<string, string> | null;
  createdAt: string;
  _count?: { projects: number };
}

interface SavedKeyword {
  id: string;
  keyword: string;
}

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  tiktok: { label: "TikTok", color: "bg-pink-500/15 text-pink-400" },
  instagram: { label: "Instagram", color: "bg-purple-500/15 text-purple-400" },
  facebook: { label: "Facebook", color: "bg-blue-500/15 text-blue-400" },
};

function formatCount(n: number | null | undefined): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function TrendsPage() {
  const [keyword, setKeyword] = useState("");
  const [platforms, setPlatforms] = useState<Set<string>>(
    new Set(["tiktok", "instagram", "facebook"])
  );
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<TrendCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);

  const [library, setLibrary] = useState<TrendReference[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  const [savedKeywords, setSavedKeywords] = useState<SavedKeyword[]>([]);

  const [detailRef, setDetailRef] = useState<TrendReference | null>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (libraryFilter) params.set("platform", libraryFilter);
      const res = await fetch(`/api/trends?${params}`);
      const data = await res.json();
      setLibrary(data);
    } catch {
      toast.error("加载参考库失败");
    } finally {
      setLoadingLibrary(false);
    }
  }, [libraryFilter]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    fetch("/api/keywords")
      .then((r) => r.json())
      .then(setSavedKeywords)
      .catch(() => {});
  }, []);

  async function handleSearch() {
    if (!keyword.trim() || searching) return;
    setSearching(true);
    setCandidates([]);
    setSelected(new Set());

    try {
      const res = await fetch("/api/trends/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          platforms: [...platforms],
          limit: 50,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "搜索失败");
      }

      const data = await res.json();
      setCandidates(data.candidates);
      toast.success(`找到 ${data.total} 个结果`);

      if (!savedKeywords.find((k) => k.keyword === keyword.trim())) {
        fetch("/api/keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: keyword.trim() }),
        })
          .then((r) => r.json())
          .then((kw) => setSavedKeywords((prev) => [kw, ...prev]))
          .catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  }

  function toggleSelect(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === candidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(candidates.map((c) => c.sourceUrl)));
    }
  }

  async function handleBatchAnalyze() {
    const selectedCandidates = candidates.filter((c) =>
      selected.has(c.sourceUrl)
    );
    if (selectedCandidates.length === 0) return;

    setAnalyzing(true);
    try {
      const res = await fetch("/api/trends/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates: selectedCandidates }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "分析失败");
      }

      const data = await res.json();
      toast.success(`分析完成：${data.succeeded} 成功，${data.failed} 失败`);
      setCandidates([]);
      setSelected(new Set());
      loadLibrary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) {
        if (next.size > 1) next.delete(p);
      } else {
        next.add(p);
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Flame className="h-6 w-6 text-amber-400" />
            爆款参考库
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            搜索 TikTok / Instagram / Facebook 爆款短视频，分析入库作为创作参考
          </p>
        </div>

        {/* Search Panel */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 mb-8">
          <div className="flex flex-col gap-4">
            {/* Keyword input + saved keywords */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="输入搜索关键词（如：毛毯宠物、blanket cozy、居家好物）"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  disabled={searching}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none disabled:opacity-50 transition-all"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={!keyword.trim() || searching}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-medium text-white transition-all hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {searching ? "搜索中..." : "一键搜索"}
              </button>
            </div>

            {/* Saved keywords */}
            {savedKeywords.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-zinc-600">历史：</span>
                {savedKeywords.slice(0, 8).map((kw) => (
                  <button
                    key={kw.id}
                    onClick={() => setKeyword(kw.keyword)}
                    className="rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                  >
                    {kw.keyword}
                  </button>
                ))}
              </div>
            )}

            {/* Platform toggles */}
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-zinc-500" />
              {(["tiktok", "instagram", "facebook"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    platforms.has(p)
                      ? PLATFORM_LABELS[p].color + " ring-1 ring-current/20"
                      : "bg-zinc-800/50 text-zinc-600"
                  }`}
                >
                  {PLATFORM_LABELS[p].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search Results */}
        {candidates.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-zinc-300">
                搜索结果（{candidates.length} 个）
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSelectAll}
                  className="text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  {selected.size === candidates.length ? "取消全选" : "全选"}
                </button>
                {selected.size > 0 && (
                  <button
                    onClick={handleBatchAnalyze}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600/80 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
                  >
                    {analyzing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    {analyzing
                      ? "分析中..."
                      : `入库分析 (${selected.size})`}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {candidates.map((c) => (
                <div
                  key={c.sourceUrl}
                  onClick={() => toggleSelect(c.sourceUrl)}
                  className={`group relative rounded-xl border p-3 cursor-pointer transition-all ${
                    selected.has(c.sourceUrl)
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex gap-3">
                    {c.thumbnailUrl && (
                      <img
                        src={c.thumbnailUrl}
                        alt=""
                        className="w-16 h-20 rounded-lg object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs text-white font-medium line-clamp-2">
                          {c.title || "无标题"}
                        </p>
                        {selected.has(c.sourceUrl) ? (
                          <CheckSquare className="h-4 w-4 text-amber-400 shrink-0" />
                        ) : (
                          <Square className="h-4 w-4 text-zinc-700 shrink-0" />
                        )}
                      </div>
                      {c.authorName && (
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          @{c.authorName}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                          <Eye className="h-3 w-3" />
                          {formatCount(c.viewCount)}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                          <Heart className="h-3 w-3" />
                          {formatCount(c.likeCount)}
                        </span>
                        {c.commentCount ? (
                          <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                            <MessageCircle className="h-3 w-3" />
                            {formatCount(c.commentCount)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-medium ${PLATFORM_LABELS[c.platform]?.color || "bg-zinc-800 text-zinc-400"}`}
                        >
                          {PLATFORM_LABELS[c.platform]?.label || c.platform}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Library Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">已入库参考</h2>
            <div className="flex gap-1.5">
              <button
                onClick={() => setLibraryFilter(null)}
                className={`rounded-lg px-3 py-1.5 text-xs transition-all ${
                  !libraryFilter
                    ? "bg-zinc-700 text-white"
                    : "bg-zinc-800/50 text-zinc-500 hover:text-white"
                }`}
              >
                全部
              </button>
              {(["tiktok", "instagram", "facebook"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() =>
                    setLibraryFilter(libraryFilter === p ? null : p)
                  }
                  className={`rounded-lg px-3 py-1.5 text-xs transition-all ${
                    libraryFilter === p
                      ? PLATFORM_LABELS[p].color + " ring-1 ring-current/20"
                      : "bg-zinc-800/50 text-zinc-500 hover:text-white"
                  }`}
                >
                  {PLATFORM_LABELS[p].label}
                </button>
              ))}
            </div>
          </div>

          {loadingLibrary ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            </div>
          ) : library.length === 0 ? (
            <div className="text-center py-16 text-zinc-600 text-sm">
              参考库为空，搜索爆款视频并入库分析吧
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {library.map((ref) => (
                <div
                  key={ref.id}
                  onClick={() => setDetailRef(ref)}
                  className="group rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden cursor-pointer hover:border-zinc-700 transition-all"
                >
                  {ref.thumbnailUrl && (
                    <div className="relative">
                      <img
                        src={ref.thumbnailUrl}
                        alt=""
                        className="w-full h-32 object-cover"
                      />
                      <span
                        className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[9px] font-medium backdrop-blur-sm ${PLATFORM_LABELS[ref.platform]?.color || "bg-zinc-800 text-zinc-400"}`}
                      >
                        {PLATFORM_LABELS[ref.platform]?.label || ref.platform}
                      </span>
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-xs text-white font-medium line-clamp-2 mb-1">
                      {ref.title || "无标题"}
                    </p>
                    {ref.authorName && (
                      <p className="text-[10px] text-zinc-500 mb-2">
                        @{ref.authorName}
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                        <Eye className="h-3 w-3" />
                        {formatCount(ref.viewCount)}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                        <Heart className="h-3 w-3" />
                        {formatCount(ref.likeCount)}
                      </span>
                    </div>
                    {ref.styleAnalysis && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] text-violet-400">
                          {(ref.styleAnalysis as Record<string, string>).emotionalTone?.slice(0, 12)}
                        </span>
                        {ref.visualAnalysis && (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-400">
                            {(ref.visualAnalysis as Record<string, string>).overallMood?.slice(0, 12)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {detailRef && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setDetailRef(null)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium mb-2 ${PLATFORM_LABELS[detailRef.platform]?.color || "bg-zinc-800 text-zinc-400"}`}
                >
                  {PLATFORM_LABELS[detailRef.platform]?.label || detailRef.platform}
                </span>
                <h3 className="text-sm font-semibold text-white">
                  {detailRef.title || "无标题"}
                </h3>
                {detailRef.authorName && (
                  <p className="text-xs text-zinc-500 mt-0.5">
                    @{detailRef.authorName}
                  </p>
                )}
              </div>
              <button
                onClick={() => setDetailRef(null)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {detailRef.thumbnailUrl && (
              <img
                src={detailRef.thumbnailUrl}
                alt=""
                className="w-full h-48 object-cover rounded-xl mb-4"
              />
            )}

            <div className="flex items-center gap-4 mb-4">
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <Eye className="h-3.5 w-3.5" /> {formatCount(detailRef.viewCount)}
              </span>
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <Heart className="h-3.5 w-3.5" /> {formatCount(detailRef.likeCount)}
              </span>
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <MessageCircle className="h-3.5 w-3.5" /> {formatCount(detailRef.commentCount)}
              </span>
              {detailRef.sourceUrl && (
                <a
                  href={detailRef.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-amber-400 hover:underline ml-auto"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> 原视频
                </a>
              )}
            </div>

            {detailRef.styleAnalysis && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-zinc-300 mb-2 uppercase tracking-wider">
                  风格分析
                </h4>
                <div className="space-y-2 text-xs text-zinc-400">
                  {Object.entries(detailRef.styleAnalysis as Record<string, string>).map(
                    ([key, val]) =>
                      typeof val === "string" && val && (
                        <div key={key}>
                          <span className="text-zinc-500">
                            {key === "narrativeStyle" ? "叙事手法" :
                             key === "emotionalTone" ? "情感基调" :
                             key === "hookStrategy" ? "开头策略" :
                             key === "contentStructure" ? "内容结构" :
                             key === "visualStyle" ? "画面风格" : key}：
                          </span>{" "}
                          {val}
                        </div>
                      )
                  )}
                </div>
              </div>
            )}

            {detailRef.visualAnalysis && (
              <div>
                <h4 className="text-xs font-semibold text-zinc-300 mb-2 uppercase tracking-wider">
                  视觉分析
                </h4>
                <div className="space-y-2 text-xs text-zinc-400">
                  {Object.entries(detailRef.visualAnalysis as Record<string, string>).map(
                    ([key, val]) =>
                      typeof val === "string" && val && (
                        <div key={key}>
                          <span className="text-zinc-500">
                            {key === "colorPalette" ? "色调" :
                             key === "lightingStyle" ? "光线" :
                             key === "sceneType" ? "场景" :
                             key === "overallMood" ? "氛围" :
                             key === "productPresentation" ? "产品展示" :
                             key === "suggestedVideoStyle" ? "推荐视频风格" : key}：
                          </span>{" "}
                          {val}
                        </div>
                      )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
