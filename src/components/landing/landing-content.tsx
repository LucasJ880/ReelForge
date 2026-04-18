"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Zap,
  Download,
  Shield,
  Layers,
  Check,
  Crown,
  Wand2,
  Film,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const steps = [
  {
    num: "01",
    title: "输入关键词",
    desc: "一句话描述你想要的视频方向，可选上传参考图、品牌 Logo 或填写场景描述。",
  },
  {
    num: "02",
    title: "AI 一键生成",
    desc: "Seedance 商业级视频模型给出电影感镜头，Brand Lock 自动叠加 Logo / 产品图。",
  },
  {
    num: "03",
    title: "下载即发布",
    desc: "导出 9:16 竖屏 mp4，自由发布到 TikTok、抖音、小红书、Reels。",
  },
];

const features = [
  {
    icon: Shield,
    title: "Brand Lock 品牌保真",
    desc: "AI 视频无法稳定生成 Logo —— 我们用 FFmpeg 最后一步硬叠加兜底，品牌 100% 清晰。",
  },
  {
    icon: Film,
    title: "Seedance 商业级画面",
    desc: "即梦 Seedance 引擎，电影感镜头与流畅运镜，真正可用于抖音 / TikTok 商业投放。",
  },
  {
    icon: Wand2,
    title: "批量并行",
    desc: "Pro 用户可一次提交多个关键词，系统 5 并发批量处理，作品库支持一键下载与管理。",
  },
  {
    icon: Layers,
    title: "公开画廊",
    desc: "所有完成的作品默认进入公开画廊，免费用户也能浏览与下载，灵感随手可得。",
  },
  {
    icon: Download,
    title: "本地 mp4 下载",
    desc: "不依赖任何平台授权，生成即是你的。导出 mp4 直接分发到任意渠道。",
  },
  {
    icon: Sparkles,
    title: "GPT-4o 脚本",
    desc: "自动生成脚本、标题、Hashtags 与视频提示词，支持多种语气（带货 / 叙事 / Vlog / 测评……）。",
  },
];

export function LandingContent() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] ambient-glow opacity-60" />

      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/60 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="text-[15px] font-semibold tracking-tight">Aivora</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/gallery"
              className="hidden sm:inline-flex rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              画廊
            </Link>
            <Link
              href="/pricing"
              className="hidden sm:inline-flex rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              定价
            </Link>
            <Link
              href="/login"
              className="hidden sm:inline-flex rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              免费注册
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-6 pt-40 pb-24">
        <div className="relative mx-auto max-w-4xl text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={0}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground"
          >
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            AI · Seedance · Brand Lock
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[68px]"
          >
            一句话关键词
            <br className="hidden sm:block" />
            直出可发布的
            <span className="block text-primary">商业级短视频</span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-[17px]"
          >
            Aivora 用 Seedance 商业级视频模型 + Brand Lock 品牌硬叠加，把一个想法变成带 Logo、脚本、Hashtags 的竖屏 mp4。
            下载即用，自由发布到 TikTok、抖音、小红书、Reels。
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              href="/gallery"
              className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              免费浏览画廊
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Crown className="h-4 w-4 text-primary" />
              订阅 Pro 开始创作
            </Link>
          </motion.div>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={4}
            className="mt-6 text-xs text-muted-foreground/70"
          >
            注册免费 · 浏览画廊免费 · 创作由 Pro 订阅驱动
          </motion.p>
        </div>

        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={5}
          className="relative mx-auto mt-20 max-w-4xl"
        >
          <div className="rounded-xl border border-border bg-card/40 p-2 shadow-2xl shadow-black/40 backdrop-blur-sm">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                </div>
                <span className="ml-3 text-[11px] font-mono text-muted-foreground/70">
                  aivora.app/projects/new
                </span>
              </div>

              <div className="grid gap-0 md:grid-cols-[1fr_420px]">
                <div className="space-y-4 border-b border-border p-6 md:border-b-0 md:border-r">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                      关键词
                    </p>
                    <p className="mt-2 text-sm text-foreground/90">
                      冬日保暖护膝 · 职场女性
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                      Brand Lock
                    </p>
                    <div className="mt-2 flex gap-2">
                      <div className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                        角标水印
                      </div>
                      <div className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                        片头片尾
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                      语言 / 语气
                    </p>
                    <p className="mt-2 text-sm text-foreground/90">
                      中文 · 带货广告
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                      输出
                    </p>
                    <p className="mt-2 text-sm text-foreground/90">
                      15s · 9:16 · 1080p mp4
                    </p>
                  </div>
                  <button className="pointer-events-none mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground">
                    开始生成
                  </button>
                </div>

                <div className="flex items-center justify-center bg-background p-6">
                  <div className="relative aspect-[9/16] w-[180px] overflow-hidden rounded-lg border border-border bg-gradient-to-br from-card to-background">
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-primary">
                        PREVIEW
                      </div>
                      <p className="text-sm font-medium leading-tight text-foreground">
                        一条能穿过整个冬天的护膝
                      </p>
                      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        合成中 68%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Pipeline */}
      <section className="relative px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
            className="mb-14 text-center"
          >
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
              How it works
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              三步完成一条视频
            </h2>
          </motion.div>

          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
                className="group relative rounded-xl border border-border bg-card/40 p-6 transition-colors hover:border-primary/40 hover:bg-card"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-primary">{step.num}</span>
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                </div>
                <h3 className="mt-4 text-lg font-medium tracking-tight">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
            className="mb-14 max-w-2xl"
          >
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
              Pro 功能一览
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              为真实创作者设计的细节
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              从脚本到视频到品牌保真，一条完整管线把工作流压缩到一次点击。
            </p>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
                className="rounded-xl border border-border bg-card/40 p-6 transition-colors hover:border-primary/30 hover:bg-card"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-primary">
                  <f.icon className="h-4 w-4" />
                </div>
                <h3 className="mt-5 text-base font-medium">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Plan comparison */}
      <section className="relative px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
            className="mb-14 text-center"
          >
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
              Plans
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              按需订阅，创作不打折
            </h2>
          </motion.div>

          <div className="grid gap-5 md:grid-cols-2">
            <PlanCard
              tag="FREE"
              title="Free"
              subtitle="浏览 · 下载"
              price="¥0"
              items={[
                "浏览公开画廊所有视频",
                "高清下载 mp4 文件",
                "账号与基本设置",
                "随时可升级 Pro",
              ]}
              cta="免费开始"
              href="/register"
            />
            <PlanCard
              tag="PRO"
              title="Pro"
              subtitle="全功能创作"
              price="¥129 / 月"
              priceHint="年付折合 ¥99/月"
              items={[
                "30 条 Seedance 高质量视频 / 月",
                "Brand Lock 品牌叠加",
                "批量生成（5 并发）",
                "优先队列 + 作品公开画廊",
              ]}
              cta="查看订阅"
              href="/pricing"
              highlight
            />
          </div>
        </div>
      </section>

      <section className="relative px-6 py-24">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
          className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border bg-card/60 p-10 text-center"
        >
          <div className="pointer-events-none absolute inset-0 ambient-glow opacity-40" />
          <div className="relative">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              看看真实作品，再决定要不要订阅
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              画廊免费开放，所有作品都是用 Aivora 生成的。
            </p>
            <div className="mt-7 flex items-center justify-center gap-3">
              <Link
                href="/gallery"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                浏览画廊
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                查看套餐
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={18} />
            <span>© {new Date().getFullYear()} Aivora</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/gallery" className="hover:text-foreground transition-colors">
              画廊
            </Link>
            <Link href="/pricing" className="hover:text-foreground transition-colors">
              定价
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              服务条款
            </Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              隐私政策
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PlanCard({
  tag,
  title,
  subtitle,
  price,
  priceHint,
  items,
  cta,
  href,
  highlight,
}: {
  tag: string;
  title: string;
  subtitle: string;
  price: string;
  priceHint?: string;
  items: string[];
  cta: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-7 transition-colors ${
        highlight
          ? "border-primary/40 bg-card hover:border-primary/60"
          : "border-border bg-card/40 hover:bg-card hover:border-primary/20"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[10px] font-mono tracking-widest ${
            highlight
              ? "bg-primary/20 text-primary"
              : "bg-secondary text-muted-foreground"
          }`}
        >
          {tag}
        </span>
        <div className="text-right">
          <span className="text-[14px] font-semibold text-foreground">{price}</span>
          {priceHint && (
            <div className="text-[10px] text-primary mt-0.5">{priceHint}</div>
          )}
        </div>
      </div>
      <h3 className="mt-6 text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

      <ul className="mt-6 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/90">
            <Check
              className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${
                highlight ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <Link
        href={href}
        className={`mt-7 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          highlight
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "border border-border bg-card text-foreground hover:bg-accent"
        }`}
      >
        {cta}
        <Zap className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
