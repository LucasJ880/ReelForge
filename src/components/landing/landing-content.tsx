"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Zap,
  Download,
  Globe,
  Layers,
  Check,
  Languages,
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
    title: "输入主题",
    desc: "一句话描述你想要的视频方向，可选择上传产品图作为参考。",
  },
  {
    num: "02",
    title: "AI 生成脚本 + 视频",
    desc: "Seedance 付费通道给出电影感镜头；Pexels + Edge TTS 的免费通道 30 秒成片。",
  },
  {
    num: "03",
    title: "下载即用",
    desc: "导出竖屏 mp4，自由发布到 TikTok / 抖音 / 小红书 / Reels。",
  },
];

const features = [
  {
    icon: Layers,
    title: "双通道选择",
    desc: "Seedance 引擎（付费高质量）和浏览器合成（免费无限）共存，你可以按场景切换。",
  },
  {
    icon: Languages,
    title: "9 种语言配音",
    desc: "Edge TTS 一键生成中 / 英 / 日 / 韩 / 西 / 法 / 德 / 越 / 印尼 9 语配音，可试听。",
  },
  {
    icon: Film,
    title: "可编辑素材",
    desc: "生成后仍能替换片段、改字幕、换 BGM、换配音，所有改动在浏览器里实时合成。",
  },
  {
    icon: Wand2,
    title: "批量并行",
    desc: "一次提交多个关键词，系统并行跑完所有任务，作品库支持一键下载与批量删除。",
  },
  {
    icon: Download,
    title: "本地 mp4 下载",
    desc: "不依赖任何平台授权，生成即是你的。导出 mp4 直接分发到任意渠道。",
  },
  {
    icon: Globe,
    title: "竖屏优先",
    desc: "默认 9:16 竖屏、硬字幕、平台安全区适配，省掉二次剪辑。",
  },
];

export function LandingContent() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient teal glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] ambient-glow opacity-60" />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/60 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="text-[15px] font-semibold tracking-tight">Aivora</span>
          </Link>
          <div className="flex items-center gap-2">
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
              免费开始
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
            双通道 AI 视频工厂
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[68px]"
          >
            把关键词
            <br className="hidden sm:block" />
            变成可直接发布的
            <span className="block text-primary">短视频</span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-[17px]"
          >
            Aivora 用两套互补的生成管线，把一个想法变成带配音、字幕、BGM 的 mp4。
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
              href="/register"
              className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              免费开始创作
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              已有账号 · 登录
            </Link>
          </motion.div>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={4}
            className="mt-6 text-xs text-muted-foreground/70"
          >
            无需信用卡 · 免费通道完全本地合成 · 隐私至上
          </motion.p>
        </div>

        {/* Product preview */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={5}
          className="relative mx-auto mt-20 max-w-4xl"
        >
          <div className="rounded-xl border border-border bg-card/40 p-2 shadow-2xl shadow-black/40 backdrop-blur-sm">
            <div className="overflow-hidden rounded-lg border border-border bg-[oklch(0.08_0_0)]">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                </div>
                <span className="ml-3 text-[11px] font-mono text-muted-foreground/70">aivora.app/projects/new</span>
              </div>

              <div className="grid gap-0 md:grid-cols-[1fr_420px]">
                <div className="space-y-4 border-b border-border p-6 md:border-b-0 md:border-r">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">关键词</p>
                    <p className="mt-2 text-sm text-foreground/90">冬天保暖护膝 · 职场女性</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">通道</p>
                    <div className="mt-2 flex gap-2">
                      <div className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                        Free · Edge TTS + Pexels
                      </div>
                      <div className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                        Pro · Seedance
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">语言</p>
                    <p className="mt-2 text-sm text-foreground/90">中文（普通话，女声）</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">预计时长</p>
                    <p className="mt-2 text-sm text-foreground/90">≈ 28s · 9:16 · 硬字幕</p>
                  </div>
                  <button className="pointer-events-none mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground">
                    开始生成
                  </button>
                </div>

                <div className="flex items-center justify-center bg-[oklch(0.05_0_0)] p-6">
                  <div className="relative aspect-[9/16] w-[180px] overflow-hidden rounded-lg border border-border bg-gradient-to-br from-card to-black">
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-primary">PREVIEW</div>
                      <p className="text-sm font-medium leading-tight text-foreground">
                        一件能穿过整个冬天的护膝
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

      {/* Features grid */}
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
              What you get
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              为真实创作者设计的细节
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              我们把 MoneyPrinterTurbo 级别的开源管线与付费商业模型整合到一个干净的界面里。
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

      {/* Channel comparison */}
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
              Two channels
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              免费实验，付费出圈
            </h2>
          </motion.div>

          <div className="grid gap-5 md:grid-cols-2">
            <ChannelCard
              tag="FREE"
              title="Free 通道"
              subtitle="Pexels 素材 + Edge TTS + 浏览器合成"
              price="¥0"
              items={[
                "完全免费，不烧信用卡",
                "9 种语言配音与硬字幕",
                "本地浏览器合成，隐私友好",
                "适合文案型 / 口播型视频",
              ]}
              cta="立即体验"
              highlight
            />
            <ChannelCard
              tag="PRO"
              title="Pro 通道"
              subtitle="即梦 Seedance 视频生成引擎"
              price="按次计费"
              items={[
                "电影感镜头与流畅运镜",
                "支持多变体并行（N Choose 1）",
                "高质量图生视频 / 文生视频",
                "适合产品种草 / 品牌向内容",
              ]}
              cta="Pro 通道介绍"
            />
          </div>
        </div>
      </section>

      {/* CTA */}
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
              准备好做第一条 AI 短视频了吗？
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              先用免费通道试一次。不满意，不花一分钱。
            </p>
            <Link
              href="/register"
              className="mt-7 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              免费开始
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={18} />
            <span>© {new Date().getFullYear()} Aivora</span>
          </div>
          <div className="flex items-center gap-5">
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

function ChannelCard({
  tag,
  title,
  subtitle,
  price,
  items,
  cta,
  highlight,
}: {
  tag: string;
  title: string;
  subtitle: string;
  price: string;
  items: string[];
  cta: string;
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
        <span className="text-[11px] text-muted-foreground">{price}</span>
      </div>
      <h3 className="mt-6 text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

      <ul className="mt-6 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/90">
            <Check className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/register"
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
