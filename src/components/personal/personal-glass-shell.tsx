"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Bot,
  Clapperboard,
  Film,
  Layers3,
  LogOut,
  NotebookText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Bot;
  match?: string;
}

const NAV: NavItem[] = [
  { href: "/personal/agent", label: "Agent", icon: Bot },
  { href: "/personal/create-video", label: "创作", icon: Clapperboard },
  { href: "/batch-create", label: "批量", icon: Layers3, match: "/batch" },
  { href: "/personal/videos", label: "成片库", icon: Film },
  { href: "/personal/templates", label: "模板", icon: NotebookText },
];

const PAGE_TITLES: Array<[string, string]> = [
  ["/personal/agent", "Agent 导演"],
  ["/personal/create-video", "创作"],
  ["/personal/videos", "成片库"],
  ["/personal/templates", "提示词库"],
  ["/personal/billing", "用量与账单"],
  ["/batch-create", "批量生产"],
  ["/batches", "批次监控"],
  ["/design", "设计系统"],
  ["/personal", "创作"],
];

function pageTitle(pathname: string): string {
  for (const [prefix, title] of PAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return "创作";
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === "/batch") {
    return pathname === "/batch-create" || pathname.startsWith("/batches/");
  }
  const base = item.match ?? item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

function Navigation({
  pathname,
  mobile = false,
}: {
  pathname: string;
  mobile?: boolean;
}) {
  return (
    <nav
      aria-label={mobile ? "个人移动导航" : "个人主导航"}
      className={cn(
        mobile
          ? "grid h-16 grid-cols-5 border-t border-border bg-card"
          : "flex flex-1 flex-col gap-1 px-3 py-5",
      )}
    >
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center text-meta font-medium transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
              mobile
                ? "min-w-0 flex-col justify-center gap-1 overflow-hidden px-1"
                : "h-10 gap-3 rounded-(--radius-md) px-3",
              active
                ? "bg-accent-soft text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 stroke-[1.5]" aria-hidden />
            <span className={cn(mobile && "w-full truncate text-center")}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function PersonalEditorialShell({
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
    <div className="relative z-10 flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
        <Link
          href="/personal/agent"
          className="flex h-20 items-center gap-3 border-b border-border px-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora 首页"
        >
          <Logo size={40} />
          <span>
            <span className="block font-heading text-subhead">Aivora</span>
            <span className="block text-meta text-muted-foreground">
              Editorial Studio
            </span>
          </span>
        </Link>
        <Navigation pathname={pathname} />
        <div className="space-y-3 border-t border-border p-4">
          <LanguageSwitcher variant="sidebar" />
          <p className="truncate text-meta text-muted-foreground" title={userEmail}>
            {userEmail || "个人创作者"}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut aria-hidden />
            退出登录
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/personal/agent"
              className="md:hidden"
              aria-label="Aivora 首页"
            >
              <Logo size={40} />
            </Link>
            <p className="truncate font-heading text-subhead">
              {pageTitle(pathname)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="success">服务就绪</Badge>
            <Link
              href="/personal/billing"
              className="hidden text-meta font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline"
            >
              用量与账单
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="editorial-page">{children}</div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
        <Navigation pathname={pathname} mobile />
      </div>
    </div>
  );
}

/** @deprecated 使用 PersonalEditorialShell；保留旧导出避免调用方断裂。 */
export const PersonalGlassShell = PersonalEditorialShell;
