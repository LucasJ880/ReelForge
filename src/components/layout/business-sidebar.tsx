"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Home,
  Wand2,
  PackageOpen,
  Sparkles,
  Plug,
  TrendingUp,
  Lightbulb,
  LogOut,
  CreditCard,
  Menu,
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
import { useTranslation } from "@/i18n/useTranslation";
import { cn } from "@/lib/utils";

export function BusinessSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useTranslation();

  const nav = [
    { href: "/business", label: t("shell.businessNav.home"), icon: Home },
    {
      href: "/business/create-ad-video",
      label: t("shell.businessNav.createAd"),
      icon: Wand2,
    },
    {
      href: "/business/products",
      label: t("shell.businessNav.products"),
      icon: PackageOpen,
    },
    {
      href: "/business/creative-studio",
      label: t("shell.businessNav.creativeStudio"),
      icon: Sparkles,
    },
    {
      href: "/business/integrations",
      label: t("shell.businessNav.integrations"),
      icon: Plug,
    },
    {
      href: "/business/performance",
      label: t("shell.businessNav.performance"),
      icon: TrendingUp,
    },
    {
      href: "/business/recommendations",
      label: t("shell.businessNav.recommendations"),
      icon: Lightbulb,
    },
    {
      href: "/business/billing",
      label: t("shell.businessNav.billing"),
      icon: CreditCard,
    },
  ];
  const mobileNav = [nav[0], nav[1], nav[3], nav[6]];

  return (
    <>
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <Link
          href="/business"
          className="flex h-20 items-center gap-3 border-b border-border px-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora 商家工作台"
        >
          <Logo size={40} />
          <span className="min-w-0">
            <span className="block font-heading text-subhead">Aivora</span>
            <span className="block truncate text-meta text-muted-foreground">
              {t("shell.personaBusiness")}
            </span>
          </span>
        </Link>

        <nav
          aria-label="商家主导航"
          className="flex-1 space-y-1 overflow-y-auto px-3 py-5"
        >
          {nav.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/business" && pathname.startsWith(`${item.href}/`));
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
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-border p-4">
          <LanguageSwitcher variant="sidebar" />
          <p
            className="truncate px-3 text-meta text-muted-foreground"
            title={session?.user.email ?? ""}
          >
            {session?.user.email}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut strokeWidth={1.5} aria-hidden />
            {t("shell.signOut")}
          </Button>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <Link
          href="/business"
          className="flex min-w-0 items-center gap-3"
          aria-label="Aivora 商家工作台"
        >
          <Logo size={40} />
          <span className="truncate font-heading text-subhead">Aivora</span>
        </Link>
        <Dialog>
          <DialogTrigger
            render={<Button variant="ghost" size="icon" aria-label="打开全部导航" />}
          >
            <Menu strokeWidth={1.5} aria-hidden />
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>商家工作台</DialogTitle>
              <DialogDescription>切换功能、语言或退出当前账号。</DialogDescription>
            </DialogHeader>
            <nav aria-label="商家全部导航" className="grid gap-1">
              {nav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex h-10 items-center gap-3 rounded-(--radius-md) px-3 text-meta font-medium text-foreground hover:bg-muted"
                  >
                    <Icon strokeWidth={1.5} aria-hidden />
                    {item.label}
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
                {t("shell.signOut")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <nav
        aria-label="商家移动导航"
        className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-4 border-t border-border bg-card md:hidden"
      >
        {mobileNav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/business" && pathname.startsWith(`${item.href}/`));
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
              <span className="w-full truncate text-center">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
