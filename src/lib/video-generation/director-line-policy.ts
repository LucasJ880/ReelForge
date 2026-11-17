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
 * 每种风格 = 片种 + 一段给导演写手的拍法要求（英文，直接拼进写手的用户消息）。「自动匹配」不在这张表里：
 * 那是不给要求，由写手按商品自己定。老的 34 个模板（另一套做法）已经下线。
 *
 * 加一种风格：在这里加一行。brief 只写拍法（钩子、节奏、光、人怎么出镜、口播和配乐的语气），不写商品事实；
 * 它不能和导演规则冲突（时间线、露脸写法、全程英文这些仍由校验把关）。
 */
export interface DirectorStyle {
  id: string;
  zh: string;
  en: string;
  /// 给商家看的一句话：这种风格拍出来是什么感觉
  hintZh: string;
  hintEn: string;
  genre: "fmcg" | "lifestyle";
  brief: string;
}

export const DIRECTOR_STYLES: readonly DirectorStyle[] = [
  {
    id: DIRECTOR_LINE_TEMPLATE_ID,
    zh: "电商快销",
    en: "Fast e-commerce ad",
    hintZh: "两秒钩子、一个卖点一个镜头、硬切卡点、商品定格收尾",
    hintEn: "Two-second hook, one selling point per shot, hard cuts on the beat, product hold to close",
    genre: "fmcg",
    brief:
      "Fast e-commerce ad. Hook with the trouble moment as one physical action. Then one selling point per shot, each an action with a visible result, hard cuts on the beat, bright clean daylight, the product large in frame. Hands do most of the work; at most one face-visible reaction. Punchy upbeat lines, one per selling point; pop beat with claps.",
  },
  {
    id: "tpl_emotion_story",
    zh: "情绪种草",
    en: "Emotion-led story",
    hintZh: "用的人笑起来最抓人：两三个正脸表情镜头穿插商品特写，暖亮的家里光线",
    hintEn: "The user's happy face sells it: two or three face-visible reactions between product close-ups, warm bright home light",
    genre: "fmcg",
    brief:
      "Emotion-led e-commerce ad. Shot 1 opens on the person who uses the product in the best moment it gives them, face visible, mid-laugh or delighted, the product clearly in the picture; the trouble is only told by contrast in a later shot. Give three face-visible reaction shots of that same person across the film, each separated by a product close-up that shows one selling point as an action with a visible result. Warm bright home daylight, soft backgrounds, gentle handheld. A warm caring voice; light acoustic pop with ukulele or soft guitar. End on the product hold.",
  },
  {
    id: "tpl_pain_solution",
    zh: "痛点解决",
    en: "Problem then fix",
    hintZh: "先把最狼狈的那一下拍足，再用同一个机位拍用了之后",
    hintEn: "Show the worst moment properly, then the same framing after the product",
    genre: "fmcg",
    brief:
      "Problem then solution. Spend the first two shots on the trouble without the product: the visible mess or struggle, in flat everyday light. Cut to the product entering the scene, then repeat the first trouble framing with the product in use so the difference is seen in the same composition. One proof shot of the core selling point as action and visible result. Lines start as a complaint and turn confident; the music lifts when the product appears.",
  },
  {
    id: "tpl_texture_closeup",
    zh: "质感特写",
    en: "Texture close-ups",
    hintZh: "慢一点、近一点：材质微距、光在表面滑过，声音很轻，适合讲究用料的商品",
    hintEn: "Slower and closer: material macros, light gliding over surfaces, very quiet sound, for products that sell on materials",
    genre: "lifestyle",
    brief:
      "Texture film. Shot 1 opens on a macro of the material with light gliding across it, not on a trouble moment. Slow and close throughout: macro shots of material, stitching, surface and edges, with light from one named source. Hands touch, press, fold or pour once per shot, unhurried. No faces. Soft side light with gentle shadows, shallow focus. Sound comes first: the material's own sounds are clear; two or three quiet lines at most; a sparse piano or ambient bed.",
  },
  {
    id: "tpl_unboxing_pov",
    zh: "开箱上手",
    en: "Unboxing in hand",
    hintZh: "第一人称拿到手：拆开、摸一摸、第一次用，像买家自己拍的",
    hintEn: "First-person in hand: open it, feel it, use it for the first time, like a buyer's own clip",
    genre: "fmcg",
    brief:
      "First-person unboxing and first use, like a buyer's own phone clip. The camera is the buyer: only their two hands are seen. Shot 1 opens on the two hands opening the package or lifting the product into frame, not on a trouble moment; turn it once to show what it is, touch the detail that matters, then use it for the first time in the place it belongs. Natural room light, slight handheld breathing, close and medium-close shots. A friendly casual voice as if talking to a friend; light upbeat background beat.",
  },
  {
    id: "tpl_place_tour",
    zh: "探厂探店",
    en: "Factory or store tour",
    hintZh: "带买家走一遍真实的厂房或门店：大门、车间、做工特写，最后落到商品",
    hintEn: "Walk the buyer through the real factory or store: entrance, floor, close-ups of the work, ending on the product",
    genre: "fmcg",
    brief:
      "Place tour (use the PLACE TOUR rules). A first-person walk through the real spaces in the photos, in the order a visitor meets them: entrance, then each working area, then the finished goods. Alternate wide walking shots with hands-only close-ups of the work. Keep buildings, signs and layouts exactly as photographed. A lively host-style narration, one fact per shot; light upbeat beat.",
  },
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
