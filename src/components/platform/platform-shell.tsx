"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Clapperboard,
  ChevronsUpDown,
  Film,
  Layers3,
  LogOut,
  NotebookText,
  Search,
  Trophy,
  UserRound,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import {
  PLATFORM_PRIMARY_NAV,
  type PlatformNavId,
} from "@/lib/platform-routes";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

const ICONS = {
  create: Clapperboard,
  batches: Layers3,
  racing: Trophy,
  library: Film,
  templates: NotebookText,
} satisfies Record<PlatformNavId, typeof Clapperboard>;

function activePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function emailInitial(email: string): string {
  const local = email.split("@")[0]?.trim();
  return local ? local.slice(0, 1).toUpperCase() : "A";
}

function Nav({
  pathname,
  mobile = false,
  activeBatches,
  failedJobs,
}: {
  pathname: string;
  mobile?: boolean;
  activeBatches: number;
  failedJobs: number;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t(mobile ? "shell.platformShell.mobileNav" : "shell.platformShell.primaryNav")}
      className={mobile ? "grid h-16 grid-cols-5 border-t border-border bg-card" : "flex flex-1 flex-col gap-1 px-3 py-6"}
    >
      {PLATFORM_PRIMARY_NAV.map((item) => {
        const Icon = ICONS[item.id];
        const active = activePath(pathname, item.href);
        const count = item.id === "batches" ? activeBatches : item.id === "library" ? failedJobs : 0;
        const countLabel = t(item.id === "batches" ? "shell.platformShell.activeBatches" : "shell.platformShell.failedJobs");
        return (
          <Link
            key={item.id}
            href={item.href}
            // These protected destinations must not prefetch while NextAuth is
            // clearing the session during sign-out. A prefetch in that narrow
            // window follows the middleware redirect to /login and produces a
            // customer-visible navigation race before the intended redirect.
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              mobile
                ? "relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-meta font-medium"
                : "group flex h-10 items-center gap-3 rounded-(--radius-md) px-3 text-meta font-medium transition-colors",
              active
                ? "bg-accent-soft text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 stroke-[1.5]" aria-hidden />
            <span className={mobile ? "w-full truncate text-center" : "truncate"}>
              {t(`shell.platformNav.${item.id}`)}
            </span>
            {count > 0 ? (
              <span
                aria-label={`${countLabel} ${count}`}
                className={cn(
                  "font-mono tabular-nums",
                  mobile
                    ? "absolute ml-6 -mt-7 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground"
                    : "ml-auto min-w-6 rounded-full border border-border bg-secondary px-1.5 py-0.5 text-center text-meta text-foreground",
                  item.id === "library" && "text-danger",
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function PlatformShell({
  children,
  email,
  workspaceName,
  planId,
  activeBatches,
  failedJobs,
}: {
  children: React.ReactNode;
  email: string;
  workspaceName: string;
  planId: "starter" | "studio";
  activeBatches: number;
  failedJobs: number;
}) {
  const pathname = usePathname();
  const { t, locale } = useTranslation();
  const platformCopy = getPlatformCopy(locale).shell;
  return (
    <div className="studio-theme studio-canvas relative z-10 flex min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
        <Link
          href="/app/create"
          className="flex h-[72px] items-center gap-3 border-b border-border px-5"
          aria-label={platformCopy.home}
        >
          <Logo size={40} />
          <span className="min-w-0">
            <span className="block font-heading text-subhead font-semibold tracking-tight">Aivora</span>
            <span className="block truncate text-meta text-muted-foreground">
              {workspaceName}
            </span>
          </span>
        </Link>
        <Nav pathname={pathname} activeBatches={activeBatches} failedJobs={failedJobs} />
        <div className="mt-auto space-y-3 border-t border-border p-4">
          <div className="flex items-center justify-between gap-2 px-1 text-meta">
            <span className="text-muted-foreground">{t("shell.platformShell.currentPlan")}</span>
            <span className="rounded-full border border-border px-2 py-0.5 font-semibold uppercase">
              {planId}
            </span>
          </div>
          <LanguageSwitcher variant="sidebar" />
          <div className="flex gap-3 px-1 text-meta text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">{platformCopy.privacy}</Link>
            <Link href="/terms" className="hover:text-foreground">{platformCopy.terms}</Link>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut aria-hidden />
            {t("shell.signOut")}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:ml-60 md:pb-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
          <Link href="/app/create" className="flex shrink-0 items-center gap-3 md:hidden" aria-label={platformCopy.home}>
            <Logo size={32} />
            <span className="hidden font-heading text-subhead font-semibold sm:inline">Aivora</span>
          </Link>
          <button
            type="button"
            className="hidden h-9 max-w-56 items-center gap-2 rounded-(--radius-md) border border-border bg-secondary px-3 text-meta text-foreground md:flex"
            aria-label={`${t("shell.platformShell.switchWorkspace")}，${workspaceName}`}
            title={t("shell.platformShell.oneWorkspaceHint")}
          >
            <span className="truncate">{workspaceName}</span>
            <ChevronsUpDown className="ml-auto size-3 text-muted-foreground" aria-hidden />
          </button>
          <form action="/app/library" className="relative ml-auto min-w-0 w-full max-w-sm md:ml-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              name="q"
              aria-label={t("shell.platformShell.search")}
              placeholder={t("shell.platformShell.search")}
              className="h-9 w-full rounded-(--radius-sm) border border-border bg-secondary pl-9 pr-3 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </form>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-accent-soft font-mono text-meta font-semibold text-foreground"
            aria-label={`${t("shell.platformShell.accountSignOut")} ${email}`}
            title={email}
          >
            {email ? emailInitial(email) : <UserRound className="size-4" aria-hidden />}
          </button>
        </header>
        <main className="min-w-0 flex-1">
          <div className="studio-page editorial-page-enter">{children}</div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
        <Nav pathname={pathname} mobile activeBatches={activeBatches} failedJobs={failedJobs} />
      </div>
    </div>
  );
}
