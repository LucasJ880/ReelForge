"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Home,
  Sparkles,
  Film,
  Layers3,
  BookOpen,
  CreditCard,
  LogOut,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/useTranslation";
import { cn } from "@/lib/utils";

export function PersonalSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useTranslation();

  const nav = [
    { href: "/personal", label: t("shell.personalNav.home"), icon: Home },
    {
      href: "/personal/create-video",
      label: t("shell.personalNav.createVideo"),
      icon: Sparkles,
    },
    {
      href: "/personal/videos",
      label: t("shell.personalNav.myVideos"),
      icon: Film,
    },
    {
      href: "/batch-create",
      label: "批量生产",
      icon: Layers3,
    },
    {
      href: "/personal/templates",
      label: t("shell.personalNav.templates"),
      icon: BookOpen,
      badge: t("shell.badgeSoon"),
    },
    {
      href: "/personal/billing",
      label: t("shell.personalNav.billing"),
      icon: CreditCard,
    },
  ];

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-20 items-center gap-3 border-b border-border px-5">
        <Logo size={40} />
        <div className="min-w-0">
          <span className="block font-heading text-subhead">Aivora</span>
          <span className="block truncate text-meta text-muted-foreground">
            {t("shell.personaPersonal")}
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/personal" && pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center justify-between gap-3 rounded-(--radius-md) px-3 text-meta font-medium transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                active
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge && (
                <Badge variant="secondary">
                  {item.badge}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-border p-4">
        <LanguageSwitcher variant="sidebar" />
        <div className="px-3 text-meta text-muted-foreground">
          <div className="truncate" title={session?.user.email ?? ""}>
            {session?.user.email}
          </div>
          <div>
            {t("shell.personaPersonal")}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full justify-start"
        >
          <LogOut strokeWidth={1.5} aria-hidden />
          {t("shell.signOut")}
        </Button>
      </div>
    </aside>
  );
}
