"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  FolderKanban,
  Film,
  Send,
  BarChart3,
  Sparkles,
  UsersRound,
  Settings,
  LogOut,
  Activity,
  ClipboardCheck,
  Swords,
  Layers,
  ChevronDown,
  ChevronRight,
  Menu,
  Flag,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/types";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Role = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER";

interface NavItem {
  href: string;
  labelKey?: TranslationKey;
  label?: string;
  icon: LucideIcon;
  roles?: readonly Role[];
}

/**
 * InternalSidebar 是旧 AppSidebar 的 quarantined 版本：
 * - 路径前缀变成 /internal/*（Step 7 真正迁移后这些链接会指向新路径）
 * - 在 Phase 5 Step 5 阶段仍然指向旧路径（如 /orders）保证兼容
 */
const INTERNAL_NAV: NavItem[] = [
  { href: "/internal/orders", labelKey: "nav.creativeSets", icon: Layers },
  { href: "/internal/rounds", labelKey: "nav.creativeBriefs", icon: Swords },
  { href: "/internal/videos", labelKey: "nav.videos", icon: Film },
  { href: "/internal/publish", labelKey: "nav.publish", icon: Send },
  { href: "/internal/metrics", labelKey: "nav.metrics", icon: BarChart3 },
  { href: "/internal/qa", labelKey: "nav.qualityCheck", icon: ClipboardCheck },
  { href: "/internal/reports", labelKey: "nav.contentReports", icon: Flag, roles: ["SUPER_ADMIN", "OPERATOR"] },
  { href: "/internal/distillation", labelKey: "nav.distillation", icon: Sparkles },
  { href: "/internal/demo-leads", labelKey: "nav.demoLeads", icon: UsersRound },
  {
    href: "/internal/ai-usage",
    labelKey: "nav.aiUsage",
    icon: Activity,
    roles: ["SUPER_ADMIN", "OPERATOR"],
  },
  {
    href: "/internal/settings",
    labelKey: "nav.settings",
    icon: Settings,
    roles: ["SUPER_ADMIN"],
  },
];

const LEGACY_NAV: NavItem[] = [
  { href: "/projects", labelKey: "nav.legacyProjects", icon: FolderKanban },
  { href: "/videos", labelKey: "nav.legacyVideos", icon: Film },
];

export function InternalSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useI18n();
  const role: Role = (session?.user.role as Role) ?? "OPERATOR";
  const legacyActive = LEGACY_NAV.some(
    (item) =>
      pathname === item.href || pathname.startsWith(item.href + "/"),
  );
  const [legacyOpen, setLegacyOpen] = useState<boolean>(legacyActive);
  const visibleNav = INTERNAL_NAV.filter(
    (item) => !item.roles || item.roles.includes(role),
  );
  const mobileNav = visibleNav.slice(0, 4);

  return (
    <>
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <Link
          href="/internal"
          className="flex h-20 items-center gap-3 border-b border-border px-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora 内部工作台"
        >
          <Logo size={40} />
          <span className="min-w-0">
            <span className="block font-heading text-subhead">Aivora</span>
            <span className="block truncate text-meta text-muted-foreground">
              {t("nav.internalOps")}
            </span>
          </span>
        </Link>

        <nav
          aria-label="内部主导航"
          className="flex-1 space-y-1 overflow-y-auto px-3 py-5"
        >
          {visibleNav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-(--radius-md) px-3 text-meta font-medium transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                <span className="truncate">
                  {item.label ?? (item.labelKey ? t(item.labelKey) : item.href)}
                </span>
              </Link>
            );
          })}

          <div className="pt-4">
            <Button
            type="button"
            variant="ghost"
            onClick={() => setLegacyOpen((open) => !open)}
              className="w-full justify-between text-muted-foreground"
              aria-expanded={legacyOpen}
            >
              {t("nav.legacySection")}
              {legacyOpen ? (
                <ChevronDown strokeWidth={1.5} aria-hidden />
              ) : (
                <ChevronRight strokeWidth={1.5} aria-hidden />
              )}
            </Button>
            {legacyOpen ? (
              <div className="mt-1 space-y-1">
                {LEGACY_NAV.map((item) => {
                  const active =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-10 items-center gap-3 rounded-(--radius-md) px-3 text-meta font-medium",
                        active
                          ? "bg-sidebar-accent text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon strokeWidth={1.5} aria-hidden />
                      {item.label ?? (item.labelKey ? t(item.labelKey) : item.href)}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="space-y-2 border-t border-border p-4">
          <LanguageSwitcher variant="sidebar" />
          <div className="px-3 text-meta text-muted-foreground">
            <p className="truncate" title={session?.user.email ?? ""}>
              {session?.user.email}
            </p>
            <p>{role}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut strokeWidth={1.5} aria-hidden />
            {t("common.logout")}
          </Button>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <Link
          href="/internal"
          className="flex min-w-0 items-center gap-3"
          aria-label="Aivora 内部工作台"
        >
          <Logo size={40} />
          <span className="truncate font-heading text-subhead">{t("nav.internalOps")}</span>
        </Link>
        <Dialog>
          <DialogTrigger
            render={<Button variant="ghost" size="icon" aria-label="打开全部导航" />}
          >
            <Menu strokeWidth={1.5} aria-hidden />
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>内部工作台</DialogTitle>
              <DialogDescription>当前角色：{role}</DialogDescription>
            </DialogHeader>
            <nav aria-label="内部全部导航" className="grid gap-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex h-10 items-center gap-3 rounded-(--radius-md) px-3 text-meta font-medium text-foreground hover:bg-muted"
                  >
                    <Icon strokeWidth={1.5} aria-hidden />
                    {item.label ?? (item.labelKey ? t(item.labelKey) : item.href)}
                  </Link>
                );
              })}
            </nav>
            <div className="space-y-2 border-t border-border pt-4">
              <LanguageSwitcher variant="inline" />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut strokeWidth={1.5} aria-hidden />
                {t("common.logout")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <nav
        aria-label="内部移动导航"
        className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-4 border-t border-border bg-card md:hidden"
      >
        {mobileNav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-meta font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                active ? "bg-accent-soft text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" strokeWidth={1.5} aria-hidden />
              <span className="w-full truncate text-center">
                {item.label ?? (item.labelKey ? t(item.labelKey) : item.href)}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
