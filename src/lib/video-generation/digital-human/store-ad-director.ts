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
  "She is actively talking to the camera the entire time, like a vlogger introducing the store:",
  "her mouth and lips open and close naturally and continuously with clear, lively, well-articulated speaking movements,",
  "matched by lifelike facial expression, subtle eye contact, light head nods and natural hand gestures.",
  "Never a frozen, closed or stiff mouth — she should look like she is genuinely speaking out loud.",
  "Gentle, natural human motion; subtle slow camera push-in or pan.",
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
        "The woman stands at the pet shop entrance, turns to the camera with a welcoming smile and starts talking to the viewers — her lips clearly and continuously moving as she speaks — then steps toward the glass door to enter. Slow push-in.",
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
        "The woman gestures toward the glass cat room and looks back at the camera, talking continuously and explaining warmly with clearly visible, naturally moving lips. Gentle handheld motion.",
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
        "The woman picks up a pet product from the shelf and shows it to the camera while talking about it, her lips moving naturally and continuously as she speaks, smiling. Subtle slow zoom on the product.",
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
        "The woman leans on the white reception counter and keeps talking to the camera cheerfully, her lips opening and closing naturally and continuously as she speaks, one hand gesturing. Slow push-in.",
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
        "The woman holds/pets a cute cat near the window seat while talking warmly to the camera — her lips moving naturally as she speaks — then gives a warm closing smile. Soft, heartwarming, slow motion.",
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

/* ================================================================== */
/* 产品化（动态）分镜：任意行业 + 任意张数店铺实景图                      */
/* ================================================================== */

export interface DynamicStoreAdBrief {
  industry: string;
  storeDescription?: string;
  sellingPoints?: string[];
  cta?: string;
  brandName?: string;
  storeImageCount: number;
  durationSec: number;
}

export interface DynamicStoreAdShot {
  id: string;
  durationSec: number;
  storeImageIndex: number;
  caption: string;
  scene: string;
  action: string;
}

function planShotDurations(durationSec: number): number[] {
  const safeTotal = Math.max(8, Math.min(60, Math.round(durationSec)));
  const count = Math.max(3, Math.min(6, Math.round(safeTotal / 5)));
  const base = Math.floor(safeTotal / count);
  const durations = Array.from({ length: count }, () => base);
  let remainder = safeTotal - base * count;
  for (let i = 0; remainder > 0; i = (i + 1) % count) {
    durations[i] += 1;
    remainder -= 1;
  }
  return durations;
}

function fallbackDynamicShots(brief: DynamicStoreAdBrief): DynamicStoreAdShot[] {
  const durations = planShotDurations(brief.durationSec);
  const points = brief.sellingPoints?.filter((p) => p.trim()) ?? [];
  return durations.map((dur, i) => {
    const isFirst = i === 0;
    const isLast = i === durations.length - 1;
    const point = points[i % Math.max(1, points.length)] || brief.industry;
    return {
      id: `shot-${String(i + 1).padStart(2, "0")}`,
      durationSec: dur,
      storeImageIndex: i % Math.max(1, brief.storeImageCount),
      caption: isFirst
        ? `带你逛逛这家${brief.industry}`
        : isLast
          ? brief.cta?.trim() || "地址放评论区，快冲～"
          : `${point}真的可以`,
      scene: isFirst
        ? `站在这家${brief.industry}的入口/门面前，面向镜头微笑准备介绍`
        : isLast
          ? `在店内温馨区域，对镜头微笑作收尾`
          : `在店内介绍：${point}`,
      action: isFirst
        ? "面向镜头自然微笑打招呼，缓慢推近"
        : isLast
          ? "对镜头温暖微笑收尾，轻微手势"
          : "看向镜头热情介绍，轻微手势，缓慢运镜",
    };
  });
}

/**
 * 产品化动态分镜：根据行业 + 上传店铺图数量 + 时长，生成 N 个 model_store 镜头。
 * 镜头数/时长/用第几张图是确定性的；每个镜头的「中文字幕 + 场景 + 动作」用
 * gpt-5.5 生成得更有探店网感，失败时回退到内置模板，绝不阻断出片。
 */
export async function buildDynamicStoreAdStoryboard(
  brief: DynamicStoreAdBrief,
): Promise<{ shots: DynamicStoreAdShot[]; captionsFromLLM: boolean }> {
  const skeleton = fallbackDynamicShots(brief);

  if (isLLMForcedMock() || !process.env.OPENAI_API_KEY) {
    return { shots: skeleton, captionsFromLLM: false };
  }

  try {
    const system = [
      "你是中文短视频探店广告的资深编导兼文案。",
      "给定一家店的行业、描述、卖点，以及一个固定的分镜骨架（镜头数、每镜时长、用第几张实景图），",
      "请为每个镜头产出三段中文内容：",
      "- caption：烧录字幕，口语化、有探店网感、真实不浮夸，≤18 个汉字，可带 1 个 emoji；",
      "- scene：该镜头里出镜女生在店内的位置/在做什么（用于 AI 生视频的画面参考，简短具体）；",
      "- action：该镜头的运镜/动作（如缓慢推近、看向镜头介绍、手势展示产品）。",
      "整体连起来要是一条完整探店视频：开场吸引 → 逐个介绍亮点 → 结尾行动号召。",
      "只输出 JSON：{\"shots\":[{\"id\":string,\"caption\":string,\"scene\":string,\"action\":string}]}，",
      "顺序与数量必须与骨架完全一致，id 原样返回。",
    ].join("\n");

    const user = JSON.stringify({
      industry: brief.industry,
      storeDescription: brief.storeDescription ?? null,
      sellingPoints: brief.sellingPoints ?? [],
      cta: brief.cta ?? null,
      brand: brief.brandName ?? null,
      shots: skeleton.map((s) => ({
        id: s.id,
        durationSec: s.durationSec,
        usesStoreImage: s.storeImageIndex + 1,
      })),
    });

    const res = await chatJsonByTier<{
      shots?: Array<{ id: string; caption?: string; scene?: string; action?: string }>;
    }>({
      tier: "director",
      stage: "digital_human_store_ad_dynamic_storyboard",
      system,
      user,
      temperature: 0.8,
      maxTokens: 2000,
    });

    const out = res.data.shots;
    if (Array.isArray(out) && out.length === skeleton.length) {
      const shots = skeleton.map((s) => {
        const hit = out.find((o) => o.id === s.id);
        return {
          ...s,
          caption: hit?.caption?.trim() || s.caption,
          scene: hit?.scene?.trim() || s.scene,
          action: hit?.action?.trim() || s.action,
        };
      });
      return { shots, captionsFromLLM: true };
    }
  } catch (err) {
    console.warn(
      "[store-ad-director] gpt-5.5 动态分镜生成失败，回退内置模板：",
      (err as Error).message,
    );
  }

  return { shots: skeleton, captionsFromLLM: false };
}

/**
 * 为每个分镜写「真人探店感」中文口播旁白（一次 LLM 调用，返回与 shots 等长数组）。
 * 失败回退用字幕作为旁白。供 pipeline 在 TTS 前调用。
 */
export async function buildStoreAdNarration(
  brief: DynamicStoreAdBrief,
  shots: Array<{ id: string; durationSec: number; caption: string }>,
): Promise<{ lines: Array<{ id: string; text: string }>; fromLLM: boolean }> {
  const fallback = {
    lines: shots.map((s) => ({ id: s.id, text: s.caption })),
    fromLLM: false,
  };
  if (isLLMForcedMock() || !process.env.OPENAI_API_KEY) return fallback;

  try {
    const system = [
      "你是一位很会拍探店短视频的中文博主。",
      "你的口播旁白要有「真实的人在说话」的感觉：口语、自然、亲切、有网感，",
      "像真的在店里边逛边和粉丝聊天，绝不能是僵硬的广告腔或书面语。",
      "可以用语气词（「真的」「也太」「绝了」「来」），但不要浮夸做作。",
      "不要出现英文、不要念标点、不要写括号说明。",
    ].join("\n");

    const shotBrief = shots
      .map(
        (s, i) =>
          `${i + 1}. id=${s.id}（${s.durationSec}s）参考字幕：「${s.caption}」`,
      )
      .join("\n");

    const user = [
      `门店：${brief.industry}。${brief.storeDescription ?? ""}`,
      brief.sellingPoints?.length ? `卖点：${brief.sellingPoints.join("、")}。` : "",
      brief.brandName ? `品牌：${brief.brandName}。` : "",
      brief.cta ? `结尾引导：${brief.cta}。` : "",
      "",
      "请为下面每个分镜各写一句中文口播旁白，整体连起来是一条完整探店解说，",
      "有开场吸引、逐个介绍亮点、结尾引导的节奏。",
      "每句长度贴合该镜头时长：约每秒 4~5 个汉字，宁可短一点也不要超时。",
      "",
      "分镜列表：",
      shotBrief,
      "",
      '只输出 JSON：{"lines":[{"id":"镜头id","text":"中文旁白"}]}，顺序与数量与分镜一致。',
    ]
      .filter(Boolean)
      .join("\n");

    const res = await chatJsonByTier<{ lines?: Array<{ id: string; text: string }> }>({
      tier: "director",
      stage: "digital_human_store_ad_voiceover",
      system,
      user,
      temperature: 0.8,
      maxTokens: 2000,
    });
    const lines = res.data.lines;
    if (Array.isArray(lines) && lines.length === shots.length) {
      return {
        lines: shots.map((s) => {
          const hit = lines.find((l) => l.id === s.id);
          return { id: s.id, text: (hit?.text || s.caption).trim() };
        }),
        fromLLM: true,
      };
    }
  } catch (err) {
    console.warn(
      "[store-ad-director] gpt-5.5 旁白生成失败，回退用字幕：",
      (err as Error).message,
    );
  }
  return fallback;
}
