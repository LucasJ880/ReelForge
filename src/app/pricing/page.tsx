import Link from "next/link";
import { Check, Sparkles, Shield, Crown } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PublicHeader } from "@/components/public/public-header";

export const metadata = {
  title: "定价 · Aivora",
  description:
    "Aivora 订阅方案：免费浏览公开画廊，订阅 Pro 解锁 AI 一键视频生成、Brand Lock、批量处理等全部能力。",
};

export default async function PricingPage() {
  const session = await getServerSession(authOptions);
  const ctaHref = session ? "/settings/billing" : "/register?next=/settings/billing";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-12 sm:pt-20">
        <header className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.2em] text-primary/80 font-medium mb-3">
            Pricing
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            选一个适合你的方案
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            免费方案足以让你浏览和下载画廊里的作品。Pro 方案解锁 AI 一键视频生成、Brand Lock 品牌叠加和批量处理。
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* FREE */}
          <section className="rounded-2xl border border-border bg-card/40 p-6 sm:p-8">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-white">Free</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              免费注册即可使用，适合先感受作品质量
            </p>
            <div className="mb-5">
              <span className="text-3xl font-semibold text-white">¥0</span>
              <span className="ml-1 text-muted-foreground text-sm">/ 永久</span>
            </div>
            <ul className="space-y-2.5 text-sm text-muted-foreground mb-6">
              <Bullet>浏览公开画廊全部作品</Bullet>
              <Bullet>高清下载画廊视频</Bullet>
              <Bullet>账号与基本设置管理</Bullet>
              <Bullet>随时可升级到 Pro</Bullet>
            </ul>
            <Link
              href={session ? "/gallery" : "/register"}
              className="block w-full text-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              {session ? "前往画廊" : "免费注册"}
            </Link>
          </section>

          {/* PRO */}
          <section className="relative rounded-2xl border border-primary/40 bg-primary/[0.03] p-6 sm:p-8 ring-1 ring-primary/20">
            <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
              推荐
            </span>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold text-white">Pro</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              一键生成、Brand Lock、批量 —— 全功能解锁
            </p>
            <div className="mb-1">
              <span className="text-3xl font-semibold text-white">¥129</span>
              <span className="ml-1 text-muted-foreground text-sm">/ 月</span>
            </div>
            <p className="text-[12px] text-primary mb-5">
              年付 ¥1188 / 年，折合 ¥99 / 月（省约 23%）
            </p>
            <ul className="space-y-2.5 text-sm text-muted-foreground mb-6">
              <Bullet>
                <strong className="text-foreground">30 条</strong>
                Seedance 高质量视频 / 月
              </Bullet>
              <Bullet>Brand Lock 自动叠加 Logo / 产品图</Bullet>
              <Bullet>批量生成（单次 5 并发）</Bullet>
              <Bullet>优先队列，高峰期不排队</Bullet>
              <Bullet>作品默认发布到公开画廊（可私有）</Bullet>
              <Bullet>所有 Free 功能</Bullet>
            </ul>
            <Link
              href={ctaHref}
              className="block w-full text-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-colors"
            >
              <Sparkles className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
              升级 Pro
            </Link>
            <p className="text-center text-[11px] text-muted-foreground mt-3">
              MVP 阶段订阅由管理员手动开通，付款后在 /settings/billing 留言或联系客服即可激活。
            </p>
          </section>
        </div>

        <section className="mt-16 rounded-2xl border border-border bg-card/30 p-6 sm:p-8">
          <h3 className="text-base font-semibold text-white mb-4">常见问题</h3>
          <div className="space-y-4 text-sm">
            <QA
              q="为什么需要付费？"
              a="视频生成使用付费的云端 AI 模型（Seedance），每条视频都有实打实的 API 成本。我们不做「免费但画质拉跨」的方案，宁可把 Pro 的品质做到极致。"
            />
            <QA
              q="可以随时取消吗？"
              a="可以。订阅按月计费，下一个结算周期前取消即可，剩余时间内依然可以使用全部 Pro 功能。"
            />
            <QA
              q="视频所有权归谁？"
              a="所有你生成的内容版权归你所有，可用于商业用途。公开画廊展示的版本也可以随时切换为私有。"
            />
            <QA
              q="超出 30 条/月 怎么办？"
              a="MVP 阶段如有大量需求，可联系管理员协商追加额度；未来我们会推出 Studio / Enterprise 档位。"
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="font-medium text-foreground mb-1">Q: {q}</p>
      <p className="text-muted-foreground leading-relaxed">{a}</p>
    </div>
  );
}
