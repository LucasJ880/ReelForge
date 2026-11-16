/**
 * 导演线路的纯逻辑（2026-11-16）：Claude 当导演与编剧写镜头脚本 → OpenAI gpt-image-2 出故事板 →
 * Shuyu Seedance 出片。CLI 在 scripts/director/run.ts，规程在 .claude/skills/aivora-director/SKILL.md。
 *
 * 这里不读环境变量、不触网、不碰数据库：脚本文件的校验、提示词拼装、出片套餐的画质阶梯、花费估算、
 * 幂等键，全部可以单测。写法照 10-29 吸收的 Kelin 团队经验（docs/roadmap/2026-10-29-kelin-workflow-lessons.md）：
 * 全程英文、每个镜头六项齐全、参考图各管一件事、提示词按固定顺序拼紧凑。
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

const shotItem = z.string().trim().min(8).max(420);
const shotSchema = z
  .object({
    fromSec: z.number().min(0).max(30),
    toSec: z.number().min(0).max(30),
    action: shotItem,
    space: shotItem,
    framing: shotItem,
    camera: shotItem,
    light: shotItem,
    sound: shotItem,
  })
  .strict();

const videoSchema = z
  .object({
    /// 开场帧用哪一帧（frames 里的 id）；它排在参考图最后，视频从它开始
    openingFrame: slug,
    /// 除开场帧以外带给出片模型的参考图（实拍在前）
    references: z.array(slug).min(1).max(DIRECTOR_VIDEO_REFERENCES_MAX - 1),
    /// 呈现方式（例："photorealistic handheld commercial, natural daylight, shallow depth of field"）
    look: z.string().trim().min(12).max(280),
    openingState: z.string().trim().min(20).max(600),
    shots: z.array(shotSchema).min(1).max(8),
    endState: z.string().trim().min(12).max(400),
    /// 只留当前风险的限制，不写互相重复或矛盾的
    constraints: z.array(z.string().trim().min(6).max(200)).max(6).default([]),
  })
  .strict();

export const directorJobSchema = z
  .object({
    id: slug,
    title: z.string().trim().min(1).max(120),
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

/**
 * 出片提示词，固定顺序：画幅与呈现 → 参考职责 → 首态与空间 → 时间与动作 → 尾态 → 关键限制。
 * 声音写在各镜头里（台词放英文双引号内，模型逐字念；引号里可以是商家原文）。
 */
export function buildVideoPrompt(job: DirectorJob): string {
  const { video } = job;
  const timeline = video.shots
    .map((shot) =>
      [
        `${seconds(shot.fromSec)}-${seconds(shot.toSec)}s: ${shot.action}`,
        `Space: ${shot.space}`,
        `Framing: ${shot.framing}`,
        `Camera: ${shot.camera}`,
        `Light: ${shot.light}`,
        `Sound: ${shot.sound}`,
      ].join(" "),
    )
    .join("\n");
  return [
    `FORMAT: ${ORIENTATION[job.aspectRatio]}, ${job.durationSec} seconds. ${video.look}`,
    `REFERENCES: ${referenceRoleLines(videoReferenceOrder(job))}.`,
    `OPENING STATE: ${video.openingState}`,
    `TIMELINE:\n${timeline}`,
    `END STATE: ${video.endState}`,
    video.constraints.length > 0 ? `CONSTRAINTS: ${video.constraints.join("; ")}.` : null,
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
    if (shot.toSec <= shot.fromSec) errors.push(`${label} 的结束时间不晚于开始时间`);
    else if (shot.toSec - shot.fromSec < 2) warnings.push(`${label} 只有 ${seconds(shot.toSec - shot.fromSec)} 秒：一拍一个主动作，太短模型做不完`);
    cursor = shot.toSec;
    for (const item of DIRECTOR_SHOT_ITEMS) {
      if (CJK.test(outsideQuotes(shot[item]))) errors.push(`${label} 的 ${item} 里有非英文内容（台词放英文双引号里）`);
    }
    if (/\b(then|after that|next,|followed by|and then)\b/iu.test(shot.action)) {
      warnings.push(`${label} 的 action 里像是写了不止一个主动作（then / after that）：一拍只做一件事`);
    }
  });
  if (Math.abs(cursor - job.durationSec) > 0.01) {
    errors.push(`镜头铺到 ${seconds(cursor)} 秒，时长是 ${job.durationSec} 秒：要正好铺满`);
  }
  for (const [name, text] of [["look", video.look], ["openingState", video.openingState], ["endState", video.endState], ...video.constraints.map((text) => ["constraints", text] as const)] as const) {
    if (CJK.test(outsideQuotes(text))) errors.push(`${name} 里有非英文内容`);
  }
  if (RESULT_SPOILER.test(video.openingState)) {
    warnings.push("openingState 像是提前露出了结果（already / fully …）：首帧放在主动作发生之前的清楚状态");
  }
  const normalized = video.constraints.map((text) => text.toLowerCase().replace(/[^a-z0-9 ]/gu, "").trim());
  if (new Set(normalized).size !== normalized.length) warnings.push("constraints 里有重复的限制");

  const prompt = buildVideoPrompt(job);
  if (prompt.length > DIRECTOR_VIDEO_PROMPT_MAX) {
    errors.push(`出片提示词 ${prompt.length} 字，超过 ${DIRECTOR_VIDEO_PROMPT_MAX}：删限制、并镜头，别指望截断`);
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
