/**
 * scripts/bakeoff-runner.ts 的纯函数部分（X-SCAF-8，E7′ / E12 / E2″ 共用）。不读 env、不触网、不连库。
 *
 * 对照的前提是「只有套餐不同」：同一份输入清单、同一份 prompt（生产 prompt-intelligence 的
 * 启发式分镜，不走 LLM，确定性可复现）、同样的参考图顺序；臂 = Shuyu plan_id。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { EXPERIMENT_BATCH_KEY_PREFIX } from "../../src/lib/experiments/run-key";
import { heuristicSegmentPrompts } from "../../src/lib/video-generation/prompt-intelligence";
import { planUnifiedSegments } from "../../src/lib/video-generation/segment-planner-adapter";
import type {
  CreativeBrief,
  InputClassification,
  UploadedAsset,
} from "../../src/types/video-generation";

/* ── 输入清单 ─────────────────────────────────────────────────────── */

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "参考图必须是 HTTPS URL（Shuyu 只收公网 HTTPS）");
const slug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "id 只能是字母数字、- 和 _（≤64）");

export const bakeoffManifestSchema = z
  .object({
    /** 实验编号，决定输出目录 tmp/experiments-2026-11/<experiment>/。 */
    experiment: slug,
    durationSec: z.union([z.literal(5), z.literal(10), z.literal(15)]).default(15),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
    language: z.string().min(2).max(16).default("en-US"),
    /** D-11 素材来源说明（34 模板产品集 / 已公开露出的 SunnyShutter 图），写进结果文件备查。 */
    sourceNote: z.string().max(500).optional(),
    items: z
      .array(
        z
          .object({
            id: slug,
            productName: z.string().min(1).max(120),
            productImages: z.array(httpsUrl).min(1).max(9),
            /** 已出好的 Shuyu 故事板帧（排在实拍之后，按套餐上限截断）。 */
            storyboardFrames: z.array(httpsUrl).max(9).default([]),
            brief: z
              .object({
                hook: z.string().max(300).optional(),
                corePainPoint: z.string().max(300).optional(),
                keySellingPoints: z.array(z.string().max(200)).max(6).optional(),
                targetAudience: z.string().max(200).optional(),
                emotionalAngle: z.string().max(200).optional(),
              })
              .strict()
              .default({}),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    manifest.items.forEach((item, index) => {
      if (seen.has(item.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "id"], message: `id 重复：${item.id}` });
      }
      seen.add(item.id);
    });
  });

export type BakeoffManifest = z.infer<typeof bakeoffManifestSchema>;
export type BakeoffItem = BakeoffManifest["items"][number];

export function parseBakeoffManifest(raw: unknown): BakeoffManifest {
  const parsed = bakeoffManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "(根)"}：${issue.message}`)
      .join("；");
    throw new Error(`输入清单不合法：${issues}`);
  }
  return parsed.data;
}

/* ── 同一份 prompt ────────────────────────────────────────────────── */

const CLASSIFICATION: InputClassification = {
  userType: "business",
  generationMode: "image_to_video_ad",
  videoGoal: "product_ad",
  targetPlatform: "tiktok",
  needsCTA: false,
  needsBrandPackaging: false,
  needsUserClipInsertion: false,
  confidence: 1,
  missingFields: [],
  warnings: [],
};

function briefOf(item: BakeoffItem): CreativeBrief {
  const points = item.brief.keySellingPoints?.length ? item.brief.keySellingPoints : [item.productName];
  return {
    hook: item.brief.hook ?? `${item.productName} in a real everyday moment`,
    narrative: `Show ${item.productName} in real use, matching the reference photos exactly`,
    targetAudience: item.brief.targetAudience ?? "everyday shoppers",
    corePainPoint: item.brief.corePainPoint ?? "the everyday problem this product solves",
    emotionalAngle: item.brief.emotionalAngle ?? "relief and satisfaction",
    keySellingPoints: points,
    cta: null,
    platformFit: "tiktok 9:16",
    recommendedDurationReason: "fixed bake-off duration",
    angleVariants: [],
  };
}

function assetsOf(item: BakeoffItem): UploadedAsset[] {
  const asset = (url: string, index: number, role: "product_image" | "reference_image"): UploadedAsset => ({
    id: `${item.id}-${role}-${index}`,
    type: "IMAGE",
    inferredRole: role,
    roleConfidence: 1,
    url,
    mimeType: "image/jpeg",
    fileName: `${item.id}-${index}.jpg`,
  });
  return [
    ...item.productImages.map((url, index) => asset(url, index, "product_image")),
    ...item.storyboardFrames.map((url, index) => asset(url, index, "reference_image")),
  ];
}

/**
 * 每条输入一份 prompt，所有臂共用：生产 prompt-intelligence 的启发式分镜
 * （heuristicSegmentPrompts，不调 LLM），取第一个 AI 段。
 */
export function buildBakeoffPrompt(
  manifest: Pick<BakeoffManifest, "durationSec" | "aspectRatio" | "language">,
  item: BakeoffItem,
): { prompt: string; negativePrompt: string; sha256: string } {
  /// 段规划器最短规划 15s；5s / 10s 臂沿用同一个首段角色，只把时长改成清单时长，分镜按它重铺。
  const slots = planUnifiedSegments({ targetDurationSec: 15, clipPlacement: null, brandPackaging: null })
    .filter((slot) => slot.source === "ai");
  if (slots.length === 0) throw new Error("段规划器没给出 AI 段");
  const [first] = heuristicSegmentPrompts(
    {
      creativeBrief: briefOf(item),
      segmentSlots: slots,
      classifiedAssets: assetsOf(item),
      classification: CLASSIFICATION,
      aspectRatio: manifest.aspectRatio,
      language: manifest.language,
    },
    [{ ...slots[0], durationSec: manifest.durationSec }],
  );
  return {
    prompt: first.seedancePrompt,
    negativePrompt: first.negativePrompt,
    sha256: createHash("sha256").update(first.seedancePrompt).digest("hex"),
  };
}

/** 参考图顺序：实拍在前、故事板帧在后，按套餐上限截断（与生产 composeSingleVideoReferenceImages 同优先级）。 */
export function orderInputImages(item: BakeoffItem, limit: number): string[] {
  const cap = Math.max(0, Math.floor(limit));
  return [...item.productImages, ...item.storyboardFrames].slice(0, cap);
}

/* ── 臂与任务键 ───────────────────────────────────────────────────── */

const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export function parseArms(raw: string | undefined | null): string[] {
  const arms = (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (arms.length === 0) throw new Error("--arms 至少给一个 Shuyu plan_id");
  for (const arm of arms) {
    if (!PLAN_ID_PATTERN.test(arm)) throw new Error(`plan_id 不合法：${arm}`);
  }
  if (new Set(arms).size !== arms.length) throw new Error("--arms 有重复的 plan_id");
  return arms;
}

export interface BakeoffTaskSpec {
  experiment: string;
  runTag: string;
  itemId: string;
  planId: string;
  rep: number;
}

/**
 * Shuyu Idempotency-Key（8–120 字符）。同一 (实验, 运行标签, 条目, 套餐, 第几次) 永远同一个键：
 * 续跑时供应商侧幂等，不会重复扣点。可读部分超长时尾部换成哈希。
 */
export function bakeoffTaskKey(spec: BakeoffTaskSpec): string {
  const readable = [spec.experiment, spec.runTag, spec.itemId, spec.planId, `r${spec.rep}`]
    .join("-")
    .replace(/[^A-Za-z0-9._-]/g, "_");
  const key = `${EXPERIMENT_BATCH_KEY_PREFIX}${readable}`;
  if (key.length <= 120) return key;
  const digest = createHash("sha256").update(readable).digest("hex").slice(0, 16);
  return `${key.slice(0, 120 - 17)}-${digest}`;
}

export function expandTasks(
  manifest: Pick<BakeoffManifest, "experiment" | "items">,
  arms: ReadonlyArray<string>,
  runTag: string,
  repeats: number,
): Array<BakeoffTaskSpec & { key: string }> {
  const out: Array<BakeoffTaskSpec & { key: string }> = [];
  for (let rep = 1; rep <= repeats; rep += 1) {
    for (const item of manifest.items) {
      for (const planId of arms) {
        const spec = { experiment: manifest.experiment, runTag, itemId: item.id, planId, rep };
        out.push({ ...spec, key: bakeoffTaskKey(spec) });
      }
    }
  }
  return out;
}

/* ── 内置参考单价 ─────────────────────────────────────────────────── */

/**
 * 2026-10-26 实价（路线图 §2.2 E12 的单价来源）：720P 95 点/秒、1080P 240 点/秒。
 * 只用于两件事：① 干跑不触网时给保守预估（未知分辨率按最贵的 1080P 估）；
 * ② 真跑时核对实时价——实时单条成本超过参考价 2 倍就拒绝（价格异动先人工确认、改这张表）。
 * 真正扣点与预算闸一律按 /prices 实时审计价。
 */
export const BAKEOFF_REFERENCE_POINTS_PER_SECOND = {
  "480P": 95,
  "720P": 95,
  "1080P": 240,
} as const;
export const BAKEOFF_PRICE_SANITY_FACTOR = 2;

export type ReferenceResolution = keyof typeof BAKEOFF_REFERENCE_POINTS_PER_SECOND;

export function referencePointsPerTask(resolution: ReferenceResolution | null, durationSec: number): number {
  const perSecond = resolution
    ? BAKEOFF_REFERENCE_POINTS_PER_SECOND[resolution]
    : Math.max(...Object.values(BAKEOFF_REFERENCE_POINTS_PER_SECOND));
  return perSecond * Math.max(1, Math.ceil(durationSec));
}

export function livePriceSanity(args: {
  planId: string;
  resolution: ReferenceResolution;
  livePointsPerTask: number;
  durationSec: number;
}): { ok: boolean; reason: string | null } {
  const reference = referencePointsPerTask(args.resolution, args.durationSec);
  const ceiling = reference * BAKEOFF_PRICE_SANITY_FACTOR;
  if (args.livePointsPerTask > ceiling) {
    return {
      ok: false,
      reason: `${args.planId} 实时 ${args.livePointsPerTask} 点/条 > 参考价 ${reference} × ${BAKEOFF_PRICE_SANITY_FACTOR}，价格异动，先人工确认并更新 BAKEOFF_REFERENCE_POINTS_PER_SECOND`,
    };
  }
  return { ok: true, reason: null };
}

/* ── 任务时间线 ───────────────────────────────────────────────────── */

export interface TaskTimeline {
  submittedAt?: string | null;
  firstProcessingAt?: string | null;
  completedAt?: string | null;
  status?: string | null;
}

const TERMINAL = new Set(["completed", "failed", "refund_pending", "refund_error", "refunded"]);

export function isTerminalShuyuStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL.has(status);
}

/** 轮询观察推进：processing 第一次出现记 firstProcessingAt；进终态记 completedAt。精度 = 轮询间隔。 */
export function observeTask(prev: TaskTimeline, status: string, now: Date): TaskTimeline {
  const next: TaskTimeline = { ...prev, status };
  if (status === "processing" && !next.firstProcessingAt) next.firstProcessingAt = now.toISOString();
  if (isTerminalShuyuStatus(status) && !next.completedAt) next.completedAt = now.toISOString();
  return next;
}
