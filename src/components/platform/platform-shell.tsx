"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  CalendarRange,
  Check,
  CircleHelp,
  Clapperboard,
  Film,
  Inbox,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/components/exchange/use-now";
import { usePulse } from "@/components/exchange/use-pulse";
import { ExchangeTape, batchTapeItems, type TapeEntry } from "@/components/exchange/exchange-tape";
import { OpsCreditsCluster } from "@/components/platform/ops-credits-cluster";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import type { ExchangePulse } from "@/lib/exchange/pulse";
import { readingName } from "@/lib/exchange/readings-registry";
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
  leads: Inbox,
} satisfies Record<PlatformNavId, typeof Clapperboard>;

/** 导轨徽标：批量 = 进行中批次（青）；成品库 = 需要处理（玫红，与成品库「需要处理」区同一批）；询盘 = 新询盘（金）。 */
type NavBadge = { count: number; tone: "live" | "fault" | "winner"; label: string };

const BADGE_TONE: Record<NavBadge["tone"], string> = {
  live: "bg-accent-soft text-accent",
  fault: "bg-danger-soft text-danger",
  winner: "bg-gold-soft text-gold",
};

function navBadges(pulse: ExchangePulse, locale: Locale, newLeadsLabel: string): Partial<Record<PlatformNavId, NavBadge>> {
  return {
    batches: { count: pulse.activeBatches, tone: "live", label: readingName("activeBatches", locale) },
    library: { count: pulse.needsAttention, tone: "fault", label: readingName("needsAttention", locale) },
    leads: { count: pulse.newLeads, tone: "winner", label: newLeadsLabel },
  };
}

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
  badges,
}: {
  pathname: string;
  mobile?: boolean;
  badges: Partial<Record<PlatformNavId, NavBadge>>;
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
        const badge = badges[item.id];
        const count = badge?.count ?? 0;
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
                : "group relative flex h-10 shrink-0 items-center gap-3 border-l-2 px-4 text-meta font-medium transition-colors",
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
              {mobile && badge && count > 0 ? (
                <span
                  aria-label={`${badge.label} ${count}`}
                  className={cn(
                    "absolute -right-2.5 -top-1.5 min-w-4 rounded-(--radius-sm) px-1 text-center font-mono text-micro leading-4 tabular-nums ring-2 ring-(--bg)",
                    BADGE_TONE[badge.tone],
                  )}
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </span>
            <span className={mobile ? "w-full truncate text-center" : "truncate"}>
              {mobile ? shell.navShort[item.id] : t(`shell.platformNav.${item.id}`)}
            </span>
            {!mobile && badge && count > 0 ? (
              <span
                aria-label={`${badge.label} ${count}`}
                className={cn(
                  "ml-auto min-w-6 rounded-(--radius-sm) px-1.5 py-0.5 text-center font-mono text-data leading-4 tabular-nums",
                  BADGE_TONE[badge.tone],
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

function Tape({ entries, locale }: { entries: TapeEntry[]; locale: Locale }) {
  const copy = getPlatformCopy(locale).shell;
  if (entries.length === 0) {
    return (
      <div className="flex h-(--shell-tape) min-w-0 items-center gap-3 px-4 text-meta text-muted-foreground">
        <span className="x-live" data-tone="idle" aria-hidden />
        <span className="truncate">{copy.tapeEmpty}</span>
        <Link href="/app/batches/new" prefetch={false} className="ml-auto shrink-0 font-mono text-data uppercase tracking-wider text-accent hover:text-accent-strong">
          {copy.tapeEmptyAction} →
        </Link>
      </div>
    );
  }
  return <ExchangeTape items={batchTapeItems(entries, locale)} locale={locale} label={copy.tape} className="h-(--shell-tape)" />;
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

/** 账户菜单：头像不再一点就退出（之前没有确认，移动端也一样）。 */
function AccountMenu({ email }: { email: string }) {
  const { t, locale, setLocale } = useTranslation();
  const copy = getPlatformCopy(locale).shell;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="account-menu-trigger"
        className="flex size-8 shrink-0 items-center justify-center rounded-(--radius-md) border border-border-bright bg-active font-mono text-meta font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`${t("shell.platformShell.accountSignOut")} · ${email}`}
        title={email}
      >
        {email ? emailInitial(email) : <UserRound className="size-4" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5 px-2 py-1.5">
            <span className="block x-label">{copy.signedInAs}</span>
            <span className="block truncate font-mono text-data normal-case text-foreground">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1 x-label">{copy.language}</DropdownMenuLabel>
          {LOCALES.map((code) => (
            <DropdownMenuItem key={code} onClick={() => setLocale(code)} className="cursor-pointer">
              <span className="flex-1">{LOCALE_LABELS[code]}</span>
              {code === locale ? <Check className="size-4 text-accent" aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/privacy" prefetch={false} />} className="cursor-pointer">
          {copy.privacy}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/terms" prefetch={false} />} className="cursor-pointer">
          {copy.terms}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="account-sign-out"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="cursor-pointer"
        >
          <LogOut className="size-4" aria-hidden />
          {t("shell.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PlatformShell({
  children,
  email,
  workspaceName,
  initialPulse,
  showOpsCredits = false,
}: {
  children: React.ReactNode;
  email: string;
  workspaceName: string;
  /** 服务端首屏脉搏（loadPulse）；之后由 usePulse 每 30 秒刷新。 */
  initialPulse: ExchangePulse;
  showOpsCredits?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale } = useTranslation();
  const copy = getPlatformCopy(locale).shell;
  const pulse = usePulse(initialPulse, pathname);
  // 实时点只给「正在发生」：真在生成的视频条数决定市场状态（排队、暂停都不算生成中）。
  const live = pulse.generating > 0;
  const queued = !live && pulse.queued > 0;
  const planName = copy.planNames[pulse.quota.plan];
  const badges = navBadges(pulse, locale, copy.newLeadsBadge);

  // 导轨编号即快捷键：焦点不在输入框、没有打开的对话框时，按 1–7 直达对应页面。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const item = PLATFORM_PRIMARY_NAV[index];
      if (!item) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']")) return;
      if (document.querySelector("[aria-modal='true'], [role='dialog'][data-open], [role='menu']")) return;
      event.preventDefault();
      router.push(item.href);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);
  return (
    <div className="desk-theme desk-canvas relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="x-pane sticky top-0 z-30 h-(--shell-top) border-b">
        <div className="flex h-(--shell-bar) items-center gap-3 border-b px-3 md:px-4">
          <Link href="/app/create" prefetch={false} className="flex shrink-0 items-center gap-2.5" aria-label={copy.home}>
            <Logo size={30} />
            <span className="hidden font-heading text-[15px] font-semibold tracking-[0.14em] sm:inline">AIVORA</span>
          </Link>
          <span className="hidden h-5 w-px bg-border md:block" aria-hidden />
          {/* 只有一个工作区：芯片只是标识，不画下拉箭头装作能切换。 */}
          <div
            data-testid="workspace-chip"
            className="hidden h-8 max-w-64 items-center gap-2 rounded-(--radius-md) border border-border bg-raised px-2.5 text-meta text-foreground md:flex"
            title={workspaceName}
          >
            <span className="rounded-(--radius-sm) bg-accent-soft px-1.5 font-mono text-micro leading-4 text-accent">{planName}</span>
            <span className="truncate">{workspaceName}</span>
          </div>
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
          <div className="hidden items-center gap-2 rounded-(--radius-md) border border-border px-2.5 py-1 lg:flex" role="status" data-testid="market-status">
            <span className="x-live" data-tone={live ? "live" : "idle"} aria-hidden />
            <span className={cn("font-mono text-data uppercase tracking-wider", live ? "text-accent" : "text-muted-foreground")}>
              {live ? copy.marketLive : queued ? copy.marketQueued : copy.marketIdle}
            </span>
            {live || queued ? (
              <span className="font-mono text-data tabular-nums text-foreground">{live ? pulse.generating : pulse.queued}</span>
            ) : null}
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
          <AccountMenu email={email} />
        </div>
        <Tape entries={pulse.tape} locale={locale} />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 导轨在文档流里 sticky：与顶栏一起动（不再 fixed 钉在视口上），矮屏时自己滚。 */}
        <aside className="x-pane sticky top-(--shell-top) z-20 hidden h-[calc(100dvh-var(--shell-top)-var(--shell-status))] w-56 shrink-0 flex-col self-start overflow-y-auto overscroll-contain border-r md:flex">
          <Nav pathname={pathname} badges={badges} />
          <div className="mt-auto space-y-1.5 border-t p-4">
            <span className="x-label">{copy.equity}</span>
            <div className="flex items-baseline justify-between gap-2 text-meta">
              <span className="text-muted-foreground">{readingName("monthlyQuota", locale)}</span>
              <span className={cn("font-mono tabular-nums", pulse.quota.limit > 0 && pulse.quota.used >= pulse.quota.limit ? "text-gold" : "text-foreground")}>
                {pulse.quota.used} / {pulse.quota.limit}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-meta">
              <span className="text-muted-foreground">{t("shell.platformShell.currentPlan")}</span>
              <span className="text-accent">{planName}</span>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-16 md:pb-(--shell-status)">
          <div className="x-page x-enter min-h-full">{children}</div>
        </main>
      </div>

      <footer className="x-pane fixed inset-x-0 bottom-0 z-30 hidden h-(--shell-status) items-center gap-4 border-t px-4 text-data text-muted-foreground md:flex">
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
        <Nav pathname={pathname} mobile badges={badges} />
      </div>
    </div>
  );
}
