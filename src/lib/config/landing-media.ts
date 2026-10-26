/**
 * 公开首页的媒体（1025 整合轮 C1）。都在生产 Blob（renders/marketing/landing-1025/），不走 /brand/* 静态路径。
 *
 *  - hero：Shuyu 生成的上门服务场景（2K 静帧 → 1080P image2video 5 秒），转码成 720P 无缝循环。
 *    是 AI 画面，页面上必须标「AI 生成」，不冒充客户实拍。
 *  - proof：SunnyShutter（关联方）用 Aivora 做的三条竖版窗饰广告，540×960 静音版。
 *  - storyboard：proof 第二条的四帧，给「一周会发生什么」的出片样例。
 *
 * 纯数据、无服务端依赖：客户端组件也能引用。
 */
const BASE = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/marketing/landing-1025";

export type LandingHeroScene = "blinds" | "kitchen" | "garden" | "inquiry";

export const LANDING_HERO_SCENES: ReadonlyArray<{ scene: LandingHeroScene; video: string; poster: string }> = [
  { scene: "blinds", video: `${BASE}/hero-blinds.mp4`, poster: `${BASE}/hero-blinds.jpg` },
  { scene: "kitchen", video: `${BASE}/hero-kitchen.mp4`, poster: `${BASE}/hero-kitchen.jpg` },
  { scene: "garden", video: `${BASE}/hero-garden.mp4`, poster: `${BASE}/hero-garden.jpg` },
  { scene: "inquiry", video: `${BASE}/hero-inquiry.mp4`, poster: `${BASE}/hero-inquiry.jpg` },
];

export const LANDING_PROOF_VIDEOS: ReadonlyArray<{ video: string; poster: string }> = [
  { video: `${BASE}/proof-c3-v2a1.mp4`, poster: `${BASE}/proof-c3-v2a1.jpg` },
  { video: `${BASE}/proof-c2-v2a2.mp4`, poster: `${BASE}/proof-c2-v2a2.jpg` },
  { video: `${BASE}/proof-c1.mp4`, poster: `${BASE}/proof-c1.jpg` },
];

export const LANDING_STORYBOARD_FRAMES: readonly string[] = [
  `${BASE}/storyboard-0.8.jpg`,
  `${BASE}/storyboard-4.6.jpg`,
  `${BASE}/storyboard-8.6.jpg`,
  `${BASE}/storyboard-12.6.jpg`,
];
