import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { NotFoundPanel } from "@/components/platform/not-found-panel";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getPlatformCopy(await getServerLocale()).notFound.meta };
}

/**
 * 全局 404：和登录门同一个大厅（结构条 + 网格场 + 不透明面板），双语。
 * 工作区里的 notFound()（坏的成片 / 批次编号）由 (platform)/app/not-found.tsx 接住，留在壳层里。
 */
export default async function NotFoundPage() {
  const locale = await getServerLocale();
  const copy = getPlatformCopy(locale).notFound;
  return (
    <div className="gate-theme desk-canvas flex min-h-screen flex-col bg-background text-foreground">
      <header className="x-pane flex h-16 items-center border-b px-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={copy.home}
        >
          <Logo size={32} />
          <span className="font-heading text-[15px] font-semibold tracking-[0.14em]">AIVORA</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <NotFoundPanel locale={locale} />
      </main>
    </div>
  );
}
