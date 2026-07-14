import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { getPublicPageCopy } from "@/i18n/public-copy";
import { getServerLocale } from "@/i18n/server";
import { authOptions } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return getPublicPageCopy(locale).persona.metadata;
}

/**
 * Legacy public entry retained as an editorial landing page. Product access is
 * account-neutral: starter is self-service and studio is an entitlement, not a
 * separate persona or route tree.
 */
export default async function PersonaPage() {
  const [session, locale] = await Promise.all([
    getServerSession(authOptions),
    getServerLocale(),
  ]);
  const isAuthed = Boolean(session);
  const copy = getPublicPageCopy(locale).persona;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={copy.homeLabel}
        >
          <Logo size={40} />
          <span>
            <span className="block font-heading text-subhead">Aivora</span>
            <span className="hidden text-meta text-muted-foreground sm:block">
              {copy.studioLabel}
            </span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <LanguageSwitcher variant="inline" className="w-auto min-w-28" />
          {!isAuthed ? (
            <>
              <Button render={<Link href="/login" />} variant="ghost">
                {copy.signIn}
              </Button>
              <Button render={<Link href="/register" />}>{copy.getStarted}</Button>
            </>
          ) : null}
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
        <section className="w-full max-w-5xl">
          <div className="mx-auto max-w-3xl text-center">
            <Badge className="mx-auto">{copy.eyebrow}</Badge>
            <h1 className="editorial-display mt-5">{copy.title}</h1>
            <p className="mt-4 text-body text-muted-foreground">{copy.description}</p>
            <p className="mt-3 text-meta text-muted-foreground">
              {copy.partnerLead}{" "}
              <Link
                href="/showcase"
                className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
              >
                {copy.showcaseLink}
              </Link>
            </p>
          </div>

          <div className="mx-auto mt-10 flex max-w-xl flex-col gap-3 sm:flex-row sm:justify-center">
            <Button render={<Link href={isAuthed ? "/app/create" : "/register"} />}>
              {isAuthed ? copy.enterWorkspace : copy.createStarter}
            </Button>
            <Button
              render={<Link href={isAuthed ? "/app/templates" : "/login"} />}
              variant="outline"
            >
              {isAuthed ? copy.browseTemplates : copy.existingAccount}
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-5 text-meta text-muted-foreground sm:px-8">
        © {new Date().getFullYear()} Aivora · {copy.footer}
      </footer>
    </div>
  );
}
