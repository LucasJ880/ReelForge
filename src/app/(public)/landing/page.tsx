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
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const steps = [
  {
    icon: Sparkles,
    title: "输入关键词",
    desc: "输入你的产品方向或内容主题，AI 自动生成脚本、标题和视频 Prompt",
    color: "from-violet-500 to-purple-600",
  },
  {
    icon: Video,
    title: "AI 生成视频",
    desc: "即梦 Seedance 引擎自动将文字描述转化为高质量短视频",
    color: "from-pink-500 to-rose-600",
  },
  {
    icon: Share2,
    title: "一键发布",
    desc: "审核确认后直接发布到 TikTok，支持批量操作",
    color: "from-cyan-500 to-blue-600",
  },
  {
    icon: BarChart3,
    title: "数据分析",
    desc: "自动拉取表现数据，AI 分析趋势并给出优化建议",
    color: "from-emerald-500 to-green-600",
  },
];

const features = [
  {
    icon: Zap,
    title: "批量生成",
    desc: "一次输入多个关键词，并行生成数十条视频",
  },
  {
    icon: Globe,
    title: "TikTok 直连",
    desc: "OAuth 绑定账号，无需手动上传",
  },
  {
    icon: TrendingUp,
    title: "智能分析",
    desc: "GPT 驱动的表现分析和方向建议",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-zinc-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/landing" className="flex items-center gap-3">
            <Logo size={34} />
            <span className="text-base font-semibold tracking-tight">
              Aivora
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl px-5 py-2.5 text-sm text-zinc-400 transition hover:text-white"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium transition hover:bg-violet-500 shadow-lg shadow-violet-600/20"
            >
              免费开始
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-36 pb-24 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[900px] h-[700px] rounded-full bg-violet-600/[0.12] blur-[150px]" />
          <div className="absolute top-[20%] left-[20%] w-[500px] h-[500px] rounded-full bg-pink-600/[0.06] blur-[120px]" />
          <div className="absolute top-[15%] right-[15%] w-[300px] h-[300px] rounded-full bg-blue-600/[0.05] blur-[100px]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={0}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5 text-xs text-violet-300"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 驱动的短视频工作台
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl"
          >
            关键词到爆款视频
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              只需一步
            </span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400 leading-relaxed"
          >
            输入关键词，AI 自动生成脚本和视频，一键发布到 TikTok。
            <br />
            从创意到数据分析，全流程自动化。
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
            className="mt-10 flex items-center justify-center gap-4"
          >
            <Link
              href="/register"
              className="group flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-medium transition hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/20"
            >
              免费开始创作
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-zinc-800 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-700 hover:text-white"
            >
              已有账号
            </Link>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative py-24 px-6">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-16"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-3">
              工作流程
            </p>
            <h2 className="text-3xl font-bold sm:text-4xl">
              四步完成视频创作
            </h2>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
                className="group relative rounded-2xl border border-white/5 bg-zinc-900/50 p-6 transition hover:border-white/10 hover:bg-zinc-900"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${step.color} text-white`}
                  >
                    <step.icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-zinc-500">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6 border-t border-white/5">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-16"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-3">
              核心能力
            </p>
            <h2 className="text-3xl font-bold sm:text-4xl">
              不只是视频生成
            </h2>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
                className="rounded-2xl border border-white/5 bg-zinc-900/30 p-8 text-center"
              >
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                <p className="text-sm text-zinc-400">{f.desc}</p>
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
          variants={fadeUp}
          custom={0}
          className="mx-auto max-w-3xl rounded-3xl border border-white/5 bg-gradient-to-b from-zinc-900 to-zinc-950 p-12 text-center"
        >
          <h2 className="text-3xl font-bold sm:text-4xl mb-4">
            开始你的 AI 视频创作
          </h2>
          <p className="text-zinc-400 mb-8">
            从关键词到爆款短视频，全程 AI 驱动，让创作不再困难。
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-8 py-3.5 text-sm font-medium transition hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/20"
          >
            免费注册
            <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-xs text-zinc-500">
          <span>© 2026 Aivora</span>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:text-zinc-300">
              服务条款
            </Link>
            <Link href="/privacy" className="hover:text-zinc-300">
              隐私政策
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
