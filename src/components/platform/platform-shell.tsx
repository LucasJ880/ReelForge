"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  CalendarRange,
  ChevronsUpDown,
  CircleHelp,
  Clapperboard,
  Film,
  Layers3,
  LogOut,
  MonitorPlay,
  NotebookText,
  Palette,
  Search,
  Trophy,
  UserRound,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { useNow } from "@/components/exchange/use-now";
import { ExchangeTape, batchTapeItems, type TapeEntry } from "@/components/exchange/exchange-tape";
import { OpsCreditsCluster } from "@/components/platform/ops-credits-cluster";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import {
  PLATFORM_PRIMARY_NAV,
  type PlatformNavId,
} from "@/lib/platform-routes";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

const ICONS = {
  plan: CalendarRange,
  create: Clapperboard,
  batches: Layers3,
  wins: Trophy,
  library: Film,
  brands: Palette,
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
  const { t, locale } = useTranslation();
  const shell = getPlatformCopy(locale).shell;
  return (
    <nav
      aria-label={t(mobile ? "shell.platformShell.mobileNav" : "shell.platformShell.primaryNav")}
      className={mobile ? "x-pane grid h-16 auto-cols-fr grid-flow-col border-t" : "flex flex-col py-3"}
    >
      {PLATFORM_PRIMARY_NAV.map((item, index) => {
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
            aria-keyshortcuts={mobile ? undefined : String(index + 1)}
            title={mobile ? undefined : shell.navShortcut.replace("{key}", String(index + 1))}
            className={cn(
              mobile
                ? "relative flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-micro font-medium"
                : "group relative flex h-10 items-center gap-3 border-l-2 px-4 text-meta font-medium transition-colors",
              mobile
                ? active
                  ? "text-accent"
                  : "text-muted-foreground"
                : active
                  ? "border-accent bg-active text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-raised hover:text-foreground",
            )}
          >
            {mobile ? null : (
              <kbd
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-(--radius-sm) border font-mono text-micro tabular-nums",
                  active ? "border-accent-line text-accent" : "border-border text-tertiary group-hover:text-muted-foreground",
                )}
              >
                {index + 1}
              </kbd>
            )}
            <span className="relative flex shrink-0">
              <Icon className={cn("size-4 stroke-[1.5]", active && "text-accent")} aria-hidden />
              {mobile && count > 0 ? (
                <span
                  aria-label={`${countLabel} ${count}`}
                  className={cn(
                    "absolute -right-2.5 -top-1.5 min-w-4 rounded-(--radius-sm) px-1 text-center font-mono text-micro leading-4 tabular-nums ring-2 ring-(--bg)",
                    item.id === "library" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent",
                  )}
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </span>
            <span className={mobile ? "w-full truncate text-center" : "truncate"}>
              {mobile ? shell.navShort[item.id] : t(`shell.platformNav.${item.id}`)}
            </span>
            {!mobile && count > 0 ? (
              <span
                aria-label={`${countLabel} ${count}`}
                className={cn(
                  "ml-auto min-w-6 rounded-(--radius-sm) px-1.5 py-0.5 text-center font-mono text-data leading-4 tabular-nums",
                  item.id === "library" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent",
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

function Tape({ entries, locale }: { entries: TapeEntry[]; locale: string }) {
  const copy = getPlatformCopy(locale === "en-US" ? "en-US" : "zh-CN").shell;
  if (entries.length === 0) {
    return (
      <div className="flex h-8 min-w-0 items-center gap-3 px-4 text-meta text-muted-foreground">
        <span className="x-live" data-tone="idle" aria-hidden />
        <span className="truncate">{copy.tapeEmpty}</span>
        <Link href="/app/batches/new" prefetch={false} className="ml-auto shrink-0 font-mono text-data uppercase tracking-wider text-accent hover:text-accent-strong">
          {copy.tapeEmptyAction} →
        </Link>
      </div>
    );
  }
  return <ExchangeTape items={batchTapeItems(entries, locale)} locale={locale} label={copy.tape} className="h-8" />;
}

function Clock({ label }: { label: string }) {
  const now = useNow();
  return (
    <span className="font-mono tabular-nums text-foreground" aria-label={label}>
      {now
        ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)
        : "--:--:--"}
    </span>
  );
}

export function PlatformShell({
  children,
  email,
  workspaceName,
  planId,
  monthlyVideoLimit,
  activeBatches,
  failedJobs,
  tape,
  showOpsCredits = false,
}: {
  children: React.ReactNode;
  email: string;
  workspaceName: string;
  planId: "starter" | "studio";
  monthlyVideoLimit: number;
  activeBatches: number;
  failedJobs: number;
  tape: TapeEntry[];
  showOpsCredits?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale } = useTranslation();
  const copy = getPlatformCopy(locale).shell;
  const live = activeBatches > 0;

  // 导轨编号即快捷键：焦点不在输入框、没有打开的对话框时，按 1–7 直达对应页面。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const item = PLATFORM_PRIMARY_NAV[index];
      if (!item) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']")) return;
      if (document.querySelector("[aria-modal='true'], [role='dialog'][data-open]")) return;
      event.preventDefault();
      router.push(item.href);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);
  return (
    <div className="desk-theme desk-canvas relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="x-pane sticky top-0 z-30 border-b">
        <div className="flex h-12 items-center gap-3 border-b px-3 md:px-4">
          <Link href="/app/create" prefetch={false} className="flex shrink-0 items-center gap-2.5" aria-label={copy.home}>
            <Logo size={30} />
            <span className="hidden font-heading text-[15px] font-semibold tracking-[0.14em] sm:inline">AIVORA</span>
          </Link>
          <span className="hidden h-5 w-px bg-border md:block" aria-hidden />
          <button
            type="button"
            className="hidden h-8 max-w-64 items-center gap-2 rounded-(--radius-md) border border-border bg-raised px-2.5 text-meta text-foreground md:flex"
            aria-label={`${t("shell.platformShell.switchWorkspace")}，${workspaceName}`}
            title={t("shell.platformShell.oneWorkspaceHint")}
          >
            <span className="rounded-(--radius-sm) bg-accent-soft px-1.5 font-mono text-micro uppercase leading-4 text-accent">{planId}</span>
            <span className="truncate">{workspaceName}</span>
            <ChevronsUpDown className="ml-auto size-3 text-muted-foreground" aria-hidden />
          </button>
          <div className="shrink-0 md:hidden" data-mobile-language-switcher>
            <LanguageSwitcher variant="inline" className="size-9 justify-center gap-0 p-0 [&>span]:sr-only" />
          </div>
          <form action="/app/library" className="relative ml-auto min-w-0 w-full max-w-sm md:ml-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              name="q"
              aria-label={t("shell.platformShell.search")}
              placeholder={t("shell.platformShell.search")}
              className="h-8 w-full rounded-(--radius-md) border border-border bg-sunken pl-9 pr-3 text-body text-foreground outline-none placeholder:text-tertiary focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </form>
          <div className="hidden items-center gap-2 rounded-(--radius-md) border border-border px-2.5 py-1 lg:flex" role="status">
            <span className="x-live" data-tone={live ? "live" : "idle"} aria-hidden />
            <span className={cn("font-mono text-data uppercase tracking-wider", live ? "text-accent" : "text-muted-foreground")}>
              {live ? copy.marketLive : copy.marketIdle}
            </span>
            {live ? <span className="font-mono text-data tabular-nums text-foreground">{activeBatches}</span> : null}
          </div>
          <Link
            href="/wall"
            target="_blank"
            rel="noopener"
            prefetch={false}
            title={copy.openWallHint}
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-(--radius-md) border border-border px-2.5 text-meta text-muted-foreground hover:border-accent-line hover:text-accent md:flex"
          >
            <MonitorPlay className="size-4" aria-hidden />
            {copy.openWall}
          </Link>
          {showOpsCredits ? <OpsCreditsCluster english={locale === "en-US"} /> : null}
          <Link
            href="/app/create?guide=open"
            prefetch={false}
            data-testid="topbar-help"
            aria-label={locale === "en-US" ? "Open the getting-started guide" : "打开新手指引"}
            className="flex size-8 shrink-0 items-center justify-center rounded-(--radius-md) border border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
          >
            <CircleHelp className="size-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex size-8 shrink-0 items-center justify-center rounded-(--radius-md) border border-border-bright bg-active font-mono text-meta font-semibold text-accent"
            aria-label={`${t("shell.platformShell.accountSignOut")} ${email}`}
            title={email}
          >
            {email ? emailInitial(email) : <UserRound className="size-4" aria-hidden />}
          </button>
        </div>
        <Tape entries={tape} locale={locale} />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="x-pane fixed bottom-7 left-0 top-20 z-20 hidden w-56 flex-col border-r md:flex">
          <Nav pathname={pathname} activeBatches={activeBatches} failedJobs={failedJobs} />
          <div className="mt-auto space-y-3 border-t p-4">
            <div className="space-y-1.5">
              <span className="x-label">{copy.equity}</span>
              <div className="flex items-baseline justify-between gap-2 text-meta">
                <span className="text-muted-foreground">{copy.monthlyVideos}</span>
                <span className="font-mono tabular-nums text-foreground">{monthlyVideoLimit}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2 text-meta">
                <span className="text-muted-foreground">{t("shell.platformShell.currentPlan")}</span>
                <span className="font-mono uppercase text-accent">{planId}</span>
              </div>
            </div>
            <LanguageSwitcher variant="sidebar" />
            <div className="flex gap-3 text-meta text-muted-foreground">
              <Link href="/privacy" className="hover:text-foreground">{copy.privacy}</Link>
              <Link href="/terms" className="hover:text-foreground">{copy.terms}</Link>
            </div>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-(--radius-md) px-2 text-meta text-muted-foreground hover:bg-raised hover:text-foreground"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="size-4" aria-hidden />
              {t("shell.signOut")}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-16 md:ml-56 md:pb-7">
          <div className="x-page x-enter min-h-full">{children}</div>
        </main>
      </div>

      <footer className="x-pane fixed inset-x-0 bottom-0 z-30 hidden h-7 items-center gap-4 border-t px-4 text-data text-muted-foreground md:flex">
        <span className="flex items-center gap-2">
          <span className="x-live" data-tone={live ? "live" : "idle"} aria-hidden />
          <span>{copy.statusSource}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-tertiary">{copy.statusClock}</span>
          <Clock label={copy.statusClock} />
        </span>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
        <Nav pathname={pathname} mobile activeBatches={activeBatches} failedJobs={failedJobs} />
      </div>
    </div>
  );
}
