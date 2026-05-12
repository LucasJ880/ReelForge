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
  Wand2,
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
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  roles?: readonly Role[];
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/projects", labelKey: "nav.projects", icon: FolderKanban },
  { href: "/videos", labelKey: "nav.videos", icon: Film },
  { href: "/publish", labelKey: "nav.publish", icon: Send },
  { href: "/metrics", labelKey: "nav.metrics", icon: BarChart3 },
];

const ADVANCED_NAV: NavItem[] = [
  {
    href: "/wizard",
    labelKey: "nav.classicWizard",
    icon: Wand2,
    roles: ["SUPER_ADMIN", "OPERATOR"],
  },
  { href: "/orders", labelKey: "nav.creativeSets", icon: Layers },
  { href: "/rounds", labelKey: "nav.creativeBriefs", icon: Swords },
  { href: "/qa", labelKey: "nav.qualityCheck", icon: ClipboardCheck },
  { href: "/distillation", labelKey: "nav.distillation", icon: Sparkles },
  { href: "/demo-leads", labelKey: "nav.demoLeads", icon: UsersRound },
  {
    href: "/admin/ai-usage",
    labelKey: "nav.aiUsage",
    icon: Activity,
    roles: ["SUPER_ADMIN", "OPERATOR"],
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    icon: Settings,
    roles: ["SUPER_ADMIN"],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useI18n();
  const role: Role = (session?.user.role as Role) ?? "OPERATOR";
  const isAdvancedActive = ADVANCED_NAV.some(
    (item) =>
      pathname === item.href || pathname.startsWith(item.href + "/"),
  );
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(isAdvancedActive);

  return (
    <aside className="hidden md:flex flex-col w-60 border-r border-white/5 bg-sidebar shrink-0">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5">
        <Logo size={24} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">
            {t("common.appName")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("common.appTagline")}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {PRIMARY_NAV.filter((n) => !n.roles || n.roles.includes(role)).map(
          (item) => (
            <NavLink
              key={item.href}
              item={item}
              active={
                pathname === item.href || pathname.startsWith(item.href + "/")
              }
              label={t(item.labelKey)}
            />
          ),
        )}

        <div className="pt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className={cn(
              "flex w-full items-center justify-between px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/60 hover:text-foreground/80 transition-colors",
            )}
          >
            <span>{t("nav.advancedSection")}</span>
            {advancedOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
          {advancedOpen && (
            <div className="mt-1 space-y-0.5">
              {ADVANCED_NAV.filter((n) => !n.roles || n.roles.includes(role)).map(
                (item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={
                      pathname === item.href ||
                      pathname.startsWith(item.href + "/")
                    }
                    label={t(item.labelKey)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </nav>

      <div className="border-t border-white/5 px-3 py-3 space-y-1">
        <LanguageSwitcher variant="sidebar" />
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="truncate">{session?.user.email}</div>
          <div className="text-[10px] text-muted-foreground/60">
            {roleLabel(role, t)}
          </div>
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

function NavLink({
  item,
  active,
  label,
}: {
  item: NavItem;
  active: boolean;
  label: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function roleLabel(role: Role, t: (key: TranslationKey) => string) {
  switch (role) {
    case "SUPER_ADMIN":
      return t("role.superAdmin");
    case "OPERATOR":
      return t("role.operator");
    case "REVIEWER":
      return t("role.reviewer");
    default:
      return role;
  }
}
