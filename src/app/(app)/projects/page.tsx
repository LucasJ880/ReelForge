"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  FolderPlus,
  LayoutGrid,
  List,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Tag,
  X,
  Loader2,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { StatusBadge } from "@/components/project/status-badge";
import { DownloadButton } from "@/components/project/download-button";
import { BulkActionBar } from "@/components/projects/bulk-action-bar";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/lib/hooks/use-role";

function pickDownloadUrl(p: ProjectItem): string | null {
  return p.videoJob?.stitchedVideoUrl || p.videoJob?.videoUrl || null;
}

type ViewMode = "grid" | "list";

interface ProjectItem {
  id: string;
  keyword: string;
  category: string | null;
  status: string;
  createdAt: string;
  contentPlan: { id: string; caption: string; createdAt: string } | null;
  videoJob: {
    id: string;
    status: string;
    videoUrl: string | null;
    videoUrl2: string | null;
    stitchedVideoUrl: string | null;
    thumbnailUrl: string | null;
  } | null;
}

interface CategoryStat {
  name: string;
  count: number;
}

const SORT_OPTIONS = [
  { value: "newest", label: "最新创建" },
  { value: "oldest", label: "最早创建" },
  { value: "keyword", label: "按关键词" },
  { value: "status", label: "按状态" },
];

const PAGE_SIZE = 18;

export default function ProjectsPage() {
  const isAdmin = useIsAdmin();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectAllInPage() {
    setSelectedIds(new Set(projects.map((p) => p.id)));
  }

  const allSelected =
    projects.length > 0 && projects.every((p) => selectedIds.has(p.id));

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      params.set("sort", sort);
      if (search) params.set("search", search);
      if (activeCategory) params.set("category", activeCategory);

      const res = await fetch(`/api/projects?${params}`);
      const data = await res.json();
      setProjects(data.projects || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setCategories(data.categories || []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [page, sort, search, activeCategory]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  function selectCategory(cat: string | null) {
    setActiveCategory(cat);
    setPage(1);
  }

  const totalAll = categories.reduce((s, c) => s + c.count, 0);
  const uncategorized = total - totalAll;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-500 font-medium mb-1">
            作品库
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            全部项目
            <span className="text-sm font-normal text-zinc-500 ml-2">{total}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => (allSelected ? clearSelection() : selectAllInPage())}
              disabled={projects.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {allSelected ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  取消全选
                </>
              ) : (
                <>
                  <Circle className="h-3.5 w-3.5" />
                  全选当前页
                </>
              )}
            </button>
          )}
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            新建
          </Link>
        </div>
      </div>

      {/* Toolbar: Search + Sort + View toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索关键词、分类、标题..."
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] pl-9 pr-8 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/40 focus:ring-1 focus:ring-teal-500/20 transition-colors"
          />
          {searchInput && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        <div className="flex items-center gap-2">
          {/* Sort */}
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="appearance-none rounded-lg border border-white/[0.06] bg-white/[0.02] pl-8 pr-6 py-2 text-xs text-zinc-300 focus:outline-none focus:border-teal-500/40 cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-zinc-900 text-zinc-300">
                  {o.label}
                </option>
              ))}
            </select>
            <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500 pointer-events-none" />
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg border border-white/[0.06] overflow-hidden">
            <button
              onClick={() => setView("grid")}
              className={cn(
                "p-2 transition-colors",
                view === "grid"
                  ? "bg-teal-500/15 text-teal-400"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "p-2 transition-colors",
                view === "list"
                  ? "bg-teal-500/15 text-teal-400"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]"
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => selectCategory(null)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
              !activeCategory
                ? "bg-teal-500/15 text-teal-400 border border-teal-500/20"
                : "bg-white/[0.02] text-zinc-500 border border-white/[0.04] hover:text-zinc-300 hover:border-white/[0.08]"
            )}
          >
            全部
            <span className="text-[10px] opacity-60">{total}</span>
          </button>
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => selectCategory(activeCategory === cat.name ? null : cat.name)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
                activeCategory === cat.name
                  ? "bg-teal-500/15 text-teal-400 border border-teal-500/20"
                  : "bg-white/[0.02] text-zinc-500 border border-white/[0.04] hover:text-zinc-300 hover:border-white/[0.08]"
              )}
            >
              <Tag className="h-2.5 w-2.5" />
              {cat.name}
              <span className="text-[10px] opacity-60">{cat.count}</span>
            </button>
          ))}
          {uncategorized > 0 && (
            <button
              onClick={() => selectCategory(activeCategory === "__none" ? null : "__none")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
                activeCategory === "__none"
                  ? "bg-teal-500/15 text-teal-400 border border-teal-500/20"
                  : "bg-white/[0.02] text-zinc-500 border border-white/[0.04] hover:text-zinc-300 hover:border-white/[0.08]"
              )}
            >
              未分类
              <span className="text-[10px] opacity-60">{uncategorized}</span>
            </button>
          )}
        </div>
      )}

      {/* Active filters summary */}
      {(search || activeCategory) && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>筛选中：</span>
          {search && (
            <span className="inline-flex items-center gap-1 bg-white/[0.04] rounded-md px-2 py-0.5">
              「{search}」
              <button onClick={clearSearch} className="text-zinc-400 hover:text-white">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {activeCategory && activeCategory !== "__none" && (
            <span className="inline-flex items-center gap-1 bg-white/[0.04] rounded-md px-2 py-0.5">
              {activeCategory}
              <button onClick={() => selectCategory(null)} className="text-zinc-400 hover:text-white">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState search={search} category={activeCategory} />
      ) : view === "grid" ? (
        <GridView
          projects={projects}
          selectedIds={selectedIds}
          onToggle={toggleSelect}
          selectable={isAdmin}
        />
      ) : (
        <ListView
          projects={projects}
          selectedIds={selectedIds}
          onToggle={toggleSelect}
          allSelected={allSelected}
          onToggleAll={() => (allSelected ? clearSelection() : selectAllInPage())}
          selectable={isAdmin}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-zinc-600">
            第 {page} / {totalPages} 页 · 共 {total} 个项目
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = totalPages <= 5
                ? i + 1
                : page <= 3
                  ? i + 1
                  : page >= totalPages - 2
                    ? totalPages - 4 + i
                    : page - 2 + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={cn(
                    "h-7 w-7 rounded-lg text-xs font-medium transition-colors",
                    page === pageNum
                      ? "bg-teal-500/15 text-teal-400"
                      : "text-zinc-500 hover:text-white hover:bg-white/[0.04]"
                  )}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isAdmin && (
        <BulkActionBar
          selectedIds={Array.from(selectedIds)}
          onClear={clearSelection}
          onDeleted={() => {
            fetchProjects();
          }}
        />
      )}
    </div>
  );
}

function GridView({
  projects,
  selectedIds,
  onToggle,
  selectable,
}: {
  projects: ProjectItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  selectable: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => {
        const downloadUrl = pickDownloadUrl(p);
        const checked = selectedIds.has(p.id);
        return (
          <div key={p.id} className="relative group">
            <Link href={`/projects/${p.id}`}>
              <div
                className={cn(
                  "rounded-xl border bg-white/[0.02] p-4 pl-11 transition-all h-full",
                  checked
                    ? "border-primary/40 bg-primary/[0.04]"
                    : "border-white/[0.05] hover:border-white/[0.1] hover:bg-white/[0.03]",
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-medium text-white truncate">{p.keyword}</h3>
                  <StatusBadge status={p.status} />
                </div>

                <p className="text-xs text-zinc-500 truncate mb-3">
                  {p.contentPlan?.caption || "尚未生成内容"}
                </p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.category && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500">
                        <Tag className="h-2 w-2" />
                        {p.category}
                      </span>
                    )}
                    <span className="text-[11px] text-zinc-600">{formatDate(p.createdAt)}</span>
                  </div>
                </div>
              </div>
            </Link>
            {selectable && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(p.id);
                }}
                aria-label={checked ? "取消选择" : "选择"}
                className={cn(
                  "absolute left-3 top-3 flex h-5 w-5 items-center justify-center rounded-md border transition-all",
                  checked
                    ? "border-primary bg-primary text-primary-foreground opacity-100"
                    : "border-border bg-card/60 text-transparent opacity-0 group-hover:opacity-100",
                )}
              >
                {checked && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M3 8l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            )}
            {downloadUrl && (
              <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <DownloadButton
                  url={downloadUrl}
                  filename={`${p.keyword.replace(/[^\w\u4e00-\u9fa5]/g, "_")}.mp4`}
                  size="sm"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  projects,
  selectedIds,
  onToggle,
  allSelected,
  onToggleAll,
  selectable,
}: {
  projects: ProjectItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  allSelected: boolean;
  onToggleAll: () => void;
  selectable: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.05] overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-12 gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-600 border-b border-white/[0.04] bg-white/[0.01]">
        <div className="col-span-1 flex items-center">
          {selectable && (
            <button
              type="button"
              onClick={onToggleAll}
              aria-label={allSelected ? "取消全选" : "全选"}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-sm border transition-all",
                allSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card/60 text-transparent hover:border-primary/60",
              )}
            >
              {allSelected && (
                <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path d="M3 8l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
        </div>
        <div className="col-span-4">关键词</div>
        <div className="col-span-2">分类</div>
        <div className="col-span-2">状态</div>
        <div className="col-span-2">创建时间</div>
        <div className="col-span-1" />
      </div>

      {/* Rows */}
      {projects.map((p) => {
        const downloadUrl = pickDownloadUrl(p);
        const checked = selectedIds.has(p.id);
        return (
          <div key={p.id} className={cn("relative group", checked && "bg-primary/[0.04]")}>
            <Link href={`/projects/${p.id}`}>
              <div className="grid grid-cols-12 gap-3 px-4 py-3 items-center border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                <div className="col-span-1" />
                <div className="col-span-4">
                  <p className="text-sm text-white truncate">{p.keyword}</p>
                  <p className="text-[11px] text-zinc-600 truncate mt-0.5">
                    {p.contentPlan?.caption || "—"}
                  </p>
                </div>
                <div className="col-span-2">
                  {p.category ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-500">
                      <Tag className="h-2.5 w-2.5" />
                      {p.category}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-700">—</span>
                  )}
                </div>
                <div className="col-span-2">
                  <StatusBadge status={p.status} />
                </div>
                <div className="col-span-2">
                  <span className="text-[11px] text-zinc-500">{formatDate(p.createdAt)}</span>
                </div>
                <div className="col-span-1" />
              </div>
            </Link>
            {selectable && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(p.id);
                }}
                aria-label={checked ? "取消选择" : "选择"}
                className={cn(
                  "absolute left-4 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-sm border transition-all",
                  checked
                    ? "border-primary bg-primary text-primary-foreground opacity-100"
                    : "border-border bg-card/60 text-transparent opacity-0 group-hover:opacity-100 hover:border-primary/60",
                )}
              >
                {checked && (
                  <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path d="M3 8l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            )}
            {downloadUrl && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <DownloadButton
                  url={downloadUrl}
                  filename={`${p.keyword.replace(/[^\w\u4e00-\u9fa5]/g, "_")}.mp4`}
                  size="sm"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ search, category }: { search: string; category: string | null }) {
  if (search || category) {
    return (
      <div className="text-center py-16">
        <Search className="h-6 w-6 text-zinc-600 mx-auto mb-3" />
        <p className="text-sm text-zinc-500">
          没有找到匹配的项目
        </p>
        <p className="text-xs text-zinc-600 mt-1">
          试试调整搜索条件或清除筛选
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-20">
      <p className="text-zinc-400 text-sm mb-6">还没有作品</p>
      <Link
        href="/projects/new"
        className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-700"
      >
        开始创作
      </Link>
    </div>
  );
}
