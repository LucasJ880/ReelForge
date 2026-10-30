/**
 * 人物设定图（Kelin 团队精控流程里的「GPT 人物版」，2026-10-29）。
 *
 * 他们的精控做法：脚本 + GPT 人物版 + 商品各角度图 + Seedance 2.5——参考图各管一件事：人物卡管面部、发型、
 * 服装与体态，商品图管款式结构，开场帧管空间与起点。我们以前只有开场帧一张图同时扛人物和场景，
 * 后面换景别、换地点时人会漂。这里从开场帧出一张同一个人的设定图（正 / 侧 / 四分之三全身 + 头肩近景），
 * 作为视频的人物参考。
 *
 * 纯数据模块：评测脚本与（验证通过后的）线上出图共用，不得引入服务端依赖。
 * 线上还没接：先在评测集里比出效果，再决定存哪、给不给商家看。
 */

/// 出现「人或动物出镜」的词：只有手的镜头不需要设定图（手的长相由开场帧管就够）。
/// 镜头卡常用身份词加中性代词写人（Passenger / Hiker / barista … their），10-29 首版漏了这些
const ON_CAMERA_SUBJECT =
  /\b(?:man|woman|men|women|girl|boy|guy|lady|person|people|presenter|model|customer|owner|mother|father|mom|dad|parent|child|kid|baby|couple|friend|friends|family|passenger|commuter|rider|hiker|runner|walker|traveler|traveller|camper|cyclist|athlete|shopper|user|worker|student|barista|chef|cook|diner|driver|host|guest|visitor|creator|influencer|he|she|his|her|him|they|their|them|dog|puppy|cat|kitten|retriever|pet)\b/iu;

/** 镜头卡里有没有会反复出镜的人或动物（不只是一双手）。 */
export function storyHasRecurringSubject(shotCards: ReadonlyArray<string | null | undefined>): boolean {
  return shotCards.some((card) => Boolean(card && ON_CAMERA_SUBJECT.test(card)));
}

export const CHARACTER_SHEET_ASPECT_RATIO = "16:9";

/**
 * 设定图的出图提示词（GPT Image）。输入图：image 1 = 开场帧（人物从这里来），其后是商品实拍（只用来认出商品、
 * 确保设定图里不出现商品）。全英文。
 */
export function buildCharacterSheetPrompt(input: { productPhotoCount: number }): string {
  const productNote =
    input.productPhotoCount > 0
      ? ` ${input.productPhotoCount === 1 ? "Image 2 shows" : `Images 2-${input.productPhotoCount + 1} show`} the product: leave the product out of the sheet entirely.`
      : "";
  return [
    "Create ONE photorealistic character reference sheet for a video model.",
    `SUBJECT: every recurring person and animal in image 1, the opening storyboard frame — the same exact individuals: face, hair, skin tone, age, build, fur and markings, plus the same wardrobe and accessories.${productNote}`,
    "LAYOUT: plain light-grey studio background; for each subject, side by side and evenly spaced: full-body front view, full-body three-quarter view, full-body side view, and a head-and-shoulders close-up.",
    "LIGHT: soft even studio light, neutral color, no dramatic shadows.",
    "POSE: relaxed neutral stance, calm natural expression, arms at the sides, no props in the hands.",
    "AVOID: text, labels, numbers, logos, watermarks, borders, grids drawn as lines, extra people, the product, any scenery.",
  ].join("\n");
}
