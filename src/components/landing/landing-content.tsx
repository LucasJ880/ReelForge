"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  Video,
  BarChart3,
  Share2,
  ArrowRight,
  Zap,
  Globe,
  TrendingUp,
  Play,
  ChevronRight,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const steps = [
  {
    icon: Sparkles,
    title: "输入关键词",
    desc: "输入产品方向或主题，AI 生成脚本、标题和视频 Prompt",
    gradient: "from-violet-500 to-indigo-500",
    bg: "bg-violet-500/[0.08]",
    border: "border-violet-500/20",
    num: "01",
  },
  {
    icon: Video,
    title: "AI 生成视频",
    desc: "即梦 Seedance 引擎将文字转化为高质量短视频",
    gradient: "from-pink-500 to-rose-500",
    bg: "bg-pink-500/[0.08]",
    border: "border-pink-500/20",
    num: "02",
  },
  {
    icon: Share2,
    title: "一键下载",
    desc: "视频生成完成后，直接下载 mp4，自由发布到各平台",
    gradient: "from-emerald-500 to-teal-500",
    bg: "bg-emerald-500/[0.08]",
    border: "border-emerald-500/20",
    num: "03",
  },
];

const features = [
  {
    icon: Zap,
    title: "批量生成",
    desc: "一次输入多个关键词，并行生成数十条视频",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  {
    icon: Globe,
    title: "多平台就绪",
    desc: "生成 mp4 竖屏视频，自由发布到 TikTok / 抖音 / 小红书等",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
  },
  {
    icon: TrendingUp,
    title: "Seedance 引擎",
    desc: "基于即梦最新 Seedance 视频模型，画质与连贯性领先",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
];

export function LandingContent() {
  return (
    <div className="min-h-screen bg-[#08080c] text-white overflow-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#08080c]/80 backdrop-blur-2xl border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-[15px] font-semibold tracking-tight">
              Aivora
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:text-white"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200"
            >
              免费注册
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6">
        {/* Richer ambient glows */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-5%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] rounded-full bg-violet-600/20 blur-[140px]" />
          <div className="absolute top-[10%] left-[15%] w-[400px] h-[400px] rounded-full bg-blue-500/15 blur-[120px]" />
          <div className="absolute top-[5%] right-[10%] w-[350px] h-[350px] rounded-full bg-pink-500/12 blur-[100px]" />
          <div className="absolute top-[30%] left-1/2 -translate-x-1/2 w-[600px] h-[200px] rounded-full bg-indigo-400/8 blur-[80px]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={0}
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-1.5 text-xs font-medium text-violet-200"
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-300" />
            AI 驱动的短视频创作平台
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl lg:text-7xl"
          >
            关键词到爆款视频
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
              只需一步
            </span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="mx-auto mt-6 max-w-xl text-base text-zinc-400 leading-relaxed sm:text-lg"
          >
            输入关键词，AI 自动生成脚本和视频。
            一键下载 mp4，自由发布到 TikTok / 抖音 / 小红书 / Reels。
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Link
              href="/register"
              className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-7 py-3.5 text-sm font-semibold transition-all hover:shadow-xl hover:shadow-violet-500/25 hover:brightness-110"
            >
              免费开始创作
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-7 py-3.5 text-sm text-zinc-300 transition hover:bg-white/[0.1] hover:text-white"
            >
              <Play className="h-3.5 w-3.5" />
              已有账号
            </Link>
          </motion.div>
        </div>

        {/* Floating preview mockup */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={scaleIn}
          custom={5}
          className="relative mx-auto mt-16 max-w-3xl"
        >
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-1.5 shadow-2xl shadow-violet-500/5">
            <div className="rounded-xl bg-[#0c0c14] p-6 space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-3 w-3 rounded-full bg-red-500/60" />
                <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
                <div className="h-3 w-3 rounded-full bg-green-500/60" />
                <div className="ml-4 flex-1 h-6 rounded-md bg-white/[0.04]" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["text-violet-400 bg-violet-500/10 border-violet-500/20", "text-pink-400 bg-pink-500/10 border-pink-500/20", "text-cyan-400 bg-cyan-500/10 border-cyan-500/20"].map((cls, i) => (
                  <div key={i} className={`rounded-lg border p-4 ${cls}`}>
                    <div className="h-2 w-12 rounded bg-current opacity-40 mb-3" />
                    <div className="text-2xl font-bold opacity-80">{["12", "7.8K", "96"][i]}</div>
                    <div className="text-[10px] mt-1 opacity-50">{["作品", "播放量", "AI 评分"][i]}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <div className="flex-1 h-24 rounded-lg bg-gradient-to-br from-violet-500/10 to-pink-500/5 border border-white/[0.04]" />
                <div className="flex-1 h-24 rounded-lg bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border border-white/[0.04]" />
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* How it works */}
      <section className="relative py-24 px-6">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-16"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-violet-400/80 font-medium mb-3">
              工作流程
            </p>
            <h2 className="text-3xl font-bold sm:text-4xl">
              四步完成视频创作
            </h2>
            <p className="mt-3 text-zinc-500 text-sm max-w-md mx-auto">
              从输入关键词到获得数据分析，全程 AI 自动化
            </p>
          </motion.div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={scaleIn}
                custom={i}
                className={`group relative rounded-2xl border ${step.border} ${step.bg} p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg`}
              >
                <div className="flex items-center justify-between mb-5">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${step.gradient} text-white shadow-lg`}
                  >
                    <step.icon className="h-5 w-5" />
                  </div>
                  <span className="text-[11px] font-bold text-white/20">
                    {step.num}
                  </span>
                </div>
                <h3 className="mb-2 text-base font-semibold text-zinc-100">{step.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {step.desc}
                </p>
                {i < 3 && (
                  <ChevronRight className="hidden lg:block absolute -right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/10" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-16"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-pink-400/80 font-medium mb-3">
              核心能力
            </p>
            <h2 className="text-3xl font-bold sm:text-4xl">
              不只是视频生成
            </h2>
          </motion.div>

          <div className="grid gap-5 sm:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={scaleIn}
                custom={i}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8 text-center transition-all duration-300 hover:bg-white/[0.06] hover:border-white/[0.1]"
              >
                <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${f.bg} ${f.color}`}>
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={scaleIn}
          custom={0}
          className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-violet-500/20 p-12 text-center"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/15 via-fuchsia-600/10 to-pink-600/15" />
          <div className="absolute inset-0 bg-[#08080c]/60" />
          <div className="relative">
            <h2 className="text-3xl font-bold sm:text-4xl mb-4">
              开始你的 AI 视频创作
            </h2>
            <p className="text-zinc-400 mb-8 max-w-md mx-auto">
              从关键词到爆款短视频，全程 AI 驱动，让创作不再困难
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3.5 text-sm font-semibold transition-all hover:shadow-xl hover:shadow-violet-500/25 hover:brightness-110"
            >
              免费注册
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-xs text-zinc-500">
          <span>© 2026 Aivora</span>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:text-zinc-300 transition-colors">
              服务条款
            </Link>
            <Link href="/privacy" className="hover:text-zinc-300 transition-colors">
              隐私政策
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
