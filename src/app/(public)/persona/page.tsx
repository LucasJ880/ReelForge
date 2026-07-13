import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonaCard } from "./persona-card";

/**
 * Persona chooser landing.
 *
 * 用户路径：
 *  - 未登录：看到两张卡 + Sign in 按钮（CTA 跳 /login?from=...）
 *  - 已登录但 userType=null：两张卡的「Continue」按钮 POST /api/persona 选择 persona
 *  - 已登录已选 persona：仍然渲染（让用户切换）
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
            <Badge className="mx-auto">Choose your studio</Badge>
            <h1 className="editorial-display mt-5">
            What are you here to make?
            </h1>
            <p className="mt-4 text-body text-muted-foreground">
              One unified AI video studio, tuned for two very different jobs.
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

          <div className="mt-10 grid w-full grid-cols-1 gap-5 md:grid-cols-2">
            <PersonaCard
              persona="BUSINESS"
              title="Business"
              tagline="Ship ad videos that perform."
              description="Generate product ads, repurpose footage, package brand overlays, and tune creative based on real platform performance."
              bullets={[
                "Unified creative input for prompts + uploaded clips + logos",
                "Brand packaging: end card, CTA, watermark — automated",
                "Performance-driven creative recommendations (coming Phase 2)",
              ]}
              isAuthed={isAuthed}
              /// Business 仍是 invite-only：未登录访客点这卡 → /login
              ctaHref={isAuthed ? undefined : "/login?from=/business"}
              ctaLabel={isAuthed ? undefined : "Sign in"}
              secondaryNote={
                !isAuthed
                  ? "Business accounts are invite-only — contact us for early access."
                  : undefined
              }
            />
            <PersonaCard
              persona="PERSONAL"
              title="Personal"
              tagline="Make videos for fun."
              description="Type a prompt, pick a duration and ratio, and generate clips in seconds. No brand jargon, no business analytics — just creation."
              bullets={[
                "Same powerful AI engine, simplified UI",
                "Text-to-video, image-to-video, and uploaded-clip stitching",
                "Templates and easy sharing (coming Phase 2)",
              ]}
              isAuthed={isAuthed}
              /// Personal 公开自助注册：未登录访客点这卡 → /register
              ctaHref={isAuthed ? undefined : "/register"}
              ctaLabel={isAuthed ? undefined : "Get started"}
              secondaryNote={
                !isAuthed
                  ? "Free to start. Already have an account? Sign in above."
                  : undefined
              }
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-5 text-meta text-muted-foreground sm:px-8">
        © {new Date().getFullYear()} Aivora · AI Video Growth Platform
      </footer>
    </div>
  );
}
