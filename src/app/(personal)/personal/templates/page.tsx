"use client";

import { useRouter } from "next/navigation";
import { saveCreatePrefill } from "@/components/personal/upload-assets";

interface PromptTemplate {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  prompt: string;
  duration: 15 | 30 | 60;
  mode: "fast" | "director";
  tag: string;
}

const TEMPLATES: PromptTemplate[] = [
  {
    id: "ugc-voiceover",
    emoji: "🎤",
    title: "UGC 口播带货",
    desc: "真人实拍感口播，开头抛痛点，结尾催下单",
    prompt:
      "15秒 UGC 口播风格带货视频：真人手持产品对镜头说话的感觉，开头2秒抛出目标人群的痛点问题，中段快速展示产品使用效果和核心卖点，结尾给出限时优惠引导下单。画面要有手机实拍质感，不要过度精致。",
    duration: 15,
    mode: "fast",
    tag: "带货",
  },
  {
    id: "unboxing",
    emoji: "📦",
    title: "开箱测评",
    desc: "第一视角开箱，细节特写 + 上手体验",
    prompt:
      "第一视角开箱测评短视频：从拆快递盒开始，逐步展示产品包装、外观细节特写、上手使用瞬间，配合桌面场景。节奏轻快，镜头切换干脆，突出产品质感和第一印象惊喜感。",
    duration: 15,
    mode: "fast",
    tag: "测评",
  },
  {
    id: "before-after",
    emoji: "✨",
    title: "使用前后对比",
    desc: "Before/After 强反差，适合美妆清洁类",
    prompt:
      "使用前后对比短视频：前半段展示使用前的困扰场景（灰暗色调），中间产品登场特写，后半段展示使用后的明显改善效果（明亮色调）。反差要强烈，让观众一眼看到效果。",
    duration: 15,
    mode: "fast",
    tag: "转化",
  },
  {
    id: "lifestyle",
    emoji: "🌿",
    title: "生活方式种草",
    desc: "产品融入理想生活场景，氛围感拉满",
    prompt:
      "生活方式种草视频：把产品自然融入清晨起床、通勤、下午茶等理想生活场景，柔和自然光，电影感调色，慢节奏运镜。让观众向往这种生活并把产品当成标配。",
    duration: 30,
    mode: "director",
    tag: "种草",
  },
  {
    id: "problem-solution",
    emoji: "💡",
    title: "痛点解决剧情",
    desc: "小剧情：遇到麻烦 → 产品救场",
    prompt:
      "痛点解决小剧情：开头3秒展示一个让人抓狂的日常麻烦场景，主角快要放弃时产品登场，快速演示产品如何轻松解决问题，结尾主角轻松微笑。节奏紧凑有戏剧感。",
    duration: 30,
    mode: "director",
    tag: "剧情",
  },
  {
    id: "three-reasons",
    emoji: "🔥",
    title: "三大理由清单",
    desc: "「买它的3个理由」清单体，信息密度高",
    prompt:
      "清单体带货视频：「你需要它的3个理由」结构，每个理由一组镜头（理由1：核心功能演示；理由2：使用场景；理由3：性价比/口碑），每段配大字标题卡，最后催单。节奏快，信息密度高。",
    duration: 30,
    mode: "fast",
    tag: "带货",
  },
  {
    id: "asmr",
    emoji: "🎧",
    title: "ASMR 质感特写",
    desc: "极致特写 + 材质声音，沉浸式解压",
    prompt:
      "ASMR 质感特写视频：产品表面材质极致微距特写、开合/按压/倾倒等动作慢镜头，配合解压节奏。画面干净背景纯色，光影高级，突出产品做工质感。",
    duration: 15,
    mode: "director",
    tag: "质感",
  },
  {
    id: "trend-remix",
    emoji: "📈",
    title: "热梗节奏复刻",
    desc: "按爆款视频节奏结构复刻，钩子前置",
    prompt:
      "按TikTok爆款节奏复刻：0-2秒强视觉钩子（产品最惊艳的瞬间前置），3-8秒快节奏多角度展示，8-13秒真实使用场景，最后2秒记忆点收尾。全程卡点式剪辑节奏。",
    duration: 15,
    mode: "fast",
    tag: "爆款",
  },
  {
    id: "brand-film",
    emoji: "🎬",
    title: "品牌质感大片",
    desc: "电影级运镜，适合高客单价产品",
    prompt:
      "品牌质感大片：电影级灯光与运镜，产品如奢侈品广告般缓慢旋转展示，配合光影变化和粒子氛围，穿插使用场景的高级感剪影，结尾产品定格 + 品牌气质收尾。",
    duration: 30,
    mode: "director",
    tag: "品牌",
  },
];

export default function TemplatesPage() {
  const router = useRouter();

  function applyTemplate(tpl: PromptTemplate) {
    saveCreatePrefill({
      prompt: tpl.prompt,
      duration: tpl.duration,
      mode: tpl.mode,
    });
    router.push("/personal/create-video?from=template");
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            提示词库
          </h1>
          <p className="mt-1 text-xs" style={{ color: "var(--glass-text-dim)" }}>
            经过验证的出片模板 — 点「套用」直接进入创作流程
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((tpl) => (
          <div key={tpl.id} className="glass-card flex flex-col p-5">
            <div className="flex items-start justify-between">
              <span className="text-2xl">{tpl.emoji}</span>
              <span className="glass-chip">{tpl.tag}</span>
            </div>
            <h2 className="mt-3 text-sm font-semibold text-white">{tpl.title}</h2>
            <p className="mt-1 flex-1 text-xs leading-relaxed" style={{ color: "var(--glass-text-dim)" }}>
              {tpl.desc}
            </p>
            <p className="mt-3 line-clamp-3 rounded-lg border border-white/8 bg-black/25 p-2.5 text-[11px] leading-relaxed text-white/60">
              {tpl.prompt}
            </p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: "var(--glass-text-dim)" }}>
                {tpl.duration}s · {tpl.mode === "fast" ? "快速成片" : "导演分镜"}
              </span>
              <button
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="glass-btn-primary px-4 py-1.5 text-xs"
              >
                套用
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
