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
 * 现在 20 种，分五组。分类参照了 Shuyu 创作台公开的预设与方法清单（商品卖点可视化、开箱与首次体验、促销信息短片、
 * 生活方式场景广告、自然口播测评、配饰与穿搭质感广告、关系短剧、日常轻喜剧——它自己注明改编自 Topview / SeaArt / iart 等开源方法），
 * 再补上常见的带货拍法。只取分类和做法，拍法要求是我们按自己的导演规则写的，没有搬原文。
 *
 * 加一种风格：在这里加一行。brief 只写拍法（开场、节奏、光、人怎么出镜、口播和配乐的语气），不写商品事实；
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
    group: "sell",
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
    group: "seed",
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
    group: "sell",
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
    group: "texture",
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
    group: "sell",
    brief:
      "First-person unboxing and first use, like a buyer's own phone clip. The camera is the buyer: only their two hands are seen. Shot 1 opens on the two hands opening the package or lifting the product into frame, not on a trouble moment; turn it once to show what it is, touch the detail that matters, then use it for the first time in the place it belongs. Natural room light, slight handheld breathing, close and medium-close shots. A friendly casual voice as if talking to a friend; light upbeat background beat.",
  },
  {
    id: "tpl_proof_demo",
    zh: "卖点实测",
    en: "Proof test",
    hintZh: "只证明一个卖点：一个一眼看懂的小测试，一镜到底拍完",
    hintEn: "Prove one claim with one simple test, filmed in a single unbroken shot",
    genre: "fmcg",
    group: "sell",
    brief:
      "Proof film. Pick the single claim that matters most and prove it with one simple test a viewer understands at a glance. Shot 1 sets the test up as an action. The proof itself is one unbroken shot of four to six seconds with a locked camera, so the result is seen happening, never cut around. One shot of the product before, one after. Bright even light, plain background, hands only. A plain, confident voice that states what is being tested and what happened; a light steady beat that pauses on the result.",
  },
  {
    id: "tpl_three_reasons",
    zh: "三个理由",
    en: "Three reasons",
    hintZh: "三个卖点三段，每段一个动作一句话，节奏整齐好记",
    hintEn: "Three selling points in three equal beats, one action and one line each",
    genre: "fmcg",
    group: "sell",
    brief:
      "Three-reasons ad. After a two-second hook, give exactly three selling points as three equal beats; each beat is one action with a visible result and one short spoken line that begins by counting it in the merchant's language (first, second, third). Use the same framing rhythm for all three so the count is felt. Hard cuts on the beat, bright clean light, product large in frame, hands do the work. End on the product hold with the call to action. An energetic, clear voice; a pop beat with one accent per reason.",
  },
  {
    id: "tpl_offer_promo",
    zh: "促销快讯",
    en: "Offer spot",
    hintZh: "描述里写清优惠；先看值在哪再说优惠，价格只口播、画面不出字",
    hintEn: "Put the offer in your description: value first, then the deal; prices are only spoken, never drawn",
    genre: "fmcg",
    group: "sell",
    brief:
      "Offer spot. First half: show what the buyer gets, as two or three quick actions with visible results, so the value is clear before any deal is mentioned. Second half: the offer, stated only in spoken lines and only with facts given in the description (never invent a price, discount, deadline or quantity; if none is given, say only that it is available now). Show quantity physically, such as the full set laid out or a second pack placed beside the first. Bright light, fast hard cuts. An upbeat, direct voice with urgency but no shouting; a driving beat that lifts on the final product hold.",
  },
  {
    id: "tpl_question_answer",
    zh: "一问一答",
    en: "Question and answer",
    hintZh: "开头抛出买家最常问的那个问题，后面用演示来回答",
    hintEn: "Open with the question buyers ask most, then answer it by demonstration",
    genre: "fmcg",
    group: "sell",
    brief:
      "Question and answer. Shot 1 is the buyer's most common doubt about this kind of product, spoken as a short question in voice-over while the picture shows the doubtful moment as one physical action. Every following shot answers by demonstration, one action with a visible result, never by a person explaining to camera. Close with the product hold and a line that turns the answer into the reason to buy. Bright everyday light, hands and partial figures, at most one face-visible reaction. A friendly, knowing voice; a light beat.",
  },
  {
    id: "tpl_ugc_review",
    zh: "真实测评",
    en: "Honest review",
    hintZh: "像买家自己拍的分享：第一人称旁白，边用边说真实感受",
    hintEn: "Like a buyer's own share: first-person voice-over, saying what it is like while using it",
    genre: "fmcg",
    group: "seed",
    brief:
      "Honest buyer review, as a phone clip. A first-person voice-over in a casual tone, like telling a friend; nobody talks to the lens. The reviewer's hands use the product in an ordinary home, with one face-visible moment looking at the product, not at the camera. Order: what I worried about, what happened when I used it, the one detail I like most, who it suits. Only observable facts from the description and photos, with no superlatives and no medical or absolute claims. Natural window light, slight handheld movement, medium-close shots. Very light background music under the voice.",
  },
  {
    id: "tpl_lifestyle_scene",
    zh: "生活方式",
    en: "Lifestyle scene",
    hintZh: "商品融进一个让人向往的生活片段，节奏舒缓、光线好看",
    hintEn: "The product inside a moment people want to live in; unhurried pace, beautiful light",
    genre: "lifestyle",
    group: "seed",
    brief:
      "Lifestyle scene. The product belongs to one calm, desirable moment of daily life in one place. Shot 1 opens on that place in its light, with the product already part of the scene, not on a trouble moment. Two to four unhurried shots: the person arrives at the moment, uses the product once with one clear gesture, enjoys the result. One face-visible shot with a relaxed expression, looking away from the lens. Warm directional light from one named source, soft shadows, shallow focus, slow push-ins. One or two quiet lines about how it feels; a mellow acoustic or lo-fi bed.",
  },
  {
    id: "tpl_day_in_life",
    zh: "一天陪伴",
    en: "A day with it",
    hintZh: "早、午、晚三个时刻都用到它，看得出天天离不开",
    hintEn: "Morning, midday and evening: three moments that show it is used every day",
    genre: "fmcg",
    group: "seed",
    brief:
      "A day with the product. Three moments of one day in time order, morning, midday and evening, each a short beat where the product does its job once in the place it would really be used. Name the time through the light in each beat (cool early window light, bright midday, warm lamp). Keep the same person throughout, described once; partial figure and hands, with one face-visible smile in the evening beat. Hard cuts between times of day. Short lines that mark the time and the benefit; a light beat that warms toward the end. Finish on the product hold.",
  },
  {
    id: "tpl_gift_moment",
    zh: "送礼时刻",
    en: "Gift moment",
    hintZh: "包好、递出去、对方打开时的惊喜，适合礼品和节日",
    hintEn: "Wrapped, handed over, and the surprise when it is opened; for gifts and holidays",
    genre: "lifestyle",
    group: "seed",
    brief:
      "Gift moment. Shot 1 opens on two hands closing a plain gift box or tying a ribbon around the product, not on a trouble moment. Then the handover seen from the giver's side, the receiver opening it, and one face-visible delighted reaction of the receiver looking at the gift. One close shot shows the detail that makes it worth giving. The giver appears only as hands and sleeves. Warm indoor light, shallow focus, gentle movement. One warm line about who it is for and one about why it is a good gift; soft piano or acoustic guitar. End on the product hold beside the opened box.",
  },
  {
    id: "tpl_scene_montage",
    zh: "一物多用",
    en: "Many uses",
    hintZh: "同一件商品换三个场合快切，一眼看出哪儿都用得上",
    hintEn: "One product in three settings, cut fast, so it clearly fits everywhere",
    genre: "fmcg",
    group: "seed",
    brief:
      "Many-uses montage. The same product in three different places or uses, each a two to three second beat showing one action with a visible result. Hold the product at a similar size and position in the frame across the three beats so the cuts feel matched. Change the place and the light clearly between beats and restate the product's look in every beat so it stays identical. Hands and partial figures, at most one face-visible reaction. Punchy lines that name each use; an upbeat pop track with a hit on each cut. End on the product hold.",
  },
  {
    id: "tpl_still_life",
    zh: "静物大片",
    en: "Still life",
    hintZh: "不出人：商品摆在布好的台面上，只有光在动，像杂志硬照",
    hintEn: "No people: the product on a styled surface, only the light moves, like a magazine still",
    genre: "lifestyle",
    group: "texture",
    brief:
      "Still-life film. No people and no hands. Shot 1 opens on the product resting on one styled surface with two or three plain props that suit it, not on a trouble moment. The product stays still in every shot; only the light and the camera move: a slow light sweep, a slow push-in, one slow rack focus from a prop to the product. Three or four shots of four seconds or longer. One named light source, long soft shadows, a restrained palette taken from the product's own colours. At most two quiet lines; sparse ambient music with room tone.",
  },
  {
    id: "tpl_asmr_immersive",
    zh: "沉浸声音",
    en: "Sound first",
    hintZh: "几乎不说话，只听拆、按、倒、合的声音，近景慢拍",
    hintEn: "Almost no talking: just the sounds of opening, pressing, pouring and closing, shot close and slow",
    genre: "lifestyle",
    group: "texture",
    brief:
      "Sound-first immersive film. The product's own sounds lead: each shot is one slow, deliberate hand action in close-up, and the sound line names the exact sound that action makes. Shot 1 opens on the first touch of the product, not on a trouble moment. No music until the last shot, and then only a soft pad. Spoken words are limited to one short whispered line on the final product hold. Hands only, clean nails, slow precise movements. Soft top light on a quiet plain surface, very shallow focus, locked camera.",
  },
  {
    id: "tpl_launch_reveal",
    zh: "新品亮相",
    en: "Launch reveal",
    hintZh: "先藏后露：暗场里一道光扫出轮廓，再整件亮相，有发布会的感觉",
    hintEn: "Hide, then reveal: a beam finds the outline in the dark, then the full product appears",
    genre: "lifestyle",
    group: "texture",
    brief:
      "Launch reveal. Shot 1 opens on the product as a dark silhouette on a dark plain surface while a narrow beam of light begins to cross it, not on a trouble moment. Then the light finds one detail, then a second detail, then the whole product is revealed in full even light and held. Four or five shots; the product does not move, the light does. One hand may enter once to lift or turn it slightly in the final reveal. Controlled studio light with a single key and a soft rim. A low, assured voice with two short lines; music that builds from a low pulse to one clean hit on the reveal.",
  },
  {
    id: "tpl_fashion_wear",
    zh: "上身穿搭",
    en: "Worn and styled",
    hintZh: "穿戴类：上身之后的垂感、轮廓和走动，动作少而准",
    hintEn: "For things you wear: drape, outline and movement once it is on, with few precise gestures",
    genre: "lifestyle",
    group: "texture",
    brief:
      "Worn-and-styled film, for things a person wears or carries. Shot 1 opens on the item already worn, cropped from the shoulders down, as the wearer takes one step into the light, not on a trouble moment. Show drape, outline and how it moves with a few restrained gestures: a turn, a hand smoothing the fabric, a close shot of one material detail, a walking shot from behind. At most one face-visible shot, in profile, looking away from the lens. Keep the item's colour and pattern exactly as photographed. Soft daylight or a clean studio wall. Two short lines about material and fit; a minimal, confident beat.",
  },
  {
    id: "tpl_everyday_comedy",
    zh: "日常轻喜剧",
    en: "Light comedy",
    hintZh: "一个生活里的小尴尬，靠反应好笑，商品轻松化解",
    hintEn: "A small everyday mishap, funny through the reaction, solved lightly by the product",
    genre: "fmcg",
    group: "story",
    brief:
      "Light everyday comedy. One small, harmless mishap that everyone recognises, shown as a physical action, followed by a one-second pause on a deadpan face-visible reaction: the reaction carries the joke, not a punchline. Then the product solves it with one easy action and the same person gives a small satisfied look. One person on screen, described once; nobody is mocked or hurt. Bright flat everyday light, locked or gently handheld camera, hard cuts timed for comedy. A dry, amused voice-over; playful pizzicato or light percussion that stops dead on the pause.",
  },
  {
    id: "tpl_relationship_story",
    zh: "温情小剧场",
    en: "Small story",
    hintZh: "两个人之间一个小动作的故事，商品是那份心意",
    hintEn: "A short story of one small gesture between two people; the product is the gesture",
    genre: "lifestyle",
    group: "story",
    brief:
      "A small story between two people, told through one gesture. Shot 1 opens on one person noticing the other's small need, shown as an action, not on a product shot. The product enters as the answer to that need: it is quietly prepared, handed over or put in place, and the second person's response closes the story with a look or a touch, not a speech. Only one person is ever face-visible; the other appears as hands, back or shoulder. No dialogue between them: one voice-over line near the start and one at the end. Warm home light, slow gentle movement; soft piano. End on the product in use.",
  },
  {
    id: "tpl_place_tour",
    zh: "探厂探店",
    en: "Factory or store tour",
    hintZh: "上传场地照片，带买家走一遍真实的厂房或门店，最后落到商品",
    hintEn: "Upload photos of the place: a walk through the real factory or store, ending on the product",
    genre: "fmcg",
    group: "place",
    brief:
      "Place tour (use the PLACE TOUR rules). A first-person walk through the real spaces in the photos, in the order a visitor meets them: entrance, then each working area, then the finished goods. Alternate wide walking shots with hands-only close-ups of the work. Keep buildings, signs and layouts exactly as photographed. A lively host-style narration, one fact per shot; light upbeat beat.",
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
