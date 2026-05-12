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
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/types";
import { cn } from "@/lib/utils";

type Role = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER";

interface NavItem {
  href: string;
  labelKey?: TranslationKey;
  label?: string;
  icon: React.ComponentType<{ className?: string }>;
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
  { href: "/projects", label: "Projects (legacy)", icon: FolderKanban },
  { href: "/videos", label: "Videos (legacy)", icon: Film },
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

  return (
    <aside className="hidden md:flex flex-col w-60 border-r border-white/5 bg-sidebar shrink-0">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5">
        <Logo size={24} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Aivora</span>
          <span className="text-[10px] text-muted-foreground">Internal Ops</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {INTERNAL_NAV.filter((n) => !n.roles || n.roles.includes(role)).map(
          (item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label ?? (item.labelKey ? t(item.labelKey) : item.href)}
              </Link>
            );
          },
        )}

        <div className="pt-4">
          <button
            type="button"
            onClick={() => setLegacyOpen((open) => !open)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          >
            <span>Legacy</span>
            {legacyOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
          {legacyOpen && (
            <div className="mt-1 space-y-0.5">
              {LEGACY_NAV.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label ?? item.href}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="border-t border-white/5 px-3 py-3 space-y-1">
        <LanguageSwitcher variant="sidebar" />
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="truncate">{session?.user.email}</div>
          <div className="text-[10px] text-muted-foreground/60">{role}</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          {t("common.logout")}
        </button>
      </div>
    </aside>
  );
}
