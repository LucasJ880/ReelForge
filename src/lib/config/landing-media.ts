/**
 * 公开首页的媒体（1025 整合轮 C1）。都在生产 Blob（renders/marketing/…），不走 /brand/* 静态路径。
 *
 *  - hero（首页第一幕 + 登录页左半屏）：2026-10-28 晚换成 Runway 上 Veo 3.1 生成的电影感商品广告镜头
 *    （1920×1080、8 秒、无声；末 1 秒叠化回开头做成 7 秒无缝循环，与 HeroReel 的 7 秒换镜对齐），放 landing-1028/。
 *    换掉的是 1025 的上门服务场景（窗饰 / 橱柜 / 园艺，720P）——平台卖的是商品短视频，背景就放商品镜头。
 *    是 AI 画面，页面上必须标「AI 生成」，不冒充客户实拍；不出现任何品牌、文字和人（球鞋那条因侧面三道杠像商标而弃用）。
 *  - proof：SunnyShutter（关联方）用 Aivora 做的三条竖版窗饰广告，540×960 静音版。
 *  - storyboard：proof 第二条的四帧，给「一周会发生什么」的出片样例。
 *
 * 纯数据、无服务端依赖：客户端组件也能引用。
 */
const BASE = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/marketing/landing-1025";
const HERO_BASE = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/marketing/landing-1028";

export type LandingHeroScene = "serum" | "coffee" | "candle" | "splash";

/// 冷暖交替：精华（冷，靛蓝光环与站点主色同调）→ 咖啡（暖）→ 香薰（暖）→ 面霜水花（冷）
export const LANDING_HERO_SCENES: ReadonlyArray<{ scene: LandingHeroScene; video: string; poster: string }> = [
  { scene: "serum", video: `${HERO_BASE}/hero-serum.mp4`, poster: `${HERO_BASE}/hero-serum.jpg` },
  { scene: "coffee", video: `${HERO_BASE}/hero-coffee.mp4`, poster: `${HERO_BASE}/hero-coffee.jpg` },
  { scene: "candle", video: `${HERO_BASE}/hero-candle.mp4`, poster: `${HERO_BASE}/hero-candle.jpg` },
  { scene: "splash", video: `${HERO_BASE}/hero-splash.mp4`, poster: `${HERO_BASE}/hero-splash.jpg` },
];

export const LANDING_PROOF_VIDEOS: ReadonlyArray<{ video: string; poster: string }> = [
  { video: `${BASE}/proof-c3-v2a1.mp4`, poster: `${BASE}/proof-c3-v2a1.jpg` },
  { video: `${BASE}/proof-c2-v2a2.mp4`, poster: `${BASE}/proof-c2-v2a2.jpg` },
  { video: `${BASE}/proof-c1.mp4`, poster: `${BASE}/proof-c1.jpg` },
];

/**
 * 首页展厅（2026-10-28，学 Seedance 2.5 官网「输入 → 成片」配对轮播）：左上角是输入（商品图），整卡是成片。
 * 成片只取 SHOWCASE_SAFE_SLUGS（template-sample.ts，1025 逐帧复看过的公开安全样片）；商品图是同一批样片的输入集
 * （tmp/real-template-samples/template-samples-20260803-v1.json 的 productImages），都在生产 Blob。
 */
const SAMPLE_INPUTS = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/template-samples/template-samples-20260803-v1";

export type ShowroomPair = {
  slug: "commerce-beauty-texture" | "commerce-food-sizzle" | "commerce-outdoor-rugged";
  inputs: readonly string[];
  video: string;
  poster: string;
};

export const SHOWROOM_PRODUCT_PAIRS: ReadonlyArray<ShowroomPair> = [
  {
    slug: "commerce-beauty-texture",
    inputs: [`${SAMPLE_INPUTS}/serum/1785771935289-0.png`, `${SAMPLE_INPUTS}/serum/1785771977211-0.png`],
    video: "/template-previews/commerce-beauty-texture.mp4",
    poster: "/template-previews/commerce-beauty-texture.jpg",
  },
  {
    slug: "commerce-food-sizzle",
    inputs: [`${SAMPLE_INPUTS}/coffee/1785772718006-0.png`, `${SAMPLE_INPUTS}/coffee/1785772760730-0.png`],
    video: "/template-previews/commerce-food-sizzle.mp4",
    poster: "/template-previews/commerce-food-sizzle.jpg",
  },
  {
    slug: "commerce-outdoor-rugged",
    inputs: [`${SAMPLE_INPUTS}/backpack/1785772401409-0.png`, `${SAMPLE_INPUTS}/backpack/1785772447829-0.png`],
    video: "/template-previews/commerce-outdoor-rugged.mp4",
    poster: "/template-previews/commerce-outdoor-rugged.jpg",
  },
];

export const LANDING_STORYBOARD_FRAMES: readonly string[] = [
  `${BASE}/storyboard-0.8.jpg`,
  `${BASE}/storyboard-4.6.jpg`,
  `${BASE}/storyboard-8.6.jpg`,
  `${BASE}/storyboard-12.6.jpg`,
];
