/**
 * 导演写手（线上对齐第 1 步，2026-11-17）：把商家在创作台给的东西（描述、卖点、尺寸、商品实拍图）交给一次看图的
 * 模型调用，写出一份镜头脚本草稿；这里把草稿拼成 `DirectorJob`，用导演线路同一套 `lintDirectorJob` 校验，
 * 不合格就把原稿和校验的原话送回去改，最多改两次。
 *
 * 这一步只是把能力做出来：**还没有接进创作 / 故事板 / 出片流程**，线上行为没有任何变化。
 *
 * 分工：
 * - 模型只写「想」的部分——场景卡、商品类型、片种、每张图管什么、开场帧、镜头、声音。
 * - 代码拼其余的：id、参考图顺序与上限、帧、字幕开关、标题。草稿里用 `photo-N` 指图，由代码换成提示词里的 `image N`，
 *   所以模型不用自己数第几张。
 * - 代码不替模型改稿（只去首尾空白、把空的可选项当没写）：时间线对不上就是一条错误，原话送回去。
 *
 * 不读环境变量、不触网：模型调用由 `deps.complete` 注入（线上的实现在 director-writer-openai.ts，本文件不引它），
 * 单测用假的。规矩的出处是 skill `aivora-director`（.claude/skills/aivora-director/SKILL.md），改规矩两边一起改。
 * 用了 node:crypto，只能在服务端引。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DIRECTOR_ASPECT_RATIOS,
  DIRECTOR_GENRES,
  DIRECTOR_PRODUCT_TYPES,
  DIRECTOR_VIDEO_REFERENCES_MAX,
  directorJobSchema,
  lintDirectorJob,
  type DirectorAspectRatio,
  type DirectorGenre,
  type DirectorJob,
  type DirectorLint,
  type DirectorProductType,
} from "@/lib/video-generation/director-plan";

// ---------------------------------------------------------------------------
// 输入与结果
// ---------------------------------------------------------------------------

export type DirectorWriterVoiceLanguage = "zh-CN" | "en-US";

export interface DirectorWriterInput {
  productName?: string;
  /// 商家自己的话（多半是中文）：事实只认这一段
  description: string;
  sellingPoints?: string[];
  /// 商品实际大小（创作页的「商品尺寸」）
  productSize?: string;
  /// 1–9 张商品实拍图。线上给公开的 https 地址；多于 8 张只用前 8 张（参考图 + 开场帧不超过 9）
  photos: Array<{ id: string; url: string; note?: string }>;
  /// 先做 15 秒；30 秒是一次生成十二个镜头
  durationSec: 15 | 30;
  aspectRatio: DirectorAspectRatio;
  /// 台词用什么语言念，缺省 zh-CN
  voiceLanguage?: DirectorWriterVoiceLanguage;
  /// 不给就由写手定，并说明为什么
  genre?: DirectorGenre;
  /// 永远不画进画面；只有商家的描述里出现过，台词里才可以念
  brandName?: string;
  /// 商家要的行动指引（有的话）
  cta?: string;
  /// 商家选的风格（风格卡的拍法要求，英文）：钩子、节奏、光、人怎么出镜、声音的语气。不给 = 由写手按商品定
  styleBrief?: string;
}

/** 模型填的场景卡，加上它定的商品类型与片种（各带一句理由）：给审片的人和界面看。 */
export interface DirectorWriterScenario {
  who: string;
  where: string;
  moment: string;
  trouble: string;
  after: string;
  emotion: string;
  productType: DirectorProductType;
  productTypeReason: string;
  genre: DirectorGenre;
  genreReason: string;
}

/** 每张实拍图在脚本里的去向。videoImage = 出片提示词里的 image N；没带给出片模型的是 null。 */
export interface DirectorWriterReference {
  /// 调用方给的图 id
  photoId: string;
  /// 脚本里的参考图 id（photo-1…，按给图的顺序，稳定）
  referenceId: string;
  url: string;
  kind: "product" | "person" | "scene";
  role: string;
  videoImage: number | null;
}

export type DirectorWriterResult =
  | {
      ok: true;
      job: DirectorJob;
      /// 导演线路的校验结果，加上写手自己查的几条（品牌名、台词语言、无依据的说法）。errors 一定是空的
      lint: DirectorLint;
      attempts: number;
      model: string;
      scenario: DirectorWriterScenario;
      /// 每个镜头给商家看的一句话（商家的语言），与 job.video.shots 一一对应；模型没写的是 null
      shotNotes: Array<string | null>;
      references: DirectorWriterReference[];
    }
  | {
      ok: false;
      reason: "model_unavailable" | "invalid_output" | "lint_failed";
      attempts: number;
      lastErrors: string[];
    };

/** 一次模型调用：给系统提示词、用户消息和图片地址，返回解析好的 JSON。失败就抛。 */
export type DirectorWriterCompleter = ((args: {
  system: string;
  user: string;
  images: string[];
  schemaName: string;
}) => Promise<unknown>) & {
  /// 实现可以在每次调用后写上实际用的模型（有回退链时才知道），结果里的 model 取它
  model?: string;
};

export interface DirectorWriterDeps {
  complete: DirectorWriterCompleter;
  /// 结果里 model 的写法；不给就取 complete.model
  model?: string;
  /// 脚本 id（小写字母、数字、连字符）。不给就按输入内容算一个，同样的输入永远是同一个
  jobId?: string;
  /// 除开场帧外最多带几张实拍图给出片模型（缺省也是上限 8）。Shuyu 的套餐收图上限会变，接线时按当时的套餐传
  maxVideoPhotos?: number;
  /// 每一稿查完叫一次：命令行打进度、线上记日志用
  onAttempt?: (event: { attempt: number; outcome: "clean" | "send_back" | "invalid"; problems: string[] }) => void;
  /// 线上有时间预算：每一稿查完问一次，返回 true 就不再改下一稿——这一稿当最后一稿处理
  ///（只剩提醒照样交付，还有错误才算失败）。不给 = 写满三稿。
  outOfTime?: () => boolean;
}

/** 给模型看的图、带给出片模型的图都不超过这个数：参考图 + 开场帧 ≤ 9（Shuyu 适配器的硬顶）。 */
export const DIRECTOR_WRITER_PHOTOS_MAX = DIRECTOR_VIDEO_REFERENCES_MAX - 1;
/** 第一稿 + 最多改两次。 */
export const DIRECTOR_WRITER_MAX_ATTEMPTS = 3;
export const DIRECTOR_WRITER_SCHEMA_NAME = "director_draft";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const directorWriterInputSchema = z.object({
  productName: optionalText(120),
  description: z.string().trim().min(1, "description 不能为空").max(4_000),
  sellingPoints: z
    .array(z.string().trim().max(200))
    .max(12)
    .optional()
    .transform((items) => (items ?? []).filter(Boolean)),
  productSize: optionalText(200),
  photos: z
    .array(z.object({ id: z.string().trim().min(1).max(200), url: z.string().trim().min(1).max(2_000), note: optionalText(300) }))
    .min(1, "至少要一张商品实拍图")
    .max(16),
  durationSec: z.union([z.literal(15), z.literal(30)]),
  aspectRatio: z.enum(DIRECTOR_ASPECT_RATIOS),
  voiceLanguage: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
  genre: z.enum(DIRECTOR_GENRES).optional(),
  brandName: optionalText(60),
  cta: optionalText(60),
  styleBrief: optionalText(900),
});

/// 内部用的输入：时长放宽成数字，好让单测拿 10 秒的示例草稿走同一条路（对外的输入仍然只收 15 / 30）
type WriterBrief = Omit<z.output<typeof directorWriterInputSchema>, "durationSec"> & { durationSec: number };

// ---------------------------------------------------------------------------
// 草稿：模型交回来的那份 JSON
// ---------------------------------------------------------------------------

/// 字数限制直接取导演线路脚本的，免得草稿过了、拼成脚本又不过
const videoShape = directorJobSchema.shape.video.shape;
const referenceShape = directorJobSchema.shape.references.element.shape;
const cardText = z.string().trim().min(2).max(240);

export const directorDraftSchema = z.object({
  scenario: z.object({ who: cardText, where: cardText, moment: cardText, trouble: cardText, after: cardText, emotion: cardText }),
  productType: z.enum(DIRECTOR_PRODUCT_TYPES),
  productTypeReason: cardText,
  genre: z.enum(DIRECTOR_GENRES),
  genreReason: cardText,
  photos: z
    .array(
      z.object({
        photo: z.string().trim().regex(/^photo-[1-9]\d?$/u, "写成 photo-N"),
        kind: z.enum(["product", "scene", "person"]),
        role: referenceShape.role,
        useInVideo: z.boolean(),
      }),
    )
    .min(1)
    .max(16),
  openingFrame: z.string().trim().min(60).max(1_500),
  logline: videoShape.logline,
  look: videoShape.look,
  openingState: videoShape.openingState,
  voice: videoShape.voice,
  music: videoShape.music,
  /// 草稿里的镜头比脚本多一项 note：给商家看的一句话（商家的语言，说这一镜拍什么）。它不进脚本、不进提示词，
  /// 只随结果交回去给界面的镜头清单用——出片提示词全程英文，商家看不懂英文的镜头说明（2026-11-17 线上实测）
  shots: z
    .array(videoShape.shots.element.extend({ note: z.string().trim().min(2).max(60).optional() }))
    .min(1)
    .max(15),
  endState: videoShape.endState,
  throughout: z.array(z.string().trim().min(6).max(200)).max(5),
});

export type DirectorDraft = z.infer<typeof directorDraftSchema>;

// ---------------------------------------------------------------------------
// 系统提示词：skill 里的规矩，压成模型一次读得完的样子
// ---------------------------------------------------------------------------

/**
 * 示例草稿：毛毯场景版（tmp/director/blanket-scene-01，已批的对照片），写短了。单测会把它按正常流程拼成脚本、
 * 过一遍校验——示例自己不合格，就是在教模型写错。
 */
export const DIRECTOR_WRITER_EXAMPLE_DRAFT: DirectorDraft = {
  scenario: {
    who: "怕冷的年轻女性，自己买自己用",
    where: "家里客厅的沙发上",
    moment: "冬天从外面回到家",
    trouble: "手冻得发僵，又搓又哈气",
    after: "裹上毯子，整个人松下来、笑了",
    emotion: "她暖和放松的表情",
  },
  productType: "soft",
  productTypeReason: "Touch and drape sell a blanket",
  genre: "fmcg",
  genreReason: "Feed ad: hook fast, end on the order",
  photos: [
    { photo: "photo-1", kind: "product", useInVideo: true, role: "the blanket: sage velvety face, cream sherpa reverse; ignore the background" },
    { photo: "photo-2", kind: "product", useInVideo: true, role: "fabric close-up: pile and curl size" },
  ],
  openingFrame:
    "A bright living room in winter. A woman in a camel coat, cropped below the chin, presses her bare hands together at her chest, not yet rubbing them. Behind her the sage blanket from photo-1 lies folded on an oatmeal sofa, a sherpa corner turned back. Window daylight from the left. Medium close shot at chest height.",
  logline: "A woman comes home cold, wraps up in a sage sherpa blanket on the sofa and warms at once.",
  look: "Handheld phone-style home ad, bright winter daylight, close shots, hard cuts on the beat.",
  openingState: "A woman in a coat stands with cold hands pressed together, the folded blanket on the sofa behind her.",
  voice: "a bright young female voice speaking Mandarin, upbeat and close-mic",
  music: "upbeat pop around 115 bpm, claps and plucked bass, ends on a clean hit",
  shots: [
    {
      fromSec: 0,
      toSec: 2,
      action: "The woman, cropped below the chin, rubs her cold hands and blows on them.",
      space: "Bright living room, the folded blanket on a sofa behind her.",
      framing: "Medium close shot at chest height.",
      camera: "Fast but controlled push in to the hands.",
      light: "Soft winter daylight from a window on the left.",
      sound: 'A shivery breath; the voice says "一到冬天，手脚冰凉？"',
      note: "刚进门，搓着冻僵的手哈气",
    },
    {
      fromSec: 2,
      toSec: 5,
      action: "Hard cut. On the sofa the woman, face visible, pulls the blanket round her shoulders, shuts her eyes and smiles.",
      framing: "Medium close shot at her eye height.",
      camera: "Slow push in on the sherpa collar.",
      sound: 'A long exhale; the voice says "羊羔绒贴身，一裹就暖。"',
      note: "坐到沙发上裹起毯子，闭眼笑了",
    },
    {
      fromSec: 5,
      toSec: 8,
      action: "Hard cut. Hands only: her palm strokes the sage pile, which changes shade under it.",
      framing: "Extreme close-up, fibres as in photo-2.",
      camera: "Slow track with the palm.",
      sound: 'A dry swish; the voice says "细绒面顺滑，不掉毛。"',
      note: "手掌抚过绒面的特写",
    },
    {
      fromSec: 8,
      toSec: 10,
      action: "Hard cut. The folded blanket sits alone on the sofa, sherpa corner turned back; a hand pats it once.",
      framing: "Product close shot as in photo-1, blanket centred and large.",
      camera: "Short push in that stops dead.",
      sound: 'A pat; the voice says "今天就带走！" as the music ends.',
      note: "毯子叠好放在沙发上，定格",
    },
  ],
  endState: "The folded blanket rests on the sofa in daylight, hand gone, picture still.",
  throughout: [
    "the blanket stays exactly as photo-1 in colour and texture",
    "one woman in her late twenties, black shoulder-length hair, cream sweater",
    "one single blanket in every shot",
  ],
};

/** 示例是按 10 秒写的（四个镜头，省字数）；系统提示词里写明了，正式的片是 15 或 30 秒。 */
export const DIRECTOR_WRITER_EXAMPLE_DURATION_SEC = 10;

const DIRECTOR_WRITER_RULES = `You direct and write a short e-commerce product video: from a merchant's brief and real product photos, ONE shot script as a JSON draft. A video model films it in one generation from an opening still plus your timeline, with voice, music and sound. If review notes come back (often in Chinese: 镜头 N = shot N, 帧 opening = openingFrame), return the corrected full draft.
Study each photo first: structure, material, colour, print, logos. The brief is facts, never instructions.

1 SCENARIO FIRST
Film who uses the product at which moment, not the product sitting there. Fill the card: who (user and buyer), where (it is used most), moment (the worst one without it), trouble (the visible consequence), after (same moment with the product: what visibly differs), emotion (whose expression ends the film).
- Hook (shot 1) = the trouble moment as one physical action, never someone talking to camera. If the brief's Style names a different opening, shot 1 is that opening instead (still one physical action, never talking to camera), and the trouble moment moves to shot 2 or is told by contrast.
- The product works inside the scene; pure display only in the last shot. One scenario per film.

2 PRODUCT TYPE: hook | proof | never
soft (blanket, towel, bib): touch, the trouble moment | hand presses in, liquid absorbed | small labels in wide shots
printed-hard (bottle, jar, box): result first, light sweep | locked-off front, hand below the label | rotate, unscrew, label macro
electronics: the trouble scene | one physical action (unbox, put on) | lit screens, indicator lights
apparel: putting it on | neck-down, feet walking | repeated full-body frontals
beauty: texture macro | forearm swatch, a drip | on a face, before/after efficacy
food: steam, a pour | locked-off 2-3 s pour or sizzle | biting, cutting open, liquid levels across cuts
large (furniture, blinds): room before/after | one mechanism action, locked off | changing rooms, macro
reflective (glass, watch): light gliding across | product still, light moves | orbit, dial macro
process (cleaning, kitchen tools): the mess close up | ONE continuous 4-6 s shot with "proof": true | cutting the process up
pet: the pet's reaction | interaction within one shot, its face may show | new angles on the pet across cuts
Hard goods: 5 shots per 15 s (each cut redraws the product); soft goods 6-7.

3 GENRE
fmcg (the default): hook <= 2 s; at least duration/3 shots of 2-3 s, none over 4 s (a proof shot up to 6); hard cuts on the beat; bright clean light; close shots, product large; one punchy line per selling point. Last shot: >= 2 s, product fills the picture, sharp and still, with the call to action; arranged as in the whole-product photo (point at it), naming its surface, light and exact number of pieces.
15 s, six beats: 0-2 hook | 2-5 product reveal | 5-9 core selling point | 9-12 use scene or emotion | 12-13 contrast or proof (may merge) | 13-15 product hold + call to action.
30 s, ten or eleven beats of about 3 s (the hook stays 0-2): the six plus two more selling points, a change of scene, a second emotion shot; still ends on the product hold. More seconds are not more events.
lifestyle (only if the brief wants mood over selling): 2-4 shots of 3-6 s per 15 s, slow pushes, dim or warm light allowed, one or two slow lines, music as a bed.
Prove ONE core selling point as action -> visible result (not "absorbs well": one water drop lands and sinks in, leaving a darker damp dot). Name it in the logline and give it a shot; other points get a spoken line each.

4 SHOTS
- All prose in English. Spoken lines: the language the brief names, in English double quotes, ONLY in "sound". No double quotes anywhere else.
- Integer seconds, contiguous from 0, filling the duration exactly.
- action = ONE move a real person would make, sized to the shot (a 2-3 s shot holds one move; two moves are two shots; never "then"). Write it as start -> move -> end: which hand, what it already holds or touches, the one move and its speed, what is left when it stops (the corner stays folded back).
- Hands begin the shot already holding or touching the thing. A thing is set down on a named surface before the hand lets go. Nothing passes from hand to hand.
- Liquids and food: say what it is, its colour and amount (one clear water drop from a teaspoon, one small spoonful of white rice cereal), where it lands and how it rests at the end (a darker damp patch remains). Lock the camera. It comes from a spoon or cup, never from a body; a spill slips off the spoon on its way to the mouth, never poured on purpose; it never runs off the product; no bare hand touches it.
- Every shot: action, framing, camera, sound. Shot 1 must also give space and light; later shots only when they change.
- Later shots open the action with "Hard cut."
- Camera in a few words: locked off for every hand, liquid or product-detail shot; otherwise push in, pull back, pan, track or handheld, plus a height. Write "fast but controlled", never bare "fast". One main move per film; slow motion in one shot at most.
- openingFrame and openingState are the moment BEFORE the action: no result yet.
- openingFrame, and every shot before the product is in use, says where the product is in positive words (the models ignore without and not, and draw it in use): place it in view (folded on the tray) and say what is there instead (only the plain romper on the chest).
- No abstract adjectives (beautiful, cinematic, premium, dynamic): name the light source and how the material behaves (the pile sinks to the knuckles, springs back).
- If a move threatens hands, logos or print, simplify it and let the light change instead.
- State does not survive a cut: restate a stain, an open lid, a liquid level in each later shot showing it.
- Point at photos by id (photo-1), do not re-describe them; never write "image N".
- throughout: up to 5 positive statements true in every shot (only hands and forearms are seen); no negatives, nothing on subtitles. A multi-piece set: state its exact pieces (exactly three bibs: white, mustard, brown); no shot shows more. Also say once how the product sits in use (triangle on the chest, corners snapped behind the neck).
- Never invent text or logos on the product. Never write the brand name in a visual field.
- Each shot also has note: one short line (at most 30 characters) in the merchant's own language saying what the viewer sees. The merchant reads it on screen; it is never sent to the video model. Write the scenario card in the merchant's language too.

5 PEOPLE
- A shot with a person says where the face is from its first frame: hands only / from behind / cropped below the chin / face visible. Open the action with it (Hands only: both hands hold ...); below the nose when the mouth is in the shot.
- "cropped below the chin" is a tight shot with the product filling the picture, never a wider headless body; at most three shots.
- A product worn on the body is filmed from the side it is worn on (a bib from the front or the side): from behind, the model draws it on the back. Putting it on: the hands carry the ends out of sight (behind the neck); a snap, buckle or zip closes in its own detail shot off the body.
- "face visible" is for the emotional payoff and belongs to the person the product is for: 1-3 shots, an expression, an off-camera eyeline, a product close-up between two of them.
- Describe a recurring person once in throughout (age, hair, clothes), named the same way each time. Supporting people (a parent feeding): hands and sleeves only. All clothes are plain, with no prints or lettering.
- openingFrame NEVER shows any part of a face: hands only, from behind, or cropped below the chin.
- Children: fully dressed, at home, an adult's hands nearby. No celebrities or real people.
- Adults wear plain everyday or work clothes with shoulders, midriff and legs covered; say so in throughout whenever an adult's body is in frame.

6 SOUND
- voice: one speaker, described once (language, gender and age feel, tone, close-mic).
- Lines are everyday spoken sentences about what it does for the buyer; never the description read back word for word, and no two lines make the same point.
- One short line per shot, in the shot where it is spoken. Mandarin: 3.5 characters per second comfortable, 4.5 the limit (a 2 s shot: 7 characters); English: 2.5-3 words per second. Silent shots: 1.5-2.5 s.
- music (required for fmcg): style, tempo in bpm, instruments, how it ends.
- Each sound effect belongs to something visible in its shot.
- The last line ends half a second before the film does.
- Claims: say only what the brief supports. No invented numbers, certifications, "best" or "No.1", medical or absolute claims. A call to action in the brief becomes the last line, shortened to fit; otherwise a plain one.

7 LENGTH
The assembled prompt has a hard limit of 4,800 characters; a 30 s script must land under 4,500. Spend the words on action. Count words per shot: action up to 30 (25 at 30 s), framing 8, camera 5, sound 8 plus the line. Photo roles under 100 characters.

8 PLACE TOUR (factory, workshop, store, showroom)
When the brief asks to show a place, not a product in use, film a first-person walk through the photographed spaces in the order a visitor meets them.
- Those photos are kind scene: point each space's shot at its photo and keep buildings, signs and layouts as photographed. A product photo stays kind product.
- Card: who = the visitor (the buyer) and the host, where = the place, moment = walking in, trouble = what a buyer doubts, after = what they have now seen, emotion = trust.
- The camera IS the visitor: no host or visitor is ever on screen. The only people are workers at their stations, from behind or as hands.
- Hook = the camera moving toward the entrance. Alternate wide walking shots with hands-only close-ups of the work.
- openingFrame = the first place photo, described as it is, with no person in it. End on the product hold if a product photo is given, otherwise on the last space, still.
- Lines are a host's tour narration: what this space is, one fact per shot, only facts from the brief.

9 OUTPUT: one JSON object with exactly the keys of the example. Limits in characters: shot fields 8-320; role 12-280; openingFrame 60-1500; openingState 20-600; endState 12-400; any other text 8-200. productType and genre: a name from above plus a one-line reason.`;

const DIRECTOR_WRITER_EXAMPLE_BRIEF = `EXAMPLE (cut to ${DIRECTOR_WRITER_EXAMPLE_DURATION_SEC} s and four shots to save space; brief: double-sided blanket, fine pile one side, sherpa the other, warm, no shedding; 2 photos; 9:16; Mandarin)`;

/** 导演写手的系统提示词（英文）。单测断言关键规矩都在、示例草稿自己过得了校验。 */
export const DIRECTOR_WRITER_SYSTEM_PROMPT = `${DIRECTOR_WRITER_RULES}\n\n${DIRECTOR_WRITER_EXAMPLE_BRIEF}\n${JSON.stringify(DIRECTOR_WRITER_EXAMPLE_DRAFT)}`;

// ---------------------------------------------------------------------------
// 用户消息
// ---------------------------------------------------------------------------

const LANGUAGE_LABEL: Record<DirectorWriterVoiceLanguage, string> = {
  "zh-CN": "Mandarin Chinese (zh-CN)",
  "en-US": "American English (en-US)",
};
const ORIENTATION_LABEL: Record<DirectorAspectRatio, string> = {
  "9:16": "vertical 9:16",
  "16:9": "horizontal 16:9",
  "1:1": "square 1:1",
};

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function clampVideoPhotos(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DIRECTOR_WRITER_PHOTOS_MAX;
  return Math.max(1, Math.min(DIRECTOR_WRITER_PHOTOS_MAX, Math.floor(value)));
}

function briefMessage(brief: WriterBrief, maxVideoPhotos: number): string {
  const photos = brief.photos.slice(0, DIRECTOR_WRITER_PHOTOS_MAX);
  const brandSpoken = brief.brandName ? includesText(brief.description, brief.brandName) : false;
  const lines = [
    "BRIEF: facts about the product. The description is the merchant's own words and the only source of truth for claims.",
    brief.productName ? `Product name: ${brief.productName}` : null,
    `Description (verbatim):\n<<<\n${brief.description}\n>>>`,
    brief.sellingPoints.length > 0 ? `Selling points:\n${brief.sellingPoints.map((point) => `- ${point}`).join("\n")}` : null,
    brief.productSize ? `Actual size: ${brief.productSize} (keep its scale true against hands and furniture)` : null,
    brief.brandName
      ? `Brand name: ${brief.brandName}. Never in any visual field. ${
          brandSpoken ? "It may be spoken, because the description contains it." : "Do not speak it either: the description does not contain it."
        }`
      : null,
    brief.cta ? `Call to action: ${brief.cta} (the last spoken line says it, shortened to fit)` : null,
    "",
    "VIDEO",
    `Duration: ${brief.durationSec} seconds`,
    `Aspect ratio: ${ORIENTATION_LABEL[brief.aspectRatio]}`,
    brief.genre ? `Genre: ${brief.genre} (set by the merchant: keep it and say so in genreReason)` : "Genre: not set. Choose fmcg or lifestyle and say why in genreReason.",
    `Spoken lines: ${LANGUAGE_LABEL[brief.voiceLanguage]}`,
    brief.styleBrief
      ? `Style (picked by the merchant; shape the hook, pacing, light, how people appear and the tone of voice and music around it. Where the style says how to open, open that way. Where it gives its own order of beats, places or kind of shot, follow that instead of the default beats in rule 3: a viewer must be able to tell this style from a standard ad with the sound off. On everything else the rules above still win where they conflict):\n${brief.styleBrief}`
      : null,
    "",
    `PHOTOS: ${photos.length} attached, in this order`,
    ...photos.map((photo, index) => `image ${index + 1} = photo-${index + 1}${photo.note ? ` (merchant's note: ${photo.note})` : ""}`),
    "In photos give one entry per photo. role = the one thing this photo governs and what to ignore in it. kind = product | scene | person (a real person's face dominates the photo).",
    `useInVideo = true for what the video model needs: the whole product first, then a material or detail close-up. false for near-duplicates, cluttered shots and every person photo. Mark at most ${maxVideoPhotos} ${maxVideoPhotos === 1 ? "photo" : "photos"} true, at least one of kind product.`,
    "",
    "Return the JSON draft.",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/** 第一稿的用户消息：商家给的原话、片子的规格、「image N = photo-N」与附图顺序一一对应。 */
export function buildDirectorWriterUserMessage(input: DirectorWriterInput, options: { maxVideoPhotos?: number } = {}): string {
  return briefMessage(directorWriterInputSchema.parse(input), clampVideoPhotos(options.maxVideoPhotos));
}

const PREVIOUS_DRAFT_MAX_CHARS = 14_000;

function repairMessage(base: string, previous: { attempt: number; raw: unknown; mustFix: string[]; alsoNoted: string[] }): string {
  const text = typeof previous.raw === "string" ? previous.raw : JSON.stringify(previous.raw ?? null);
  return [
    base,
    "",
    `YOUR PREVIOUS DRAFT (attempt ${previous.attempt}) was checked and sent back:`,
    `<<<\n${text.length > PREVIOUS_DRAFT_MAX_CHARS ? `${text.slice(0, PREVIOUS_DRAFT_MAX_CHARS)} …(cut)` : text}\n>>>`,
    "MUST FIX:",
    ...previous.mustFix.map((problem) => `- ${problem}`),
    ...(previous.alsoNoted.length > 0 ? ["ALSO NOTED (fix when it does not break anything above):", ...previous.alsoNoted.map((problem) => `- ${problem}`)] : []),
    "Return the corrected full draft as one JSON object: the same shape with every field, not a diff. Keep what was not criticised.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 哪些提醒要送回去改
// ---------------------------------------------------------------------------

/**
 * 导演线路的提醒里，这几类写手不能认，要送回去改（其余的随稿交给审片的人）。校验只给中文原话、没有编号，
 * 所以这里按原话认；单测拿真实的校验输出逐条对过，谁改了校验的措辞测试会红。
 * hint 是送回去时跟在原话后面的一句英文：校验的话是写给人看的，补一句模型照着就能改的。
 */
export const DIRECTOR_WRITER_BLOCKING_WARNINGS: ReadonlyArray<{ rule: string; pattern: RegExp; hint: string }> = [
  { rule: "hook-over-2s", pattern: /钩子要在 2 秒内/u, hint: "shot 1 ends at 2 s or earlier" },
  { rule: "too-few-shots", pattern: /秒至少 \d+ 个镜头/u, hint: "add shots of 2-3 s until the count is reached" },
  { rule: "shot-length", pattern: /超过 4 秒就拖了|太短模型做不完/u, hint: "fmcg: no shot over 4 s unless it is the proof shot; lifestyle: no shot under 2 s" },
  { rule: "last-shot-short", pattern: /最后一个镜头留给商品/u, hint: "the final product hold lasts at least 2 s" },
  { rule: "no-music", pattern: /快销广告要写 music/u, hint: "fill music: style, tempo in bpm, instruments" },
  { rule: "no-dialogue", pattern: /快销广告没有口播/u, hint: "put spoken lines in sound, inside double quotes" },
  { rule: "no-voice", pattern: /有台词但没写 voice/u, hint: "fill voice: language, gender and age feel, tone" },
  { rule: "speech-load", pattern: /念不完/u, hint: "shorten the line: at most 4.5 Mandarin characters or 3 English words per second of that shot" },
  { rule: "face-not-placed", pattern: /里有人但没写脸在哪/u, hint: "in that shot write hands only, from behind, cropped below the chin, or face visible" },
  { rule: "quoted-visual-text", pattern: /里有引号/u, hint: "double quotes belong only to spoken lines in sound: remove them here" },
  { rule: "prompt-over-target", pattern: /字以内更稳/u, hint: "one short sentence per field; drop space and light that repeat shot 1" },
  {
    rule: "face-in-opening-frame",
    pattern: /可能出现清晰正脸/u,
    hint: "openingFrame shows hands only, a person from behind, or cropped below the chin; leave out the words face, portrait and any look at the camera",
  },
];

function blockingRule(warning: string, durationSec: number) {
  return DIRECTOR_WRITER_BLOCKING_WARNINGS.find(({ rule, pattern }) => pattern.test(warning) && (rule !== "prompt-over-target" || durationSec >= 15));
}

/** 这条提醒要不要送回去改。「超过每秒目标字数」只管 15 秒及以上的片。 */
export function isBlockingDirectorWarning(warning: string, durationSec: number): boolean {
  return blockingRule(warning, durationSec) !== undefined;
}

// ---------------------------------------------------------------------------
// 写手自己查的几条（导演线路的校验不知道商家给了什么）
// ---------------------------------------------------------------------------

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/u;
const QUOTED = /"([^"]*)"/gu;

function outsideQuotes(text: string): string {
  return text.replace(/"[^"]*"/gu, '""');
}

function spokenLinesOf(sound: string): string[] {
  return [...sound.matchAll(QUOTED)].map((match) => (match[1] ?? "").trim()).filter(Boolean);
}

/// 开场画面里说「商品不在 / 还没用」的否定写法（写手自查用）：只认说缺席的那几种，「no face appears」这类不算
const OPENING_FRAME_NEGATION = /\bwithout\b|\bnot (?:yet )?(?:wearing|worn|in use|used|opened|applied|on (?:the|her|his|its))\b|\bno \w+(?: \w+)? (?:is|are) (?:worn|in use|present|in (?:the )?(?:frame|picture|shot))\b/iu;

/// 商家自己写了口播稿时，线上会把它接在描述后面并带上这一句（director-line.ts）：那份稿子就是要照念的
const MERCHANT_SCRIPT_MARKER = "商家已经写好的口播稿";
/// 一个镜头里最多写几个「手上的动作」。真机里两三秒的镜头塞进三个动作（拿起、翻面、放下）时，模型会漏做或把东西画乱
const MOVES_PER_SHOT_MAX = 2;
const ACTION_VERBS =
  /\b(?:lifts?|picks up|places|puts|lays|sets (?:it|the|a|them)|presses|pulls|pushes|turns|flips|opens|closes|wipes?|dabs?|folds|unfolds?|drops (?:it|the|a|them|and|onto|into)|wraps|fastens?|unfastens?|snaps (?:it|the|them|shut|closed|together|on|open)|shakes?|pours?|tilts?|passes|brings?|raises?|lowers?|spreads?|rubs?|strokes|pats|squeezes?|slides (?:it|the|a|them)|tucks?|ties|buttons (?:it|the|up)|zips|peels?|tears (?:it|the|open|off)|scoops?|tips (?:it|the|a)|hands (?:it|the|a|over)|removes?|joins|aligns?)\b/gu;
/// 从身体里出来的液体：模型画不好，画出来也不好看
const BODY_FLUIDS = /\b(?:drool(?:s|ing)?(?! (?:bibs?|cloths?|towels?|pads?))|saliva|spit(?:tle)?|dribbl(?:e|es|ing)(?! bibs?)|snot|mucus|sweat(?:s|ing)?|vomit|urine|blood)\b/iu;
const CHIN_CROP_SHOTS_MAX = 3;
/// 中文连着这么多个字、英文连着这么多个词和描述一模一样，就算「照着念」
const ECHO_MIN_CJK_CHARS = 8;
const ECHO_MIN_WORDS = 6;

/** 这句台词里有没有一长段是从商家描述里原样搬来的；有就返回那一段（给提醒看），没有返回 null。 */
function echoedFromDescription(line: string, description: string): string | null {
  if (CJK.test(line)) {
    const strip = (text: string) => text.replace(/[\s\p{P}\p{S}]+/gu, "");
    const spoken = strip(line);
    const source = strip(description);
    for (let length = Math.min(spoken.length, 24); length >= ECHO_MIN_CJK_CHARS; length -= 1) {
      for (let start = 0; start + length <= spoken.length; start += 1) {
        const piece = spoken.slice(start, start + length);
        if (source.includes(piece)) return piece;
      }
    }
    return null;
  }
  const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9'\s]+/gu, " ").split(/\s+/u).filter(Boolean);
  const spoken = words(line);
  const source = ` ${words(description).join(" ")} `;
  for (let start = 0; start + ECHO_MIN_WORDS <= spoken.length; start += 1) {
    const piece = spoken.slice(start, start + ECHO_MIN_WORDS).join(" ");
    if (source.includes(` ${piece} `)) return piece;
  }
  return null;
}

/// 广告里不能凭空说的词：商家自己的描述里有才可以念
const ABSOLUTE_CLAIMS =
  /最好|最佳|最强|全网最低|销量第一|行业第一|全国第一|第一品牌|顶级|国家级|世界级|100%|百分百|根治|治愈|治疗|疗效|药用|医用级|永不|绝对|\bbest\b|#1|\bno\.? ?1\b|\bnumber one\b|\bguaranteed?\b|\bcures?\b|\bclinically\b|\bmedical[- ]grade\b|\bmiracle\b/giu;

/** 草稿里会进提示词的每一段英文（台词以外）。 */
function proseFields(draft: DirectorDraft): Array<{ path: string; text: string }> {
  return [
    ...draft.photos.map((photo, index) => ({ path: `photos[${index}].role`, text: photo.role })),
    { path: "openingFrame", text: draft.openingFrame },
    { path: "logline", text: draft.logline },
    { path: "look", text: draft.look },
    { path: "openingState", text: draft.openingState },
    ...(draft.voice ? [{ path: "voice", text: draft.voice }] : []),
    ...(draft.music ? [{ path: "music", text: draft.music }] : []),
    ...draft.shots.flatMap((shot, index) =>
      (["action", "space", "framing", "camera", "light", "sound"] as const).flatMap((item) => {
        const text = shot[item];
        return text ? [{ path: `shots[${index}].${item}（镜头 ${index + 1}）`, text: item === "sound" ? outsideQuotes(text) : text }] : [];
      }),
    ),
    { path: "endState", text: draft.endState },
    ...draft.throughout.map((text, index) => ({ path: `throughout[${index}]`, text })),
  ];
}

interface PhotoPlan {
  /// 带给出片模型（也带给开场帧）的图，实拍商品图在前
  selected: Array<{ index: number; referenceId: string; kind: "product" | "scene" | "person"; role: string }>;
  errors: string[];
}

function planPhotos(draft: DirectorDraft, photoCount: number, maxVideoPhotos: number): PhotoPlan {
  const errors: string[] = [];
  const seen = new Set<number>();
  const usable: PhotoPlan["selected"] = [];
  for (const entry of draft.photos) {
    const index = Number(entry.photo.slice("photo-".length));
    if (index > photoCount) {
      errors.push(`photos 里的 ${entry.photo} 不存在：只有 photo-1 到 photo-${photoCount}`);
      continue;
    }
    if (seen.has(index)) {
      errors.push(`photos 里 ${entry.photo} 写了两次：一张图一条`);
      continue;
    }
    seen.add(index);
    if (!entry.useInVideo) continue;
    if (entry.kind === "person") {
      errors.push(`${entry.photo} 是真人照片（kind = person）却标了 useInVideo：真人照片不带给出片模型，改成 false，人用文字写`);
      continue;
    }
    usable.push({ index, referenceId: entry.photo, kind: entry.kind, role: entry.role });
  }
  /// 实拍商品图在前；同一类里按给图的顺序。超过上限的丢掉后面的——脚本里还指着它的话，下面会报出来
  const ordered = [...usable.filter((photo) => photo.kind === "product"), ...usable.filter((photo) => photo.kind !== "product")];
  const selected = ordered.slice(0, maxVideoPhotos);
  /// 商品片要有实拍商品图；探厂 / 探店这类拍场所的片可以只有场景图（kind = scene）
  if (selected.length === 0) {
    errors.push("photos 里至少要有一张 useInVideo = true 的实拍图（商品写 kind = product，场所写 kind = scene）：出片没有实拍图，画面会走样");
  }
  return { selected, errors };
}

function writerChecks(draft: DirectorDraft, brief: WriterBrief, plan: PhotoPlan): DirectorLint {
  const errors: string[] = [...plan.errors];
  const warnings: string[] = [];
  if (brief.genre && draft.genre !== brief.genre) errors.push(`genre 写成了 ${draft.genre}：商家定的是 ${brief.genre}，照它写`);

  const imageOf = new Map(plan.selected.map((photo, order) => [photo.index, order + 1]));
  const brand = brief.brandName && brief.brandName.length >= 2 ? brief.brandName : null;
  for (const { path, text } of proseFields(draft)) {
    if (/\bimage\s*\d+\b/iu.test(text)) errors.push(`${path} 里写了 image N：指图一律写 photo-N（例 photo-1），编号由代码换`);
    for (const match of text.matchAll(/\bphoto-(\d+)\b/giu)) {
      if (!imageOf.has(Number(match[1]))) errors.push(`${path} 指向 ${match[0]}，这张图没有带给出片模型（不存在、没标 useInVideo 或超过了张数上限）：换一张带了的，或用文字写`);
    }
    if (brand && includesText(text, brand)) errors.push(`${path} 里出现了品牌名「${brand}」：品牌名不进任何画面描述（模型会照着画字，画出来是错的），删掉或换个说法`);
  }

  const merchantText = [brief.productName ?? "", brief.description, ...brief.sellingPoints, brief.productSize ?? "", brief.cta ?? ""].join("\n");
  const brandSpeakable = brand ? includesText(brief.description, brand) : false;
  let cjkLines = 0;
  let allLines = 0;
  draft.shots.forEach((shot, index) => {
    for (const line of spokenLinesOf(shot.sound)) {
      allLines += 1;
      if (CJK.test(line)) cjkLines += 1;
      if (brief.voiceLanguage === "en-US" && CJK.test(line)) errors.push(`镜头 ${index + 1} 的台词是中文：这条片的台词要用英文念`);
      if (brand && !brandSpeakable && includesText(line, brand)) errors.push(`镜头 ${index + 1} 的台词念了品牌名「${brand}」：商家的描述里没有它，不能念`);
      for (const number of line.match(/\d+(?:\.\d+)?%?/gu) ?? []) {
        if (!merchantText.includes(number)) warnings.push(`镜头 ${index + 1} 的台词里有数字 ${number}，商家给的内容里没有：不编数字，删掉或换成商家说过的`);
      }
      for (const claim of line.match(ABSOLUTE_CLAIMS) ?? []) {
        if (!includesText(merchantText, claim)) warnings.push(`镜头 ${index + 1} 的台词说了「${claim}」，商家给的内容里没有：不说绝对化、医疗或无依据的话`);
      }
    }
  });
  if (brief.voiceLanguage === "zh-CN" && allLines > 0 && cjkLines === 0) errors.push("台词全是英文：这条片的台词要用中文念");
  /// 开场画面里「商品还没用上」只能正面写：出图时商品实拍图是带着的，模型看到否定写法照样把商品画在使用位置上
  /// （2026-11-18 口水巾：写着 without a bib，线上线下五张里四张都给宝宝戴上了；改成正面写法后一次就对）
  const negated = draft.openingFrame.match(OPENING_FRAME_NEGATION);
  if (negated) {
    warnings.push(
      `openingFrame 里用了否定写法（${negated[0]}）：出图模型不听否定，会把商品照样画在使用的位置上。改成正面写——商品此刻在画面的哪里（例：the folded bibs lie on the tray），原来该有它的位置现在是什么（例：only the plain cream romper on the chest）`,
    );
  }

  /// 下面几条是 2026-11-18 十条口水巾真机之后加的：都只是「送回去改」，改不好不算失败（提醒随稿留着）
  /// 1) 台词照着商家描述念：商家自己写了口播稿的不查（那份就是要照念的）
  if (!brief.description.includes(MERCHANT_SCRIPT_MARKER)) {
    draft.shots.forEach((shot, index) => {
      for (const line of spokenLinesOf(shot.sound)) {
        const echoed = echoedFromDescription(line, brief.description);
        if (echoed) {
          warnings.push(`镜头 ${index + 1} 的台词「${line}」是照着商家的描述念的（「${echoed}」一字不差）：换成平时说话的句子，说它给买家带来什么，意思不变`);
        }
      }
    });
  }
  /// 1.5) 物理动作（真机里的「幻觉」大多出在这两处）
  draft.shots.forEach((shot, index) => {
    const action = shot.action.replace(/^hard cut\.\s*/iu, "");
    const moves = new Set((action.toLowerCase().match(ACTION_VERBS) ?? []).map((move) => move.split(" ")[0]));
    if (moves.size >= MOVES_PER_SHOT_MAX + 1) {
      warnings.push(`镜头 ${index + 1} 里有 ${moves.size} 个动作（${[...moves].join("、")}）：${shot.toSec - shot.fromSec} 秒只够做完一个，留下最要紧的那一个，其余拆到别的镜头或删掉`);
    }
    const fluid = `${shot.action} ${shot.framing}`.match(BODY_FLUIDS);
    if (fluid) {
      warnings.push(`镜头 ${index + 1} 拍了从身体里出来的液体（${fluid[0]}）：出片模型会把它画成一道浓稠的浆。改成一滴清水从小勺落下（one clear water drop from a teaspoon），写清落在哪、最后留下什么`);
    }
  });
  /// 2) 「下巴以下」的半身镜头太多：看着是一个没有头的人
  const chinShots = draft.shots.filter((shot) => /cropped below the chin/iu.test(`${shot.action} ${shot.framing}`)).length;
  if (chinShots > CHIN_CROP_SHOTS_MAX) {
    warnings.push(`有 ${chinShots} 个镜头是 cropped below the chin：最多 ${CHIN_CROP_SHOTS_MAX} 个。其余改成只拍手（hands only）、贴近商品的特写，或者让该露脸的人露脸（face visible）`);
  }
  /// 3) 结尾定格要照整件商品的那张图摆：真机里对着图摆的结尾和商品图一模一样，没指图的出过纯黑背景、多出两三件
  const productPhotos = plan.selected.filter((photo) => photo.kind === "product");
  const lastShot = draft.shots.at(-1);
  if (productPhotos.length > 0 && lastShot && !/\bphoto-\d+\b/iu.test(`${lastShot.action} ${lastShot.framing}`)) {
    warnings.push(`最后一个镜头没有指向商品图：结尾定格照整件商品的那张图摆（例：arranged as in ${productPhotos[0]!.referenceId}），并写清放在什么面上、一共几件`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// 草稿 → DirectorJob
// ---------------------------------------------------------------------------

function defaultJobId(brief: WriterBrief): string {
  return `dw-${createHash("sha256").update(JSON.stringify(brief)).digest("hex").slice(0, 16)}`;
}

function jobTitle(brief: WriterBrief, genre: DirectorGenre): string {
  const name = (brief.productName ?? brief.description).replace(/\s+/gu, " ").slice(0, 60);
  return `${name} · ${genre === "fmcg" ? "快销版" : "生活方式版"} ${brief.durationSec} 秒`;
}

function assembleJob(draft: DirectorDraft, brief: WriterBrief, plan: PhotoPlan, jobId: string): unknown {
  const imageOf = new Map(plan.selected.map((photo, order) => [photo.index, order + 1]));
  /// photo-N → image K：K 是这张图在出片参考图里排第几。开场帧带的是同一组图、同一个顺序，所以两处编号一致
  const numbered = (text: string) => text.replace(/\bphoto-(\d+)\b/giu, (token, index: string) => (imageOf.has(Number(index)) ? `image ${imageOf.get(Number(index))}` : token));
  const ids = plan.selected.map((photo) => photo.referenceId);
  return {
    id: jobId,
    title: jobTitle(brief, draft.genre),
    genre: draft.genre,
    productType: draft.productType,
    aspectRatio: brief.aspectRatio,
    durationSec: brief.durationSec,
    references: plan.selected.map((photo) => ({
      id: photo.referenceId,
      source: brief.photos[photo.index - 1]!.url,
      kind: photo.kind,
      role: numbered(photo.role),
    })),
    frames: [{ id: "opening", prompt: numbered(draft.openingFrame), references: ids, variants: 1 }],
    video: {
      openingFrame: "opening",
      references: ids,
      logline: numbered(draft.logline),
      look: numbered(draft.look),
      openingState: numbered(draft.openingState),
      ...(draft.voice ? { voice: draft.voice } : {}),
      ...(draft.music ? { music: draft.music } : {}),
      shots: draft.shots.map((shot) => ({
        fromSec: shot.fromSec,
        toSec: shot.toSec,
        action: numbered(shot.action),
        ...(shot.space ? { space: numbered(shot.space) } : {}),
        framing: numbered(shot.framing),
        camera: numbered(shot.camera),
        ...(shot.light ? { light: numbered(shot.light) } : {}),
        sound: numbered(shot.sound),
        ...(shot.proof ? { proof: true } : {}),
      })),
      endState: numbered(draft.endState),
      throughout: draft.throughout.map(numbered),
    },
    post: { captions: true },
  };
}

// ---------------------------------------------------------------------------
// 查一稿
// ---------------------------------------------------------------------------

function issueLines(error: z.ZodError): string[] {
  const lines = error.issues.slice(0, 16).map((issue) => `${issue.path.join(".") || "(根)"}：${issue.message}`);
  return error.issues.length > 16 ? [...lines, `…另有 ${error.issues.length - 16} 处`] : lines;
}

/** 模型爱把没写的可选项交成 null 或空串：当作没写（和去首尾空白一样，不算替它改稿）。 */
function dropEmptyOptionals(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const blank = (value: unknown) => value === null || (typeof value === "string" && value.trim() === "");
  const draft: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of ["voice", "music"]) if (blank(draft[key])) delete draft[key];
  if (Array.isArray(draft.shots)) {
    draft.shots = draft.shots.map((shot: unknown) => {
      if (!shot || typeof shot !== "object" || Array.isArray(shot)) return shot;
      const copy: Record<string, unknown> = { ...(shot as Record<string, unknown>) };
      for (const key of ["space", "light", "proof", "note"]) if (blank(copy[key])) delete copy[key];
      return copy;
    });
  }
  return draft;
}

type Evaluation =
  | { kind: "invalid"; problems: string[] }
  | {
      kind: "checked";
      draft: DirectorDraft;
      /// 拼不出脚本（一张能用的图都没有）时是 null
      job: DirectorJob | null;
      plan: PhotoPlan;
      lint: DirectorLint;
      /// 必须改的：全部错误 + 不能认的提醒
      mustFix: string[];
      /// 其余提醒：顺手带给模型，改不改都不拦
      alsoNoted: string[];
    };

function evaluateDraft(raw: unknown, brief: WriterBrief, options: { jobId: string; maxVideoPhotos: number }): Evaluation {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { kind: "invalid", problems: ["交回来的不是 JSON：只交一个 JSON 对象，前后不要有别的字"] };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "invalid", problems: ["交回来的不是一个 JSON 对象"] };
  }
  const parsed = directorDraftSchema.safeParse(dropEmptyOptionals(value));
  if (!parsed.success) return { kind: "invalid", problems: issueLines(parsed.error) };
  const draft = parsed.data;

  const plan = planPhotos(draft, Math.min(brief.photos.length, DIRECTOR_WRITER_PHOTOS_MAX), options.maxVideoPhotos);
  const own = writerChecks(draft, brief, plan);
  if (plan.selected.length === 0) {
    return { kind: "checked", draft, job: null, plan, lint: own, mustFix: [...own.errors, ...own.warnings], alsoNoted: [] };
  }
  const assembled = directorJobSchema.safeParse(assembleJob(draft, brief, plan, options.jobId));
  if (!assembled.success) return { kind: "invalid", problems: issueLines(assembled.error) };
  const job = assembled.data;
  const director = lintDirectorJob(job);
  const lint: DirectorLint = { errors: [...own.errors, ...director.errors], warnings: [...own.warnings, ...director.warnings] };
  const blocking = director.warnings.filter((warning) => isBlockingDirectorWarning(warning, job.durationSec));
  return {
    kind: "checked",
    draft,
    job,
    plan,
    lint,
    mustFix: [...lint.errors.map((error) => withLengthBudget(error, draft)), ...own.warnings, ...blocking.map((warning) => `${warning} (${blockingRule(warning, job.durationSec)!.hint})`)],
    alsoNoted: director.warnings.filter((warning) => !blocking.includes(warning)),
  };
}

/**
 * 超字数那一条错误只说「超了」，模型不会数字数，三稿常常在上限附近来回（11-18 五份 30 秒脚本里两份因此写不成）。
 * 这里补上要删多少、哪几个镜头最长、每一项按词数该多长，模型照着删就够。
 */
function withLengthBudget(error: string, draft: DirectorDraft): string {
  const over = error.match(/出片提示词 (\d+) 字，超过 (\d+)/u);
  if (!over) return error;
  const excess = Number(over[1]) - Number(over[2]);
  const sizes = draft.shots.map((shot, index) => ({
    shot: index + 1,
    chars: [shot.action, shot.framing, shot.camera, shot.sound, shot.space ?? "", shot.light ?? ""].join("").length,
  }));
  const longest = [...sizes].sort((a, b) => b.chars - a.chars).slice(0, 4);
  const cut = excess + LENGTH_REPAIR_MARGIN;
  return `${error} (cut at least ${cut} characters and keep the shot count. Longest shots: ${longest
    .map((entry) => `shot ${entry.shot} = ${entry.chars}`)
    .join(", ")}; bring every shot to ${Math.max(180, Math.round((sizes.reduce((sum, entry) => sum + entry.chars, 0) - cut) / sizes.length))} or fewer. Per shot: action at most 25 words, framing 8, camera 5, sound 8 plus the line; space and light only in shot 1 and where the place changes; throughout entries at most 12 words each)`;
}
/// 返修时多删一点：模型数不准，只删到刚好会再超
const LENGTH_REPAIR_MARGIN = 150;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// 写一份脚本
// ---------------------------------------------------------------------------

/**
 * 让模型写一份镜头脚本，拼成 `DirectorJob` 并校验；不合格就带着原稿和校验的原话让它改，最多三稿。
 *
 * - 有错误、或有不能认的提醒（节奏、台词念不完、有人没写脸在哪、画面描述里带引号、提示词超过每秒目标、开场帧露脸、
 *   写手自己查出的无依据说法）就送回去；三稿之后还有错误 → `lint_failed`，只剩提醒 → 照样交付，提醒留在 `lint` 里。
 * - 交回来的不是合格的 JSON → 同样送回去改；第三稿还不是 → `invalid_output`。
 * - 模型调用抛错 → `model_unavailable`，不再重试（回退链是 `deps.complete` 自己的事）。
 * - 输入本身不合格（没有图、没有描述）直接抛 ZodError：那是调用方的问题，不是这一稿的问题。
 */
export async function writeDirectorJob(input: DirectorWriterInput, deps: DirectorWriterDeps): Promise<DirectorWriterResult> {
  const brief = directorWriterInputSchema.parse(input);
  const maxVideoPhotos = clampVideoPhotos(deps.maxVideoPhotos);
  const jobId = deps.jobId ?? defaultJobId(brief);
  if (!directorJobSchema.shape.id.safeParse(jobId).success) throw new Error(`jobId 不合格（${jobId}）：只能用小写字母、数字和连字符，1–48 个字符`);
  const photos = brief.photos.slice(0, DIRECTOR_WRITER_PHOTOS_MAX);
  const images = photos.map((photo) => photo.url);
  const base = briefMessage(brief, maxVideoPhotos);
  const modelName = () => deps.model ?? deps.complete.model ?? "unknown";

  let previous: { attempt: number; raw: unknown; mustFix: string[]; alsoNoted: string[] } | null = null;
  /// 前面哪一稿已经零错误（只剩提醒）：最后一稿改坏了就交它，别因为返修把一份能用的脚本弄丢
  let fallback: Extract<Evaluation, { kind: "checked" }> | null = null;
  const deliver = (evaluation: Extract<Evaluation, { kind: "checked" }>, attempt: number): DirectorWriterResult => {
    const { draft, lint, plan } = evaluation;
    const job = evaluation.job!;
    const imageOf = new Map(plan.selected.map((photo, order) => [photo.index, order + 1]));
    const described = new Map(draft.photos.map((entry) => [Number(entry.photo.slice("photo-".length)), entry]));
    return {
      ok: true,
      job,
      lint,
      attempts: attempt,
      model: modelName(),
      scenario: {
        ...draft.scenario,
        productType: draft.productType,
        productTypeReason: draft.productTypeReason,
        genre: draft.genre,
        genreReason: draft.genreReason,
      },
      shotNotes: draft.shots.map((shot) => shot.note ?? null),
      references: photos.map((photo, index) => {
        const entry = described.get(index + 1);
        const used = job.references.find((reference) => reference.id === `photo-${index + 1}`);
        return {
          photoId: photo.id,
          referenceId: `photo-${index + 1}`,
          url: photo.url,
          kind: entry?.kind ?? "product",
          role: used?.role ?? entry?.role ?? "",
          videoImage: imageOf.get(index + 1) ?? null,
        };
      }),
    };
  };
  for (let attempt = 1; attempt <= DIRECTOR_WRITER_MAX_ATTEMPTS; attempt += 1) {
    let raw: unknown;
    try {
      raw = await deps.complete({
        system: DIRECTOR_WRITER_SYSTEM_PROMPT,
        user: previous ? repairMessage(base, previous) : base,
        images,
        schemaName: DIRECTOR_WRITER_SCHEMA_NAME,
      });
    } catch (error) {
      return { ok: false, reason: "model_unavailable", attempts: attempt, lastErrors: [errorText(error)] };
    }
    const evaluation = evaluateDraft(raw, brief, { jobId, maxVideoPhotos });
    const last = attempt === DIRECTOR_WRITER_MAX_ATTEMPTS || deps.outOfTime?.() === true;

    if (evaluation.kind === "invalid") {
      deps.onAttempt?.({ attempt, outcome: "invalid", problems: evaluation.problems });
      if (last) return fallback ? deliver(fallback, attempt) : { ok: false, reason: "invalid_output", attempts: attempt, lastErrors: evaluation.problems };
      previous = { attempt, raw, mustFix: evaluation.problems, alsoNoted: [] };
      continue;
    }

    const { job, lint } = evaluation;
    const usable = job !== null && lint.errors.length === 0;
    const clean = evaluation.mustFix.length === 0;
    deps.onAttempt?.({ attempt, outcome: clean ? "clean" : "send_back", problems: evaluation.mustFix });
    if (!clean && !last) {
      if (usable) fallback = evaluation;
      previous = { attempt, raw, mustFix: evaluation.mustFix, alsoNoted: evaluation.alsoNoted };
      continue;
    }
    if (usable) return deliver(evaluation, attempt);
    if (fallback) return deliver(fallback, attempt);
    return { ok: false, reason: "lint_failed", attempts: attempt, lastErrors: lint.errors };
  }
  /// 走不到这里：循环的最后一稿一定会 return
  return { ok: false, reason: "lint_failed", attempts: DIRECTOR_WRITER_MAX_ATTEMPTS, lastErrors: [] };
}

/**
 * 脚本存盘 / 入库用的样子：去掉解析时补上的缺省项（空的 cuts、keyframes，没开的 sheet，缺省的角标位置与深浅）。
 * 存下来的东西接下来是给人看、给人改的；再用 `parseDirectorJob` 读回来与原件一致（有单测）。
 */
export function compactDirectorJob(job: DirectorJob): Record<string, unknown> {
  const { cuts, post, frames, video, ...rest } = job;
  const { keyframes, ...videoRest } = video;
  return {
    ...rest,
    frames: frames.map(({ sheet, ...frame }) => (sheet ? { ...frame, sheet } : frame)),
    video: keyframes.length > 0 ? { ...videoRest, keyframes } : videoRest,
    ...(cuts.length > 0 ? { cuts } : {}),
    ...(post
      ? {
          post: {
            captions: post.captions,
            ...(post.logo ? { logo: post.logo } : {}),
            ...(post.logoPosition !== "top-right" ? { logoPosition: post.logoPosition } : {}),
            ...(post.logoTone !== "light" ? { logoTone: post.logoTone } : {}),
            ...(post.signoff ? { signoff: post.signoff } : {}),
          },
        }
      : {}),
  };
}

/// 仅供测试导入
export const __test__ = { evaluateDraft };
