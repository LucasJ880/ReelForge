/**
 * 线上创作台走不走「导演线路」的判断，和给界面看的脚本摘要的形状（2026-11-17，线上对齐第 2 步）。
 *
 * 这个文件不引任何服务端模块：创作页（'use client'）要用同一条判断来决定要不要先等「出方案」那一步。
 * 真正写脚本、存脚本、拼提示词的代码在 director-line.ts（服务端）。
 *
 * 导演线路 = 一份镜头脚本 → 一张开场帧 → 一次生成整条片（15 / 30 秒都是一次），和 Claude 这边的
 * `npm run director` 用的是同一套规则与同一个提示词拼法（director-plan.ts）。
 */

/** 「电商快销」的模板 id（最早的一种风格；其余见 DIRECTOR_STYLES）。 */
export const DIRECTOR_LINE_TEMPLATE_ID = "tpl_ecommerce_fmcg";

/**
 * 风格卡（2026-11-17）：创作页「创意模板」下拉里的选项，也是 Claude 这边写脚本时照的同一张卡（skill aivora-director）。
 * 每种风格 = 片种 + 一段给导演写手的拍法要求（英文，直接拼进写手的用户消息）。拍法要求不在这个文件里：
 * 这个文件会进浏览器，而那些要求是我们的出片配方，放在只在服务端用的 director-style-briefs.ts（按 id 对应）。「自动匹配」不在这张表里：
 * 那是不给要求，由写手按商品自己定。老的 34 个模板（另一套做法）已经下线。
 *
 * 现在 20 种，分五组。分类参照了 Shuyu 创作台公开的预设与方法清单（商品卖点可视化、开箱与首次体验、促销信息短片、
 * 生活方式场景广告、自然口播测评、配饰与穿搭质感广告、关系短剧、日常轻喜剧——它自己注明改编自 Topview / SeaArt / iart 等开源方法），
 * 再补上常见的带货拍法。只取分类和做法，拍法要求是我们按自己的导演规则写的，没有搬原文。
 *
 * 加一种风格：在这里加一行，再到 director-style-briefs.ts 写它的 brief（有测试核对两边 id 一一对应）。brief 只写拍法（开场、节奏、光、人怎么出镜、口播和配乐的语气），不写商品事实；
 * 可以自己定开场（写手默认从「麻烦那一下」开场，风格写了别的开场就照风格的来）；其余不能和导演规则冲突
 *（时间线、露脸写法、全程英文、不让模型画字，这些仍由校验把关）。价格、促销这类字一律不进画面：只在口播里说商家给的事实。
 */
export type DirectorStyleGroup = "sell" | "seed" | "texture" | "story" | "place";

/** 下拉里的分组，按这个顺序排。 */
export const DIRECTOR_STYLE_GROUPS: ReadonlyArray<{ id: DirectorStyleGroup; zh: string; en: string }> = [
  { id: "sell", zh: "带货", en: "Selling" },
  { id: "seed", zh: "种草", en: "Lifestyle" },
  { id: "texture", zh: "质感", en: "Texture" },
  { id: "story", zh: "剧情", en: "Story" },
  { id: "place", zh: "场景", en: "Place" },
];
export interface DirectorStyle {
  id: string;
  zh: string;
  en: string;
  /// 给商家看的一句话：这种风格拍出来是什么感觉
  hintZh: string;
  hintEn: string;
  genre: "fmcg" | "lifestyle";
  group: DirectorStyleGroup;
}

export const DIRECTOR_STYLES: readonly DirectorStyle[] = [
  {
    id: DIRECTOR_LINE_TEMPLATE_ID,
    zh: "电商快销",
    en: "Fast e-commerce ad",
    hintZh: "两秒钩子、一个卖点一个镜头、硬切卡点、商品定格收尾",
    hintEn: "Two-second hook, one selling point per shot, hard cuts on the beat, product hold to close",
    genre: "fmcg",
    group: "sell",
  },
  {
    id: "tpl_emotion_story",
    zh: "情绪种草",
    en: "Emotion-led story",
    hintZh: "用的人笑起来最抓人：两三个正脸表情镜头穿插商品特写，暖亮的家里光线",
    hintEn: "The user's happy face sells it: two or three face-visible reactions between product close-ups, warm bright home light",
    genre: "fmcg",
    group: "seed",
  },
  {
    id: "tpl_pain_solution",
    zh: "痛点解决",
    en: "Problem then fix",
    hintZh: "先把最狼狈的那一下拍足，再用同一个机位拍用了之后",
    hintEn: "Show the worst moment properly, then the same framing after the product",
    genre: "fmcg",
    group: "sell",
  },
  {
    id: "tpl_texture_closeup",
    zh: "质感特写",
    en: "Texture close-ups",
    hintZh: "慢一点、近一点：材质微距、光在表面滑过，声音很轻，适合讲究用料的商品",
    hintEn: "Slower and closer: material macros, light gliding over surfaces, very quiet sound, for products that sell on materials",
    genre: "lifestyle",
    group: "texture",
  },
  {
    id: "tpl_unboxing_pov",
    zh: "开箱上手",
    en: "Unboxing in hand",
    hintZh: "第一人称拿到手：拆开、摸一摸、第一次用，像买家自己拍的",
    hintEn: "First-person in hand: open it, feel it, use it for the first time, like a buyer's own clip",
    genre: "fmcg",
    group: "sell",
  },
  {
    id: "tpl_proof_demo",
    zh: "卖点实测",
    en: "Proof test",
    hintZh: "只证明一个卖点：一个一眼看懂的小测试，一镜到底拍完",
    hintEn: "Prove one claim with one simple test, filmed in a single unbroken shot",
    genre: "fmcg",
    group: "sell",
  },
  {
    id: "tpl_three_reasons",
    zh: "三个理由",
    en: "Three reasons",
    hintZh: "三个卖点三段，每段一个动作一句话，节奏整齐好记",
    hintEn: "Three selling points in three equal beats, one action and one line each",
    genre: "fmcg",
    group: "sell",
  },
  {
    id: "tpl_offer_promo",
    zh: "促销快讯",
    en: "Offer spot",
    hintZh: "描述里写清优惠；先看值在哪再说优惠，价格只口播、画面不出字",
    hintEn: "Put the offer in your description: value first, then the deal; prices are only spoken, never drawn",
    genre: "fmcg",
    group: "sell",
  },
  {
    id: "tpl_question_answer",
    zh: "一问一答",
    en: "Question and answer",
    hintZh: "开头抛出买家最常问的那个问题，后面用演示来回答",
    hintEn: "Open with the question buyers ask most, then answer it by demonstration",
    genre: "fmcg",
    group: "sell",
  },
  {
    id: "tpl_ugc_review",
    zh: "真实测评",
    en: "Honest review",
    hintZh: "像买家自己拍的分享：第一人称旁白，边用边说真实感受",
    hintEn: "Like a buyer's own share: first-person voice-over, saying what it is like while using it",
    genre: "fmcg",
    group: "seed",
  },
  {
    id: "tpl_lifestyle_scene",
    zh: "生活方式",
    en: "Lifestyle scene",
    hintZh: "商品融进一个让人向往的生活片段，节奏舒缓、光线好看",
    hintEn: "The product inside a moment people want to live in; unhurried pace, beautiful light",
    genre: "lifestyle",
    group: "seed",
  },
  {
    id: "tpl_day_in_life",
    zh: "一天陪伴",
    en: "A day with it",
    hintZh: "早、午、晚三个时刻都用到它，看得出天天离不开",
    hintEn: "Morning, midday and evening: three moments that show it is used every day",
    genre: "fmcg",
    group: "seed",
  },
  {
    id: "tpl_gift_moment",
    zh: "送礼时刻",
    en: "Gift moment",
    hintZh: "包好、递出去、对方打开时的惊喜，适合礼品和节日",
    hintEn: "Wrapped, handed over, and the surprise when it is opened; for gifts and holidays",
    genre: "lifestyle",
    group: "seed",
  },
  {
    id: "tpl_scene_montage",
    zh: "一物多用",
    en: "Many uses",
    hintZh: "同一件商品换三个场合快切，一眼看出哪儿都用得上",
    hintEn: "One product in three settings, cut fast, so it clearly fits everywhere",
    genre: "fmcg",
    group: "seed",
  },
  {
    id: "tpl_still_life",
    zh: "静物大片",
    en: "Still life",
    hintZh: "不出人：商品摆在布好的台面上，只有光在动，像杂志硬照",
    hintEn: "No people: the product on a styled surface, only the light moves, like a magazine still",
    genre: "lifestyle",
    group: "texture",
  },
  {
    id: "tpl_asmr_immersive",
    zh: "沉浸声音",
    en: "Sound first",
    hintZh: "几乎不说话，只听拆、按、倒、合的声音，近景慢拍",
    hintEn: "Almost no talking: just the sounds of opening, pressing, pouring and closing, shot close and slow",
    genre: "lifestyle",
    group: "texture",
  },
  {
    id: "tpl_launch_reveal",
    zh: "新品亮相",
    en: "Launch reveal",
    hintZh: "先藏后露：暗场里一道光扫出轮廓，再整件亮相，有发布会的感觉",
    hintEn: "Hide, then reveal: a beam finds the outline in the dark, then the full product appears",
    genre: "lifestyle",
    group: "texture",
  },
  {
    id: "tpl_fashion_wear",
    zh: "上身穿搭",
    en: "Worn and styled",
    hintZh: "穿戴类：上身之后的垂感、轮廓和走动，动作少而准",
    hintEn: "For things you wear: drape, outline and movement once it is on, with few precise gestures",
    genre: "lifestyle",
    group: "texture",
  },
  {
    id: "tpl_everyday_comedy",
    zh: "日常轻喜剧",
    en: "Light comedy",
    hintZh: "一个生活里的小尴尬，靠反应好笑，商品轻松化解",
    hintEn: "A small everyday mishap, funny through the reaction, solved lightly by the product",
    genre: "fmcg",
    group: "story",
  },
  {
    id: "tpl_relationship_story",
    zh: "温情小剧场",
    en: "Small story",
    hintZh: "两个人之间一个小动作的故事，商品是那份心意",
    hintEn: "A short story of one small gesture between two people; the product is the gesture",
    genre: "lifestyle",
    group: "story",
  },
  {
    id: "tpl_place_tour",
    zh: "探厂探店",
    en: "Factory or store tour",
    hintZh: "上传场地照片，带买家走一遍真实的厂房或门店，最后落到商品",
    hintEn: "Upload photos of the place: a walk through the real factory or store, ending on the product",
    genre: "fmcg",
    group: "place",
  },
];

/** 新人向导里先摆出来的几种（其余在创作页的下拉里）。 */
export const DIRECTOR_FEATURED_STYLE_IDS: readonly string[] = [
  DIRECTOR_LINE_TEMPLATE_ID,
  "tpl_emotion_story",
  "tpl_pain_solution",
  "tpl_texture_closeup",
  "tpl_unboxing_pov",
  "tpl_place_tour",
];

export function directorStyle(id: string | null | undefined): DirectorStyle | null {
  const key = id?.trim();
  return key ? DIRECTOR_STYLES.find((style) => style.id === key) ?? null : null;
}

/** 导演线路做得了的时长：都是一次生成。 */
export const DIRECTOR_LINE_DURATIONS: readonly number[] = [15, 30];

export interface DirectorLineRequest {
  durationSec: number;
  /// 商家实拍图张数：没有实拍图不凭空画商品
  productImageCount: number;
  /// 主播参考图：导演线路不把真人照片带给出片模型
  personImageCount?: number;
  /// null / undefined = 「自动匹配」
  styleTemplateId?: string | null;
}

export type DirectorLineBlocker = "no_product_photo" | "duration" | "person_reference" | "template";

/**
 * 这条片导演线路做不做得了；做不了返回原因（2026-11-17 起导演线路是唯一的出片方式，没有退路）。
 * 客户端用它提前把按钮说明白，服务端用同一条规则拒绝。
 */
export function directorLineBlocker(input: DirectorLineRequest): DirectorLineBlocker | null {
  if (input.productImageCount < 1) return "no_product_photo";
  if (!DIRECTOR_LINE_DURATIONS.includes(input.durationSec)) return "duration";
  if ((input.personImageCount ?? 0) > 0) return "person_reference";
  const template = input.styleTemplateId?.trim() || null;
  if (template !== null && !directorStyle(template)) return "template";
  return null;
}

export function directorLineApplies(input: DirectorLineRequest): boolean {
  return directorLineBlocker(input) === null;
}

/** 做不了时给商家看的话（服务端拒绝时原样返回）。 */
export const DIRECTOR_LINE_BLOCKER_MESSAGE: Record<DirectorLineBlocker, string> = {
  no_product_photo: "请先上传至少一张商品实拍图：片子里的商品是照着你的图拍的，没有图就会走样。",
  duration: "现在只做 15 秒和 30 秒的片，请改一下时长。",
  person_reference: "现在不支持主播参考图，请去掉后再提交。",
  template: "这个模板已经下线，请在「创意模板」里换一种风格，或用「自动匹配」。",
};

/** 给故事板面板看的脚本摘要：一句话梗概、场景卡、每个镜头做什么、哪句台词在哪个镜头。 */
export interface DirectorScriptView {
  logline: string;
  genre: "fmcg" | "lifestyle";
  productType: string;
  scenario: {
    who: string;
    where: string;
    moment: string;
    trouble: string;
    after: string;
    emotion: string;
  } | null;
  shots: Array<{
    index: number;
    fromSec: number;
    toSec: number;
    /// 写给出片模型的画面描述（英文原文）
    action: string;
    /// 给商家看的一句话：这一镜拍什么（商家的语言）。旧脚本没有 = null，界面退回显示英文原文
    note: string | null;
    /// 这个镜头里念的台词；没有台词是 null
    line: string | null;
  }>;
}
