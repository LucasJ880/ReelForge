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
        <div className="text-xs text-muted-foreground">内部交付系统</div>
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
              真实素材广告增长系统
            </div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
              从真实素材
              <br />
              到多版广告赛马
              <br />
              <span className="text-primary">全流程闭环</span>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Aivora Ads 把客户上传的产品、门店、人物或使用场景素材，转成可测试、可复盘、可持续优化的短视频广告。
            </p>

            <ul className="mt-10 space-y-3 text-sm text-muted-foreground">
              {[
                "真实素材上传 → 市场分析 → 卖点提炼",
                "单卖点 5 条广告赛马（3 优化型 + 2 探索型）",
                "QA 八维打分 + 人工审核双把关",
                "12/24/48h 数据回流 + 特征蒸馏",
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
