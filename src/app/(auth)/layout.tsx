import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* Top brand bar */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="text-sm font-semibold tracking-tight">Aivora</span>
        </Link>
        <div className="text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            ← 回到首页
          </Link>
        </div>
      </header>

      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Left: form column */}
        <main className="flex items-center justify-center px-6 pt-24 pb-12 sm:px-10">
          <div className="w-full max-w-[380px]">{children}</div>
        </main>

        {/* Right: marketing column (desktop only) */}
        <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden border-l border-border bg-sidebar px-12 pt-24 pb-12">
          <div className="pointer-events-none absolute inset-0 ambient-glow opacity-60" />
          <div className="relative">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              AI Video Factory
            </div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
              把一个关键词
              <br />
              变成一条能直接发布的
              <br />
              <span className="text-primary">短视频</span>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Aivora 自动生成脚本、配音、字幕、素材，并在浏览器端合成 mp4。
              下载即用，随意发布到 TikTok / 抖音 / 小红书 / Reels。
            </p>

            <ul className="mt-10 space-y-3 text-sm text-muted-foreground">
              {[
                "基于 Seedance 的付费高质量通道",
                "零成本的免费通道（Pexels + Edge TTS + 浏览器合成）",
                "支持 9 种语言配音、批量生成、一键下载",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <svg viewBox="0 0 16 16" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative text-xs text-muted-foreground">
            © {new Date().getFullYear()} Aivora · 隐私至上
          </div>
        </aside>
      </div>
    </div>
  );
}
