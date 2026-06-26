/**
 * 数字人探店广告 · 导演（Director）
 * ==================================================================
 *
 * 把「一张模特图 + 真实门店照片 + 行业信息」编排成一条 ~30s 竖版探店广告的
 * 结构化分镜（storyboard）。这是数字人管线的「编导思维」层——可被交付脚本与
 * 后续产品化的 dispatch 复用。
 *
 * 每个镜头（StoreAdShot）描述：
 *   - sceneType         model_store（模特在门店里）/ product_cutaway（产品/宠物空镜）
 *   - keyframePrompt     gpt-image images.edit 的合成指令（把模特放进门店场景，身份一致）
 *   - motionPrompt       Seedance i2v 的运镜/动作（英文，禁止任何文字/水印/logo）
 *   - caption            烧录用中文字幕（探店口播感）
 *   - storeRef           用哪张门店参考图（model_store 必填）
 *
 * 设计取舍：
 *   - 镜头数量 / 时长 / 用哪张店图 = 确定性模板（保证成片节奏与可拼接性）；
 *   - 客户最终看到的「中文字幕文案」交给 gpt-5.5（director tier）生成，
 *     更有探店网感；LLM 失败时回退到内置文案，绝不阻断出片。
 */

import { chatJsonByTier, isLLMForcedMock } from "@/lib/providers/openai";

export type StoreRefKey = "store-1" | "store-2" | "store-3";

export interface StoreAdShot {
  id: string;
  sceneType: "model_store" | "product_cutaway";
  durationSec: number;
  /// 烧录中文字幕（探店口播语气）
  caption: string;
  /// gpt-image images.edit 合成关键帧的英文指令（model_store 才有）
  keyframePrompt?: string;
  /// Seedance i2v 运镜/动作（英文）
  motionPrompt: string;
  /// 该镜头使用的门店参考图（model_store 必填）
  storeRef?: StoreRefKey;
}

export interface StoreAdBrief {
  /// 行业 / 店铺类型（如「宠物店 / 猫咪主题店」）
  industry: string;
  /// 门店一句话描述（喂给 LLM 写文案用）
  storeDescription: string;
  /// 模特一句话描述
  modelDescription: string;
  /// 品牌名（尾卡 / CTA 用）
  brandName?: string;
}

/* ------------------------------------------------------------------ */
/* 关键帧合成的共享风格约束（所有 model_store 镜头共用）                   */
/* ------------------------------------------------------------------ */

const KEYFRAME_STYLE = [
  "Photorealistic, vertical 9:16 composition.",
  "Use the FIRST reference image strictly as the woman's identity anchor:",
  "keep her exact face, facial features, skin tone, hairstyle and youthful look unchanged.",
  "Place her naturally inside the real pet store shown in the OTHER reference image(s),",
  "matching that store's real lighting, the soft pastel light-blue / white / pink palette,",
  "the cat-themed decor, shelves and furniture. Keep the store clearly recognizable.",
  "She wears the SAME exact outfit in every single shot for continuity:",
  "a cream / beige knit cardigan over a black top, with blue denim jeans.",
  "She has a warm, friendly expression looking at the camera.",
  "Her hands are free and empty unless this shot explicitly says she holds something.",
  "Natural candid vlog framing, shallow depth of field.",
  "Absolutely NO on-screen text, NO captions, NO watermark, NO logo, NO brand names, NO UI elements.",
].join(" ");

const MOTION_STYLE = [
  "Vertical 9:16, realistic, soft natural daylight, cozy探店 vlog mood.",
  "Keep the same young woman with a consistent face throughout.",
  "Gentle, natural human motion; subtle slow camera push-in or pan.",
  "She gestures lightly and looks warmly at the camera as if talking to viewers.",
  "Smooth, premium, stable. NO text, NO captions, NO watermark, NO logo anywhere in frame.",
].join(" ");

/* ------------------------------------------------------------------ */
/* 确定性分镜模板（6 镜，约 28s + 尾卡）                                   */
/* ------------------------------------------------------------------ */

function baseStoryboard(): StoreAdShot[] {
  return [
    {
      id: "01-storefront",
      sceneType: "model_store",
      durationSec: 5,
      storeRef: "store-3",
      caption: "在多伦多挖到一家超治愈的猫咪主题店🐾",
      keyframePrompt:
        "Show the storefront / entrance: the woman stands just outside the shop's glass entrance door, " +
        "about to walk in, smiling at the camera. Extend the scene into a cute pastel cat-themed shop front " +
        "(soft sign above the glass door) consistent with the interior's light-blue/white/pink style. Bright daytime.",
      motionPrompt:
        "The woman stands at the pet shop entrance and turns to the camera with a welcoming smile, then steps toward the glass door to enter. Slow push-in.",
    },
    {
      id: "02-catroom",
      sceneType: "model_store",
      durationSec: 5,
      storeRef: "store-1",
      caption: "一进门就是透明猫舍，寄养也能天天看到主子",
      keyframePrompt:
        "Show the woman standing next to the large glass cat boarding room with wooden cat trees inside, " +
        "gesturing toward the glass enclosure as she introduces the cat boarding area.",
      motionPrompt:
        "The woman gestures toward the glass cat room and looks back at the camera, explaining warmly. Gentle handheld motion.",
    },
    {
      id: "03-shelf",
      sceneType: "model_store",
      durationSec: 4,
      storeRef: "store-2",
      caption: "这一排全是店主精挑的好物，闭眼入不踩雷",
      keyframePrompt:
        "Show the woman standing in front of the product shelves, picking up a cute pet product " +
        "and presenting it to the camera with an excited expression.",
      motionPrompt:
        "The woman picks up a pet product from the shelf and shows it to the camera, smiling. Subtle slow zoom on the product.",
    },
    {
      id: "04-cat-cutaway",
      sceneType: "product_cutaway",
      durationSec: 4,
      caption: "连猫粮都是现场试吃款，主子吃得比我还香",
      motionPrompt:
        "(product cutaway — uses existing real cat footage; no model)",
    },
    {
      id: "05-counter",
      sceneType: "model_store",
      durationSec: 5,
      storeRef: "store-2",
      caption: "办张会员卡，洗护寄养全都打折",
      keyframePrompt:
        "Show the woman standing at the white wooden reception counter (with the lucky-cat figurine on it), " +
        "leaning lightly on the counter and talking to the camera about membership.",
      motionPrompt:
        "The woman leans on the white reception counter and talks to the camera cheerfully, one hand gesturing. Slow push-in.",
    },
    {
      id: "06-ending",
      sceneType: "model_store",
      durationSec: 5,
      storeRef: "store-3",
      caption: "这种店真的可以承包我的周末，地址放评论区～",
      keyframePrompt:
        "Show the woman near the cozy window seating area gently holding or petting a cute cat, " +
        "smiling happily at the camera as a warm closing shot.",
      motionPrompt:
        "The woman holds/pets a cute cat near the window seat and gives a warm closing smile to the camera. Soft, heartwarming, slow motion.",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * 生成探店分镜。结构（镜头/时长/店图）固定；中文字幕用 gpt-5.5 改写得更有网感，
 * 失败时回退到内置文案。
 */
export async function buildStoreAdStoryboard(
  brief: StoreAdBrief,
): Promise<{ shots: StoreAdShot[]; captionsFromLLM: boolean }> {
  const shots = baseStoryboard();

  if (isLLMForcedMock() || !process.env.OPENAI_API_KEY) {
    return { shots, captionsFromLLM: false };
  }

  try {
    const system = [
      "你是中文短视频探店广告的资深编导兼文案。",
      "给定一条探店广告的分镜结构，请为每个镜头写一句『烧录字幕』：",
      "- 中文，口语化、有探店网感、真实不浮夸；",
      "- 每句 ≤ 18 个汉字，可带 1 个 emoji（非必须）；",
      "- 贴合该镜头画面意图；最后一镜要有行动号召感。",
      "只输出 JSON：{\"captions\": string[]}，数组长度与镜头数一致，按镜头顺序。",
    ].join("\n");

    const user = JSON.stringify({
      industry: brief.industry,
      store: brief.storeDescription,
      model: brief.modelDescription,
      brand: brief.brandName ?? null,
      shots: shots.map((s) => ({
        id: s.id,
        intent: s.sceneType === "product_cutaway" ? "产品/宠物空镜" : s.caption,
      })),
    });

    const res = await chatJsonByTier<{ captions?: string[] }>({
      tier: "director",
      stage: "digital_human_store_ad_captions",
      system,
      user,
      maxTokens: 800,
    });

    const captions = res.data.captions;
    if (Array.isArray(captions) && captions.length === shots.length) {
      captions.forEach((c, i) => {
        if (typeof c === "string" && c.trim()) shots[i].caption = c.trim();
      });
      return { shots, captionsFromLLM: true };
    }
  } catch (err) {
    console.warn(
      "[store-ad-director] gpt-5.5 字幕生成失败，回退内置文案：",
      (err as Error).message,
    );
  }

  return { shots, captionsFromLLM: false };
}

export { KEYFRAME_STYLE, MOTION_STYLE };
