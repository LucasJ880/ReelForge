/**
 * 导演线路的纯逻辑（2026-11-16）：Claude 当导演与编剧写镜头脚本 → OpenAI gpt-image-2 出故事板 →
 * Shuyu Seedance 出片。CLI 在 scripts/director/run.ts，规程在 .claude/skills/aivora-director/SKILL.md。
 *
 * 这里不读环境变量、不触网、不碰数据库：脚本文件的校验、提示词拼装、出片套餐的画质阶梯、花费估算、
 * 幂等键，全部可以单测。写法照 10-29 吸收的 Kelin 团队经验（docs/roadmap/2026-10-29-kelin-workflow-lessons.md）：
 * 全程英文、每个镜头六项齐全、参考图各管一件事、提示词按固定顺序拼紧凑。
 *
 * 2026-11-16 第二版：先定片种（快销 / 生活方式）再写镜头，节奏按片种检查；提示词顺序、整数秒时间码、
 * 「否定句只在字幕与声音上管用」照 Seedance 2.5 官方提示词指南改（经 EVZheng-Lab/h3-seedance-prompt 转述，
 * 2026-08 快照）；口播 / 配乐 / 抽象形容词 / 只写「快」的检查借鉴了几个开源 skill 的做法
 *（zhouwei713/seedance-prompt、LeoYeAI/seedance-skills、liangdabiao/ecom-video-seedance-prompt 等，只取做法，不搬原文）。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  shuyuVideoPlanFamily,
  type ShuyuVideoPlanFamily,
} from "../../src/lib/providers/shuyu-video-plan-tiers";

export const DIRECTOR_ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
export type DirectorAspectRatio = (typeof DIRECTOR_ASPECT_RATIOS)[number];

/** Shuyu 单段提示词上限 5000（storyboard-beats.ts 的 VIDEO_PROMPT_LIMIT），留 200 余量。 */
export const DIRECTOR_VIDEO_PROMPT_MAX = 4_800;
/**
 * 紧凑的目标：每秒不超过这么多字。官方 30 秒 9 镜头的例子约 1,200 个汉字；我们全英文（同样的意思英文字符数约多一倍）、
 * 每个镜头带标签，六镜头的快销片压到 3,300 字上下已经没有重复内容了，所以定在 240 字 / 秒。这是经验数，不是测出来的阈值。
 */
export const DIRECTOR_VIDEO_PROMPT_TARGET_PER_SEC = 240;
/** 故事板帧提示词上限：与线上出帧同一个数（fitStoryboardFramePrompt 的 5000），留余量。 */
export const DIRECTOR_FRAME_PROMPT_MAX = 4_800;
/** Shuyu 适配器的参考图硬顶（shuyu.ts 的 SHUYU_MAX_REFERENCE_IMAGES）。 */
export const DIRECTOR_VIDEO_REFERENCES_MAX = 9;
/** gpt-image-2 的 images.edit 最多收 16 张输入图。 */
export const DIRECTOR_FRAME_REFERENCES_MAX = 16;

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/u, "只能用小写字母、数字和连字符，1–48 个字符");

const referenceSchema = z
  .object({
    id: slug,
    /// 本地文件（相对任务目录或仓库根目录）或 https 地址
    source: z.string().trim().min(1).max(2_000),
    /// 这张图管什么、不继承什么（例："product shape, slat spacing and fabric texture; ignore its background"）
    role: z.string().trim().min(12).max(280),
    kind: z.enum(["product", "person", "scene"]).default("product"),
  })
  .strict();

const frameSchema = z
  .object({
    id: slug,
    /// 这一帧的画面（英文）：首态，不提前露出主动作的结果
    prompt: z.string().trim().min(60).max(4_000),
    references: z.array(slug).max(DIRECTOR_FRAME_REFERENCES_MAX).default([]),
    /// 出几张择优（抽卡放在故事板）
    variants: z.number().int().min(1).max(4).default(2),
  })
  .strict();

/** 一个镜头的六项：主体与表演、空间 / 调度、构图、摄影机、光色、声音 / 剪辑。 */
export const DIRECTOR_SHOT_ITEMS = ["action", "space", "framing", "camera", "light", "sound"] as const;
export type DirectorShotItem = (typeof DIRECTOR_SHOT_ITEMS)[number];

/** 片种决定节奏（2026-11-16：第一条毛毯片写成了慢节奏生活方式片，用户要的是快销广告）。 */
export const DIRECTOR_GENRES = ["fmcg", "lifestyle"] as const;
export type DirectorGenre = (typeof DIRECTOR_GENRES)[number];

const shotItem = z.string().trim().min(8).max(320);
const shotSchema = z
  .object({
    /// 整数秒、首尾相接（Seedance 2.5 官方写法：留空档模型会自己加戏，塞太满会多切或丢拍）
    fromSec: z.number().int().min(0).max(30),
    toSec: z.number().int().min(1).max(30),
    action: shotItem,
    framing: shotItem,
    camera: shotItem,
    sound: shotItem,
    /// 空间与光色：第一个镜头必写；后面的镜头不写 = 沿用上一个镜头（六项照样要核对，只是不重复写进提示词）
    space: shotItem.optional(),
    light: shotItem.optional(),
  })
  .strict();

const videoSchema = z
  .object({
    /// 开场帧用哪一帧（frames 里的 id）；它排在参考图最后，视频从它开始
    openingFrame: slug,
    /// 除开场帧以外带给出片模型的参考图（实拍在前）
    references: z.array(slug).min(1).max(DIRECTOR_VIDEO_REFERENCES_MAX - 1),
    /// 一句话说清这条片：主体 + 地点 + 事件 + 风格（官方顺序里紧跟在参考图之后）
    logline: z.string().trim().min(20).max(240),
    /// 呈现方式（例："handheld phone-style product ad, bright window daylight, fast but controlled cuts"）
    look: z.string().trim().min(12).max(280),
    openingState: z.string().trim().min(20).max(600),
    shots: z.array(shotSchema).min(1).max(10),
    /// 口播的声音，只描述一次：语言、性别与年龄感、语气（例："a bright young female voice speaking Mandarin, upbeat and close-mic"）
    voice: z.string().trim().min(8).max(200).optional(),
    /// 配乐：风格、速度、乐器、走向（例："upbeat pop beat around 120 bpm, claps and plucked bass, lifts at the last shot"）
    music: z.string().trim().min(8).max(240).optional(),
    endState: z.string().trim().min(12).max(400),
    /// 从头到尾都成立的事，用正面描述写（"the blanket stays solid sage green"）。否定句模型只在字幕与声音上听话；
    /// 「不要字幕 / 画面文字」脚本会自动加，不用写
    throughout: z.array(z.string().trim().min(6).max(200)).max(5).default([]),
  })
  .strict();

export const directorJobSchema = z
  .object({
    id: slug,
    title: z.string().trim().min(1).max(120),
    /// 先定片种再写镜头：fmcg = 快销广告（开头就是钩子、镜头短、口播带劲、结尾给行动指引）；lifestyle = 生活方式片（可以慢）
    genre: z.enum(DIRECTOR_GENRES),
    aspectRatio: z.enum(DIRECTOR_ASPECT_RATIOS),
    /// Seedance 2.5 单段 4–30 秒
    durationSec: z.number().int().min(4).max(30),
    references: z.array(referenceSchema).min(1).max(DIRECTOR_FRAME_REFERENCES_MAX),
    frames: z.array(frameSchema).min(1).max(6),
    video: videoSchema,
  })
  .strict();

export type DirectorJob = z.infer<typeof directorJobSchema>;
export type DirectorFrame = DirectorJob["frames"][number];
export type DirectorReference = DirectorJob["references"][number];

export function parseDirectorJob(raw: unknown): DirectorJob {
  return directorJobSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// 提示词拼装
// ---------------------------------------------------------------------------

/** gpt-image-2 的任意分辨率要求宽高都能被 16 整除；这三个是各画幅的精确比例。 */
export function openAiFrameSize(aspectRatio: DirectorAspectRatio): string {
  if (aspectRatio === "9:16") return "1152x2048";
  if (aspectRatio === "16:9") return "2048x1152";
  return "1536x1536";
}

const ORIENTATION: Record<DirectorAspectRatio, string> = {
  "9:16": "Vertical 9:16",
  "16:9": "Horizontal 16:9",
  "1:1": "Square 1:1",
};

function lookup(job: DirectorJob, ids: readonly string[]): DirectorReference[] {
  return ids.flatMap((id) => {
    const reference = job.references.find((item) => item.id === id);
    return reference ? [reference] : [];
  });
}

function referenceRoleLines(references: ReadonlyArray<{ role: string }>): string {
  return references.map((reference, index) => `image ${index + 1} = ${reference.role}`).join("; ");
}

/** 故事板帧：导演写的画面 + 按真正提交顺序编号的参考职责 + 画幅与禁止项。 */
export function buildFramePrompt(job: DirectorJob, frame: DirectorFrame): string {
  const references = lookup(job, frame.references);
  return [
    frame.prompt,
    references.length > 0 ? `REFERENCE ROLES: ${referenceRoleLines(references)}.` : null,
    `FORMAT: ${ORIENTATION[job.aspectRatio]} photorealistic still frame, the opening moment of a product video. No on-screen text, captions, watermarks, logos that are not on the product, borders or collage layouts.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 出片参考图的顺序：脚本里列的参考图（实拍在前）→ 开场帧最后。提示词里的 image N 与它一一对应。 */
export function videoReferenceOrder(job: DirectorJob): Array<{ id: string; role: string; openingFrame: boolean }> {
  return [
    ...lookup(job, job.video.references).map((reference) => ({ id: reference.id, role: reference.role, openingFrame: false })),
    {
      id: job.video.openingFrame,
      /// 不写「保持构图」：后面的镜头可以硬切换景别，只锁场景与光
      role: "the exact opening frame: the video starts on this image; keep its setting, props and light throughout",
      openingFrame: true,
    },
  ];
}

function seconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 自动加在最后的一句：否定句里模型最听话的就是字幕与画面文字。 */
export const DIRECTOR_NO_TEXT_LINE = "No subtitles, no captions, no on-screen text";

/**
 * 出片提示词。顺序照 Seedance 2.5 官方写法：参考图对应 → 一句话梗概（画幅、时长、呈现方式跟在后面）→
 * 首态 → 按整数秒首尾相接的镜头 → 声音 → 尾态 → 全程成立的事。
 * 台词写在它被念出来的那个镜头的 sound 里（英文双引号内，可以是商家原文），声音只在 voice 里描述一次。
 */
export function buildVideoPrompt(job: DirectorJob): string {
  const { video } = job;
  const timeline = video.shots
    .map((shot, index) =>
      [
        `Shot ${index + 1} (${seconds(shot.fromSec)}-${seconds(shot.toSec)}s): ${shot.action}`,
        shot.space ? `Space: ${shot.space}` : null,
        `Framing: ${shot.framing}`,
        `Camera: ${shot.camera}`,
        shot.light ? `Light: ${shot.light}` : null,
        `Sound: ${shot.sound}`,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
  const audio = [
    video.voice ? `Voice: ${video.voice}` : null,
    video.music ? `Music: ${video.music}` : null,
    video.voice ? "Mix: the voice is clean and prominent, music sits lower under it" : null,
  ].filter(Boolean);
  return [
    `REFERENCES: ${referenceRoleLines(videoReferenceOrder(job))}.`,
    `${ORIENTATION[job.aspectRatio]}, ${job.durationSec} seconds. ${video.logline} ${video.look}`,
    `OPENING STATE: ${video.openingState}`,
    `TIMELINE:\n${timeline}`,
    audio.length > 0 ? `AUDIO: ${audio.join(". ")}.` : null,
    `END STATE: ${video.endState}`,
    `THROUGHOUT: ${[...video.throughout, DIRECTOR_NO_TEXT_LINE].join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// 出图 / 出片之前的检查
// ---------------------------------------------------------------------------

export interface DirectorLint {
  /// 有任何一条就不许花钱
  errors: string[];
  /// 提醒：导演看过、认了才继续
  warnings: string[];
}

/// 中日韩文字（提示词必须全英文；台词放在英文双引号里不算）
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/u;

function outsideQuotes(text: string): string {
  return text.replace(/"[^"]*"/gu, '""');
}

/// 清晰正脸会让 Seedance 把参考图整单拦下（10-29 评测 5 条全败）
const FACE_RISK = /\b(face|faces|facial|portrait|headshot|selfie|looking (?:straight )?(?:at|into) (?:the )?camera|eye contact|smil(?:e|es|ing) (?:at|to) (?:the )?camera)\b/iu;
const FACE_SAFE = /\b(no (?:visible )?face|face (?:is )?(?:not visible|out of frame|cropped out|turned away)|faceless|from behind|back to (?:the )?camera|hands only|only (?:her|his|their) hands)\b/iu;

/// 抽象形容词：模型不知道怎么拍，换成看得见的物理现象（光从哪来、材质怎么动）
const VAGUE_WORDS = /\b(beautiful|stunning|gorgeous|amazing|awesome|epic|perfect|cinematic|premium|luxurious|high[- ]quality|masterpiece|dynamic)\b/giu;
/// 只写「快」镜头会乱：写 fast but controlled（fast-paced 说的是节奏，不算）
const BARE_FAST = /\b(?:fast|quick|quickly|rapid|rapidly)\b(?![- ]paced)(?! but controlled)/iu;
/// 否定句：模型只在字幕与声音上听话
const NEGATIVE_LEAD = /^(?:no|never|don't|do not|without|avoid)\b/iu;
const NEGATIVE_OK = /\b(subtitle|caption|text|voice|dialogue|music|bgm|sound)/iu;
const TEXT_TOPIC = /\b(subtitles?|captions?|on-screen text)\b/iu;

/** 一个镜头里要念的台词量：引号里的中日韩字数与英文词数。 */
export function spokenLoad(text: string): { cjk: number; words: number } {
  const quoted = [...text.matchAll(/"([^"]*)"/gu)].map((match) => match[1] ?? "").join(" ");
  const cjk = [...quoted].filter((char) => CJK.test(char)).length;
  const words = quoted.replace(new RegExp(CJK.source, "gu"), " ").split(/\s+/u).filter((word) => /[a-z0-9]/iu.test(word)).length;
  return { cjk, words };
}

/// 首帧不该提前露出结果
const RESULT_SPOILER = /\b(already|fully) (?:open(?:ed)?|installed|assembled|finished|applied|poured|unboxed)\b/iu;

export function lintDirectorJob(job: DirectorJob): DirectorLint {
  const errors: string[] = [];
  const warnings: string[] = [];
  const referenceIds = new Set<string>();
  for (const reference of job.references) {
    if (referenceIds.has(reference.id)) errors.push(`参考图 id 重复：${reference.id}`);
    referenceIds.add(reference.id);
  }
  const frameIds = new Set<string>();
  for (const frame of job.frames) {
    if (frameIds.has(frame.id)) errors.push(`故事板帧 id 重复：${frame.id}`);
    if (referenceIds.has(frame.id)) errors.push(`故事板帧 id 与参考图 id 撞了：${frame.id}`);
    frameIds.add(frame.id);
    for (const id of frame.references) {
      if (!referenceIds.has(id)) errors.push(`帧 ${frame.id} 引用了不存在的参考图：${id}`);
    }
    if (new Set(frame.references).size !== frame.references.length) errors.push(`帧 ${frame.id} 的参考图有重复`);
    const prompt = buildFramePrompt(job, frame);
    if (prompt.length > DIRECTOR_FRAME_PROMPT_MAX) {
      errors.push(`帧 ${frame.id} 的提示词 ${prompt.length} 字，超过 ${DIRECTOR_FRAME_PROMPT_MAX}`);
    }
    if (CJK.test(outsideQuotes(frame.prompt))) errors.push(`帧 ${frame.id} 的提示词里有非英文内容（全程英文；台词放英文双引号里）`);
    if (FACE_RISK.test(frame.prompt) && !FACE_SAFE.test(frame.prompt)) {
      warnings.push(`帧 ${frame.id} 可能出现清晰正脸：Seedance 会把带正脸的参考图整单拦下，开场帧尽量用手部、侧背或商品主体`);
    }
    if (frame.references.length === 0) {
      warnings.push(`帧 ${frame.id} 没带任何参考图：商品会是模型凭空画的，和实物对不上`);
    }
  }
  if (!job.references.some((reference) => reference.kind === "product")) {
    errors.push("至少要有一张商品实拍图（kind = product）");
  }

  const { video } = job;
  if (!frameIds.has(video.openingFrame)) errors.push(`开场帧 ${video.openingFrame} 不在 frames 里`);
  for (const id of video.references) {
    if (!referenceIds.has(id)) errors.push(`出片引用了不存在的参考图：${id}`);
  }
  if (new Set(video.references).size !== video.references.length) errors.push("出片的参考图有重复");
  if (!lookup(job, video.references).some((reference) => reference.kind === "product")) {
    errors.push("出片的参考图里要有商品实拍图：只靠开场帧，后面的镜头里商品会走样");
  }

  /// 时间线：从 0 开始、首尾相接、正好铺满时长；每个镜头至少 2 秒
  let cursor = 0;
  video.shots.forEach((shot, index) => {
    const label = `镜头 ${index + 1}`;
    if (Math.abs(shot.fromSec - cursor) > 0.01) errors.push(`${label} 应从 ${seconds(cursor)} 秒开始（现在是 ${seconds(shot.fromSec)} 秒）`);
    const length = shot.toSec - shot.fromSec;
    if (length <= 0) errors.push(`${label} 的结束时间不晚于开始时间`);
    else if (job.genre === "fmcg" ? length > 4 : length < 2) {
      warnings.push(
        job.genre === "fmcg"
          ? `${label} 有 ${length} 秒：快销广告一个镜头 1–3 秒，超过 4 秒就拖了，拆开或删掉`
          : `${label} 只有 ${length} 秒：一拍一个主动作，太短模型做不完`,
      );
    }
    cursor = shot.toSec;
    if (index === 0 && (!shot.space || !shot.light)) errors.push("镜头 1 必须写 space 和 light：后面的镜头不写才有东西可沿用");
    for (const item of DIRECTOR_SHOT_ITEMS) {
      if (CJK.test(outsideQuotes(shot[item] ?? ""))) errors.push(`${label} 的 ${item} 里有非英文内容（台词放英文双引号里）`);
    }
    if (/\b(then|after that|next,|followed by|and then)\b/iu.test(shot.action)) {
      warnings.push(`${label} 的 action 里像是写了不止一个主动作（then / after that）：一拍只做一件事`);
    }
    if (BARE_FAST.test(shot.camera)) warnings.push(`${label} 的 camera 只写了「快」：写成 fast but controlled，不然画面会乱`);
    /// 念得完吗：中文约 4 字 / 秒，快销口播可以到 5；英文约 2.5 词 / 秒
    const spoken = spokenLoad(shot.sound);
    if (length > 0 && (spoken.cjk > 5 * length || spoken.words > 3 * length)) {
      warnings.push(`${label} 的台词 ${length} 秒念不完（${spoken.cjk > 0 ? `${spoken.cjk} 个字` : `${spoken.words} 个词`}）：缩短台词或挪一部分到下一个镜头`);
    }
  });
  const hasDialogue = video.shots.some((shot) => {
    const spoken = spokenLoad(shot.sound);
    return spoken.cjk + spoken.words > 0;
  });
  if (hasDialogue && !video.voice) warnings.push("有台词但没写 voice：把口播的语言、性别与年龄感、语气描述一次（例：a bright young female voice speaking Mandarin）");
  if (job.genre === "fmcg") {
    const first = video.shots[0];
    if (first && first.toSec - first.fromSec > 2) warnings.push("快销广告的钩子要在 2 秒内：镜头 1 放最抓人的那一下（触感、对比、结果），别铺垫");
    const wanted = Math.ceil(job.durationSec / 3);
    if (video.shots.length < wanted) warnings.push(`快销广告 ${job.durationSec} 秒至少 ${wanted} 个镜头（现在 ${video.shots.length} 个）：节奏靠切，不靠慢动作`);
    if (!video.music) warnings.push("快销广告要写 music：风格、速度、乐器（例：upbeat pop beat around 120 bpm），切点才有拍子可跟");
    if (!hasDialogue) warnings.push("快销广告没有口播：至少一句卖点和一句结尾的行动指引");
  }
  if (Math.abs(cursor - job.durationSec) > 0.01) {
    errors.push(`镜头铺到 ${seconds(cursor)} 秒，时长是 ${job.durationSec} 秒：要正好铺满`);
  }
  const prose: Array<readonly [string, string]> = [
    ["logline", video.logline],
    ["look", video.look],
    ["openingState", video.openingState],
    ["endState", video.endState],
    ...(video.voice ? [["voice", video.voice] as const] : []),
    ...(video.music ? [["music", video.music] as const] : []),
    ...video.throughout.map((text) => ["throughout", text] as const),
  ];
  for (const [name, text] of prose) {
    if (CJK.test(outsideQuotes(text))) errors.push(`${name} 里有非英文内容`);
  }
  const vague = new Set<string>();
  for (const text of [...prose.map(([, value]) => value), ...video.shots.flatMap((shot) => DIRECTOR_SHOT_ITEMS.map((item) => shot[item] ?? "")), ...job.frames.map((frame) => frame.prompt)]) {
    for (const match of outsideQuotes(text).matchAll(VAGUE_WORDS)) vague.add(match[0].toLowerCase());
  }
  if (vague.size > 0) warnings.push(`抽象形容词模型拍不出来（${[...vague].join(", ")}）：换成看得见的东西——光从哪来、材质怎么动`);
  for (const text of video.throughout) {
    if (TEXT_TOPIC.test(text)) warnings.push(`throughout 里不用写字幕 / 画面文字（脚本会自动加）：${text}`);
    else if (NEGATIVE_LEAD.test(text) && !NEGATIVE_OK.test(text)) warnings.push(`throughout 用正面描述写，否定句模型不听（${text}）：例 "only hands and the back of the head are seen"`);
  }
  if (RESULT_SPOILER.test(video.openingState)) {
    warnings.push("openingState 像是提前露出了结果（already / fully …）：首帧放在主动作发生之前的清楚状态");
  }
  const normalized = video.throughout.map((text) => text.toLowerCase().replace(/[^a-z0-9 ]/gu, "").trim());
  if (new Set(normalized).size !== normalized.length) warnings.push("throughout 里有重复的内容");

  const prompt = buildVideoPrompt(job);
  if (prompt.length > DIRECTOR_VIDEO_PROMPT_MAX) {
    errors.push(`出片提示词 ${prompt.length} 字，超过 ${DIRECTOR_VIDEO_PROMPT_MAX}：删限制、并镜头，别指望截断`);
  } else if (prompt.length > DIRECTOR_VIDEO_PROMPT_TARGET_PER_SEC * job.durationSec) {
    warnings.push(
      `出片提示词 ${prompt.length} 字，${job.durationSec} 秒的片写到 ${DIRECTOR_VIDEO_PROMPT_TARGET_PER_SEC * job.durationSec} 字以内更稳：太长模型会丢层。参考图已经说清的别再用文字描述一遍`,
    );
  }
  const order = videoReferenceOrder(job);
  if (order.length > DIRECTOR_VIDEO_REFERENCES_MAX) {
    errors.push(`出片参考图 ${order.length} 张，超过 ${DIRECTOR_VIDEO_REFERENCES_MAX}`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Shuyu 出片套餐阶梯
// ---------------------------------------------------------------------------

/** /prices 里一档视频套餐，导演线路用得到的字段（shuyuPriceSchema 解析后的形状）。 */
export interface DirectorPriceEntry {
  plan_id: string;
  kind: "image" | "video";
  model: string;
  unit: "generation" | "second";
  resolution: string;
  sale_points: number;
  display_name: string;
  capabilities: {
    aspect_ratios: readonly string[];
    input_images_max: number;
    modes?: readonly string[];
    durations?: readonly number[];
  };
  status: string;
}

export type DirectorResolution = "1080P" | "720P" | "480P";
const RESOLUTION_ORDER: readonly DirectorResolution[] = ["1080P", "720P", "480P"];

export interface DirectorVideoPlan {
  planId: string;
  displayName: string;
  family: ShuyuVideoPlanFamily;
  resolution: DirectorResolution;
  billingUnit: "generation" | "second";
  unitSalePoints: number;
  /// 这条视频（按它的时长）要花的点数
  points: number;
  inputImagesMax: number;
}

/** 导演线路的默认出片档（见 maxResolution 的说明）。 */
export const DIRECTOR_DEFAULT_RESOLUTION: DirectorResolution = "720P";

export interface DirectorPlanLadderOptions {
  durationSec: number;
  aspectRatio: DirectorAspectRatio;
  /// 这条视频要带几张参考图（含开场帧）
  referenceCount: number;
  /// 最高从哪一档开始。缺省 720P（2026-11-16 定：1080P 太贵——Seedance 2.5 的 1080P 是 420 点/秒，
  /// 15 秒 6,300 点，是 720P 特价档的 4.2 倍；720P 够用，靠我们把控画面）。要 1080P 得显式点名。
  maxResolution?: DirectorResolution;
  /// 最低降到哪一档（缺省 720P：不自动交 480P 的片）
  minResolution?: DirectorResolution;
  /// 模型家族（缺省只用 Seedance 2.5）
  family?: ShuyuVideoPlanFamily;
  /// 只用这一档（点名套餐，仍要过下面的能力检查）
  planId?: string;
}

/**
 * 套餐阶梯：从 maxResolution（缺省 720P）往下到 minResolution，同一分辨率里按这条片的时长算、便宜的在前。
 *
 * 不经产品里的审计层（auditShuyuVideoPlan）：那一层把 1080P 单价卡在 400 点/秒以下，是给客户自助面
 * 防「静默换成贵档」用的；导演线路是人在场、每次提交前估算并比上限，所以直接看价目表。
 * 家族仍然只认 display_name（价目表里各家模型共用 model=studio-video）。4K / 2K 一律不取。
 */
export function rankDirectorVideoPlans(
  prices: ReadonlyArray<DirectorPriceEntry>,
  options: DirectorPlanLadderOptions,
): DirectorVideoPlan[] {
  const family = options.family ?? "seedance-2.5";
  const top = RESOLUTION_ORDER.indexOf(options.maxResolution ?? DIRECTOR_DEFAULT_RESOLUTION);
  const bottom = RESOLUTION_ORDER.indexOf(options.minResolution ?? "720P");
  return prices
    .flatMap((plan): DirectorVideoPlan[] => {
      if (plan.kind !== "video" || plan.model !== "studio-video" || plan.status !== "available") return [];
      if (shuyuVideoPlanFamily(plan.display_name) !== family) return [];
      const rank = RESOLUTION_ORDER.indexOf(plan.resolution as DirectorResolution);
      if (rank < 0 || rank < top || rank > bottom) return [];
      if (options.planId && plan.plan_id !== options.planId) return [];
      if (!plan.capabilities.aspect_ratios.includes(options.aspectRatio)) return [];
      if (!(plan.capabilities.modes?.includes("image2video") ?? false)) return [];
      if (!(plan.capabilities.durations?.includes(options.durationSec) ?? false)) return [];
      if (plan.capabilities.input_images_max < options.referenceCount) return [];
      if (!Number.isFinite(plan.sale_points) || plan.sale_points <= 0) return [];
      return [
        {
          planId: plan.plan_id,
          displayName: plan.display_name,
          family,
          resolution: plan.resolution as DirectorResolution,
          billingUnit: plan.unit,
          unitSalePoints: plan.sale_points,
          points: plan.unit === "second" ? plan.sale_points * options.durationSec : plan.sale_points,
          inputImagesMax: plan.capabilities.input_images_max,
        },
      ];
    })
    .sort(
      (left, right) =>
        RESOLUTION_ORDER.indexOf(left.resolution) - RESOLUTION_ORDER.indexOf(right.resolution) ||
        left.points - right.points ||
        left.planId.localeCompare(right.planId),
    );
}

/** 成片的短边够不够这一档（1080P ≥ 1080、720P ≥ 720）：Shuyu 标着 1080P 也要量过才算数。 */
export function meetsResolution(resolution: DirectorResolution, width: number | null, height: number | null): boolean {
  if (!width || !height) return false;
  const shortEdge = Math.min(width, height);
  return shortEdge >= (resolution === "1080P" ? 1080 : resolution === "720P" ? 720 : 480);
}

// ---------------------------------------------------------------------------
// 幂等键与进度
// ---------------------------------------------------------------------------

/** Shuyu 的 Idempotency-Key（8–120 字符）：同一任务、同一次尝试永远是同一个键，确认未知时可以同键重投。 */
export function directorRequestKey(jobId: string, attempt: number): string {
  const digest = createHash("sha256").update(`director:${jobId}:video:${attempt}`).digest("hex").slice(0, 32);
  return `director-${digest}`;
}

export interface DirectorFrameVariant {
  index: number;
  status: "done" | "failed";
  file?: string;
  model?: string;
  size?: string;
  quality?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string;
  createdAt: string;
}

export interface DirectorVideoAttempt {
  attempt: number;
  planId: string;
  displayName: string;
  resolution: DirectorResolution;
  points: number;
  requestKey: string;
  /// submitting = 键已落盘、还不知道 Shuyu 收没收（重跑用同一个键重投）
  status: "submitting" | "submitted" | "succeeded" | "failed" | "rejected";
  taskId?: string;
  error?: string;
  outputUrl?: string;
  localFile?: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  hasAudio?: boolean;
  submittedAt?: string;
  finishedAt?: string;
}

export interface DirectorState {
  jobId: string;
  frames: Record<string, { variants: DirectorFrameVariant[]; selected: number | null }>;
  /// 已传到存储的参考图 / 开场帧：内容哈希 → 公开地址
  uploads: Record<string, { url: string; sha256: string }>;
  video: { attempts: DirectorVideoAttempt[] };
}

export function initialDirectorState(jobId: string): DirectorState {
  return { jobId, frames: {}, uploads: {}, video: { attempts: [] } };
}

/** 这一帧定稿的那张：导演挑过用挑的；没挑过且只有一张成功的就用它；其余情况要先挑。 */
export function selectedFrameVariant(state: DirectorState, frameId: string): DirectorFrameVariant | null {
  const frame = state.frames[frameId];
  if (!frame) return null;
  const done = frame.variants.filter((variant) => variant.status === "done" && variant.file);
  if (frame.selected !== null) return done.find((variant) => variant.index === frame.selected) ?? null;
  return done.length === 1 ? done[0]! : null;
}

export type DirectorVideoStep =
  | { kind: "done"; attempt: DirectorVideoAttempt }
  | { kind: "poll"; attempt: DirectorVideoAttempt }
  | { kind: "resubmit"; attempt: DirectorVideoAttempt }
  | { kind: "download"; attempt: DirectorVideoAttempt }
  | { kind: "submit"; attemptNumber: number; triedPlanIds: string[] };

/** 出片下一步：有任务号的只续查、绝不重提；键落盘了但没任务号的用同一个键重投。 */
export function nextDirectorVideoStep(state: DirectorState): DirectorVideoStep {
  const attempts = state.video.attempts;
  const last = attempts[attempts.length - 1];
  if (last?.status === "succeeded") return last.localFile ? { kind: "done", attempt: last } : { kind: "download", attempt: last };
  if (last?.status === "submitted") return { kind: "poll", attempt: last };
  if (last?.status === "submitting") return { kind: "resubmit", attempt: last };
  return {
    kind: "submit",
    attemptNumber: attempts.length + 1,
    /// 当场被拒的套餐这一轮不再试；受理后失败的（failed）可以再试同一档
    triedPlanIds: attempts.filter((attempt) => attempt.status === "rejected").map((attempt) => attempt.planId),
  };
}
