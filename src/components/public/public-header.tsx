import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Sparkles } from "lucide-react";

export async function PublicHeader() {
  const session = await getServerSession(authOptions);

  return (
    <header className="border-b border-border/60 bg-background/70 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <Sparkles className="h-4 w-4 text-primary" />
          Aivora
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/gallery"
            className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            画廊
          </Link>
          <Link
            href="/pricing"
            className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            定价
          </Link>
          {session ? (
            <Link
              href="/dashboard"
              className="ml-2 rounded-lg bg-primary px-3 py-1.5 text-white font-medium hover:opacity-90"
            >
              进入工作台
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                登录
              </Link>
              <Link
                href="/register"
                className="ml-1 rounded-lg bg-primary px-3 py-1.5 text-white font-medium hover:opacity-90"
              >
                免费注册
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
