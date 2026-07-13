import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-20 items-center border-b border-border bg-card px-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora 首页"
        >
          <Logo size={40} />
          <span>
            <span className="block font-heading text-subhead">Aivora</span>
            <span className="block text-meta text-muted-foreground">
              Editorial Studio
            </span>
          </span>
        </Link>
      </header>
      <main className="mx-auto grid min-h-[calc(100vh-8rem)] w-full max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.75fr)] lg:px-8">
        <section className="max-w-2xl space-y-6">
          <p className="text-meta font-semibold uppercase tracking-[0.16em] text-muted-foreground">AI video production studio</p>
          <h1 className="editorial-display">
            把创意带进工作台，<span className="text-primary">把成片带向市场。</span>
          </h1>
          <p className="max-w-xl text-body text-muted-foreground">
            Aivora 将策划、生成、质量检查与批量交付收进一条可追踪的视频生产链路。
          </p>
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-6">
            <div><dt className="text-meta uppercase tracking-wider text-muted-foreground">Workflow</dt><dd className="mt-1 font-mono text-subhead font-semibold">1 → 4</dd></div>
            <div><dt className="text-meta uppercase tracking-wider text-muted-foreground">Trace</dt><dd className="mt-1 font-mono text-subhead font-semibold">JOB ID</dd></div>
            <div><dt className="text-meta uppercase tracking-wider text-muted-foreground">Output</dt><dd className="mt-1 font-mono text-subhead font-semibold">9:16</dd></div>
          </dl>
        </section>
        <Card className="w-full min-w-0">{children}</Card>
      </main>
      <footer className="flex min-h-12 items-center justify-center gap-5 border-t border-border px-4 text-meta text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">隐私政策</Link>
        <Link href="/terms" className="hover:text-foreground">服务条款</Link>
      </footer>
    </div>
  );
}
