import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Legacy public entry retained as an editorial landing page. Product access is
 * account-neutral: starter is self-service and studio is an entitlement, not a
 * separate persona or route tree.
 */
export default async function PersonaPage() {
  const session = await getServerSession(authOptions);
  const isAuthed = Boolean(session);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-20 items-center justify-between border-b border-border bg-card px-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora 首页"
        >
          <Logo size={40} />
          <span>
            <span className="block font-heading text-subhead">Aivora</span>
            <span className="hidden text-meta text-muted-foreground sm:block">
              Editorial Studio
            </span>
          </span>
        </Link>
        {!isAuthed && (
          <div className="flex items-center gap-2">
            <Button render={<Link href="/login" />} variant="ghost">
              Sign in
            </Button>
            <Button render={<Link href="/register" />}>
              Get started
            </Button>
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
        <section className="w-full max-w-5xl">
          <div className="mx-auto max-w-3xl text-center">
            <Badge className="mx-auto">AI video production</Badge>
            <h1 className="editorial-display mt-5">
              从一支视频开始，扩展到可控的批量生产。
            </h1>
            <p className="mt-4 text-body text-muted-foreground">
              创作、模板、批量、赛马与成品都在同一个工作区。新账号默认使用 starter，studio 由正式权益流程授予。
            </p>
            <p className="mt-3 text-meta text-muted-foreground">
              投资人 / 孵化器 / 战略合作？{" "}
              <Link
                href="/showcase"
                className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
              >
                查看真实客户案例展示
              </Link>
            </p>
          </div>

          <div className="mx-auto mt-10 flex max-w-xl flex-col gap-3 sm:flex-row sm:justify-center">
            <Button render={<Link href={isAuthed ? "/app/create" : "/register"} />}>
              {isAuthed ? "进入工作区" : "创建 starter 账号"}
            </Button>
            <Button render={<Link href={isAuthed ? "/app/templates" : "/login"} />} variant="outline">
              {isAuthed ? "浏览模板库" : "登录已有账号"}
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-5 text-meta text-muted-foreground sm:px-8">
        © {new Date().getFullYear()} Aivora · AI Video Growth Platform
      </footer>
    </div>
  );
}
