import { Logo } from "@/components/ui/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="text-sm font-semibold tracking-tight">Aivora</span>
        </div>
        <div className="text-xs text-muted-foreground">AI 短视频生成平台</div>
      </header>

      <div className="grid min-h-screen lg:grid-cols-2">
        <main className="flex items-center justify-center px-6 pt-24 pb-12 sm:px-10">
          <div className="w-full max-w-[380px]">{children}</div>
        </main>

        <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden border-l border-border bg-sidebar px-12 pt-24 pb-12">
          <div className="pointer-events-none absolute inset-0 ambient-glow opacity-60" />
          <div className="relative">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              本地商家短视频生成平台
            </div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
              上传素材
              <br />
              AI 自动出片
              <br />
              <span className="text-primary">直发短视频平台</span>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Aivora 把商家上传的产品、门店、人物或使用场景素材，转成可发布、可复用、可持续优化的竖屏短视频。
            </p>

            <ul className="mt-10 space-y-3 text-sm text-muted-foreground">
              {[
                "上传素材，AI 自动出 30s / 60s 成片",
                "支持 TikTok / Instagram Reels / YouTube Shorts 竖屏 9:16",
                "自动生成脚本、分镜、拍摄指导，商家照拍即可",
                "AI QA 把关素材质量 + 人工审核双保险",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 16 16"
                    className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      d="M3 8l3 3 7-7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative text-xs text-muted-foreground">
            © {new Date().getFullYear()} Aivora · Internal
          </div>
        </aside>
      </div>
    </div>
  );
}
