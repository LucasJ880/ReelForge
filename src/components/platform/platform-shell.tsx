"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BookOpen,
  Check,
  CircleHelp,
  Clapperboard,
  Film,
  Layers3,
  LogOut,
  NotebookText,
  Palette,
  Plus,
  Search,
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
import { usePulse } from "@/components/exchange/use-pulse";
import { OpsCreditsCluster } from "@/components/platform/ops-credits-cluster";
import { CapabilityIndicator } from "@/components/capabilities/capability-indicator";
import type { PublicCapabilities } from "@/lib/capabilities/registry";
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
  create: Clapperboard,
  batches: Layers3,
  /// 战绩（wins）入口暂时下线（见 platform-routes）：放回导航时连同 Trophy 图标一起加回。
  library: Film,
  brands: Palette,
  templates: NotebookText,
  guide: BookOpen,
} satisfies Record<PlatformNavId, typeof Clapperboard>;

/** 导轨徽标：批量 = 进行中批次（青）；成品库 = 需要处理（玫红，与成品库「需要处理」区同一批）。询盘入口 2026-10-28 下线。 */
type NavBadge = { count: number; tone: "live" | "fault" | "winner"; label: string };

const BADGE_TONE: Record<NavBadge["tone"], string> = {
  live: "bg-accent-soft text-accent",
  fault: "bg-danger-soft text-danger",
  winner: "bg-gold-soft text-gold",
};

function navBadges(pulse: ExchangePulse, locale: Locale): Partial<Record<PlatformNavId, NavBadge>> {
  return {
    batches: { count: pulse.activeBatches, tone: "live", label: readingName("activeBatches", locale) },
    library: { count: pulse.needsAttention, tone: "fault", label: readingName("needsAttention", locale) },
  };
}

function activePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function emailInitial(email: string): string {
  const local = email.split("@")[0]?.trim();
  return local ? local.slice(0, 1).toUpperCase() : "A";
}

/// 侧栏分组（学 LibTV）：顺序与 PLATFORM_PRIMARY_NAV 一致，快捷键 1–7 不变。
const NAV_GROUPS: ReadonlyArray<{ id: "make" | "assets" | "help"; items: readonly PlatformNavId[] }> = [
  { id: "make", items: ["create", "batches"] },
  { id: "assets", items: ["library", "brands", "templates"] },
  { id: "help", items: ["guide"] },
];

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
  const link = (id: PlatformNavId) => {
    const index = PLATFORM_PRIMARY_NAV.findIndex((entry) => entry.id === id);
    const item = PLATFORM_PRIMARY_NAV[index]!;
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
            : "relative flex h-9 shrink-0 items-center gap-3 rounded-(--radius-md) px-3 text-meta font-medium transition-colors",
          mobile
            ? active
              ? "text-foreground"
              : "text-muted-foreground"
            : active
              ? "bg-active text-foreground"
              : "text-muted-foreground hover:bg-raised hover:text-foreground",
        )}
      >
        <span className="relative flex shrink-0">
          <Icon className="size-4 stroke-[1.5]" aria-hidden />
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
  };
  if (mobile) {
    return (
      <nav aria-label={t("shell.platformShell.mobileNav")} className="grid h-16 auto-cols-fr grid-flow-col border-t bg-sidebar">
        {PLATFORM_PRIMARY_NAV.map((item) => link(item.id))}
      </nav>
    );
  }
  return (
    <nav aria-label={t("shell.platformShell.primaryNav")} className="flex flex-col gap-5 px-3 py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <span className="px-3 pb-1 text-data text-tertiary">{shell.navGroups[group.id]}</span>
          {group.items.map((id) => link(id))}
        </div>
      ))}
    </nav>
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
        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-active font-mono text-meta font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
  initialCapabilities = null,
  showOpsCredits = false,
}: {
  children: React.ReactNode;
  email: string;
  workspaceName: string;
  /** 服务端首屏脉搏（loadPulse）；之后由 usePulse 每 30 秒刷新。 */
  initialPulse: ExchangePulse;
  /** C4 · 服务端首屏能力状态（getCapabilities）；之后由 useCapabilities 每 5 分钟刷新。 */
  initialCapabilities?: PublicCapabilities | null;
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
  const badges = navBadges(pulse, locale);

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
    <div className="desk-theme relative flex min-h-screen bg-background text-foreground">
      {/* 侧栏（学 LibTV 工作台）：标识、唯一实心主行动「新建视频」、三组导航；底部是额度、生成状态与能力提示。
          不再有行情条、状态栏时钟与编号键帽——快捷键 1–7 仍在（aria-keyshortcuts）。 */}
      <aside className="studio-side sticky top-0 z-20 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto overscroll-contain border-r bg-sidebar md:flex">
        <div className="flex h-(--shell-bar) shrink-0 items-center gap-2.5 px-5">
          <Link href="/app/create" prefetch={false} className="flex min-w-0 items-center gap-2.5" aria-label={copy.home}>
            <Logo size={26} />
            <span className="truncate font-heading text-[14px] font-semibold tracking-[0.14em]">AIVORA</span>
          </Link>
        </div>
        <div className="px-3 pb-3 pt-1">
          <Link
            href="/app/create"
            prefetch={false}
            data-testid="sidebar-new-video"
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-foreground text-meta font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Plus className="size-4" aria-hidden />
            {copy.newVideo}
          </Link>
        </div>
        <Nav pathname={pathname} badges={badges} />
        <footer className="mt-auto space-y-2.5 border-t px-5 py-4 text-meta">
          {/* 只有一个工作区：芯片只是标识，不画下拉箭头装作能切换。 */}
          <div data-testid="workspace-chip" className="flex min-w-0 items-center gap-2" title={workspaceName}>
            <span className="rounded-(--radius-sm) bg-accent-soft px-1.5 font-mono text-micro leading-4 text-accent">{planName}</span>
            <span className="truncate text-foreground">{workspaceName}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{readingName("monthlyQuota", locale)}</span>
            <span className={cn("font-mono tabular-nums", pulse.quota.limit > 0 && pulse.quota.used >= pulse.quota.limit ? "text-gold" : "text-foreground")}>
              {pulse.quota.used} / {pulse.quota.limit}
            </span>
          </div>
          <div className="flex items-center gap-2" role="status" data-testid="market-status">
            <span className="x-live" data-tone={live ? "live" : "idle"} aria-hidden />
            <span className={live ? "text-accent" : "text-muted-foreground"}>
              {live ? copy.marketLive : queued ? copy.marketQueued : copy.marketIdle}
            </span>
            {live || queued ? (
              <span className="font-mono tabular-nums text-foreground">{live ? pulse.generating : pulse.queued}</span>
            ) : null}
          </div>
          {/* C4：有 AI 能力暂停 / 不稳定时亮出来，点进去看哪些停了、系统改用什么 */}
          <CapabilityIndicator initial={initialCapabilities} locale={locale} />
        </footer>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-(--shell-bar) shrink-0 items-center gap-3 border-b bg-background px-3 md:px-6">
          <Link href="/app/create" prefetch={false} className="flex shrink-0 items-center md:hidden" aria-label={copy.home}>
            <Logo size={28} />
          </Link>
          <div className="shrink-0 md:hidden" data-mobile-language-switcher>
            <LanguageSwitcher variant="inline" className="size-9 justify-center gap-0 p-0 [&>span]:sr-only" />
          </div>
          <form action="/app/library" className="relative min-w-0 w-full max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              name="q"
              aria-label={t("shell.platformShell.search")}
              placeholder={t("shell.platformShell.search")}
              className="h-9 w-full rounded-full border border-border bg-raised pl-10 pr-4 text-body text-foreground outline-none placeholder:text-tertiary focus-visible:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </form>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {showOpsCredits ? <OpsCreditsCluster english={locale === "en-US"} /> : null}
            <Link
              href="/app/guide"
              prefetch={false}
              data-testid="topbar-help"
              aria-label={locale === "en-US" ? "Open the user guide" : "打开使用指南"}
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
            >
              <CircleHelp className="size-4" aria-hidden />
            </Link>
            <AccountMenu email={email} />
          </div>
        </header>

        <main className="min-w-0 flex-1 pb-16 md:pb-0">
          <div className="x-page x-enter min-h-full">{children}</div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
        <Nav pathname={pathname} mobile badges={badges} />
      </div>
    </div>
  );
}
