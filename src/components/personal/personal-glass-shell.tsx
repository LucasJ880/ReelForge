"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Bot,
  Clapperboard,
  Film,
  NotebookText,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Bot;
  /// 高亮匹配用的路径前缀；"__never__" 表示永不高亮（query 变体入口）
  match?: string;
}

const NAV: NavItem[] = [
  { href: "/personal/agent", label: "Agent", icon: Bot },
  { href: "/personal/create-video", label: "创作", icon: Clapperboard },
  { href: "/personal/videos", label: "成片库", icon: Film },
  { href: "/personal/templates", label: "提示词库", icon: NotebookText },
];

const PAGE_TITLES: Array<[string, string]> = [
  ["/personal/agent", "Agent 导演"],
  ["/personal/create-video", "创作"],
  ["/personal/videos", "成片库"],
  ["/personal/templates", "提示词库"],
  ["/personal/billing", "用量与账单"],
  ["/personal", "创作"],
];

function pageTitle(pathname: string): string {
  for (const [prefix, title] of PAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return title;
  }
  return "创作";
}

/**
 * 个人通道液态玻璃外壳（对齐同行）：
 * 左侧 64px 图标导航栏 + 顶栏（版本 / 今日余额 / 状态 / 退出）+ 内容区。
 */
export function PersonalGlassShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email?: string | null;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userEmail = email ?? session?.user?.email ?? "";

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* 左侧图标导航栏 */}
      <aside className="sticky top-0 flex h-screen w-[68px] shrink-0 flex-col items-center gap-1.5 border-r border-white/8 bg-black/35 py-3 backdrop-blur-xl">
        <Link
          href="/personal/agent"
          className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/40 bg-gradient-to-b from-sky-400/50 to-blue-600/50 shadow-[0_6px_18px_rgba(37,99,235,0.45)]"
          title="Aivora"
        >
          <Clapperboard className="h-5 w-5 text-white" />
        </Link>
        {NAV.map((item) => {
          const Icon = item.icon;
          const matchBase = item.match ?? item.href;
          const active =
            matchBase !== "__never__" &&
            (pathname === matchBase || pathname.startsWith(matchBase + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex w-[58px] flex-col items-center gap-1 rounded-xl px-1 py-2 text-center transition-colors",
                active
                  ? "border border-white/15 bg-white/12 text-white"
                  : "border border-transparent text-white/45 hover:bg-white/8 hover:text-white/85",
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="text-[10px] leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </aside>

      {/* 右侧：顶栏 + 内容 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-white/8 bg-black/30 px-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight text-white">
              {pageTitle(pathname)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="glass-chip">v1.0</span>
            <Link href="/personal/billing" className="glass-chip hover:bg-white/12">
              用量与账单
            </Link>
            <span className="glass-chip">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              就绪
            </span>
            <span className="glass-chip hidden sm:inline-flex" title={userEmail}>
              {userEmail.split("@")[0] || "trial"}
            </span>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="glass-chip cursor-pointer text-sky-300 hover:bg-white/12"
            >
              <LogOut className="h-3 w-3" />
              退出
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
