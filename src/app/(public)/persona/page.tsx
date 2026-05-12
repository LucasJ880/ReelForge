import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
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
    <div className="min-h-screen flex flex-col">
      <header className="px-6 lg:px-12 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="text-base font-semibold tracking-tight">Aivora</span>
        </div>
        {!isAuthed && (
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
        )}
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-3xl text-center">
          <h1 className="text-4xl lg:text-5xl font-semibold tracking-tight">
            What are you here to make?
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            One unified AI video studio, tuned for two very different jobs.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-4xl">
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
            ctaHref={isAuthed ? undefined : "/login?from=/business"}
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
            ctaHref={isAuthed ? undefined : "/login?from=/personal"}
          />
        </div>
      </section>

      <footer className="px-6 lg:px-12 py-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Aivora · AI Video Growth Platform
      </footer>
    </div>
  );
}
