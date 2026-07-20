/**
 * SunnyShutter shade batch pipeline: Image2 storyboard (3 frames) → Fast VIP I2V 15s.
 * Consistency-first, sales-first, pull-chain side lock.
 */

import {
  SHUYU_IMAGE_FALLBACK_PLAN_ID,
  SHUYU_IMAGE_MODEL,
  SHUYU_IMAGE_PLAN_ID,
  SHUYU_VIDEO_FAST_PLAN_ID,
  createShuyuImageTask,
  createShuyuVideoTask,
  getAvailableShuyuImagePlanIds,
  getShuyuVideoTask,
  type ShuyuFetchOptions,
} from "@/lib/providers/shuyu";
import { ProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";
import {
  gachaCandidateCount,
  generateFrameWithGacha,
} from "@/lib/video-generation/storyboard-gacha";
import {
  requireStoryboardBeforeVideo,
  type Image2StoryboardArtifact,
} from "@/lib/video-generation/storyboard-lock";
import {
  buildSunnyShutterShadePrompt,
  pickSunnyShutterShadeVariant,
  shadeStoryboardVisualBible,
  type SunnyShutterShadePlotVariant,
} from "@/lib/video-generation/sunnyshutter-shade-template";

export const SUNNYSHUTTER_SHADE_PIPELINE_ID =
  "sunnyshutter-shade-image2-i2v-15s" as const;

const VIDEO_PLAN_FAILOVER = [
  SHUYU_VIDEO_FAST_PLAN_ID,
  "video-plan-05",
  "video-plan-04",
  "video-plan-06",
  "video-plan-03",
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollShuyuTaskUntilDone(
  taskId: string,
  options: ShuyuFetchOptions & {
    pollMs?: number;
    maxWaitMs?: number;
    label?: string;
  } = {},
): Promise<{ status: string; url: string }> {
  const pollMs = options.pollMs ?? 5_000;
  const maxWaitMs = options.maxWaitMs ?? 15 * 60_000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const task = await getShuyuVideoTask(taskId, {
        ...options,
        timeoutMs: options.timeoutMs ?? 20_000,
      });
      const url = task.outputs?.[0]?.url;
      if (task.status === "completed") {
        if (!url) {
          throw new Error(`${options.label ?? "task"} completed without URL`);
        }
        return { status: task.status, url };
      }
      if (
        task.status === "failed" ||
        task.status === "refunded" ||
        task.status === "refund_error"
      ) {
        throw new Error(
          `${options.label ?? "task"} terminal: ${task.status}`,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/timed out|timeout/i.test(msg)) {
        await sleep(pollMs);
        continue;
      }
      throw error;
    }
    await sleep(pollMs);
  }
  throw new Error(`${options.label ?? "task"} timed out (${taskId})`);
}

/**
 * 5 帧故事版（CEO 2026-07-20：blinds 至少 4-6 张）：
 * hook → 冲突特写 → 操作 → payoff → 产品英雄 CTA 定格。
 * 帧越多，I2V 每段要脑补的运动越短，漂移/幻视空间越小。
 */
function framePlans(variant: SunnyShutterShadePlotVariant) {
  const bible = shadeStoryboardVisualBible(variant);
  const [hook, mid, end] = [
    variant.beats[0]!,
    variant.beats[1] ?? variant.beats[0]!,
    variant.beats[2] ?? variant.beats[variant.beats.length - 1]!,
  ];
  return [
    {
      id: "hook",
      order: 1,
      beat: hook,
      imagePrompt: [
        `[Visual Bible] ${bible}`,
        `[Frame 1 HOOK] ${hook}`,
        "[Output] One 9:16 photoreal still. This frame locks the room identity for ALL later frames.",
      ].join("\n\n"),
    },
    {
      id: "conflict-close",
      order: 2,
      beat: `CONFLICT CLOSE-UP (same scene as hook): ${variant.conflictAngle} — emphasize the discomfort; window still dominates the frame.`,
      imagePrompt: [
        `[Visual Bible] ${bible}`,
        `[Frame 2 CONFLICT CLOSE] Same scene as Frame 1, slightly tighter on the window to emphasize the problem: ${variant.conflictAngle}. The uncovered/glaring window fills most of the frame.`,
        "[Output] One 9:16 still. Same room/window/person as Frame 1; only emphasis changes.",
      ].join("\n\n"),
    },
    {
      id: "operate",
      order: 3,
      beat: mid,
      imagePrompt: [
        `[Visual Bible] ${bible}`,
        `[Frame 3 OPERATE / TRANSFORM] ${mid}`,
        `[PULL LOCK] chain ONLY on the ${variant.pullSide} edge if visible.`,
        "[Output] One 9:16 still. Same woman/room/product as Frames 1-2; shade mid-travel.",
      ].join("\n\n"),
    },
    {
      id: "payoff",
      order: 4,
      beat: end,
      imagePrompt: [
        `[Visual Bible] ${bible}`,
        `[Frame 4 PAYOFF] ${end}`,
        "[Output] One 9:16 still. Same continuity; covering fully deployed; comfort payoff readable.",
      ].join("\n\n"),
    },
    {
      id: "hero-cta",
      order: 5,
      beat: "FINAL CTA HOLD: clean hero of the covering on the SAME window, perfect geometry, calm light, zero text — ready for post CTA overlay and end card.",
      imagePrompt: [
        `[Visual Bible] ${bible}`,
        "[Frame 5 PRODUCT HERO / CTA HOLD] Clean hero composition of the covering fully deployed on the SAME window as all earlier frames; perfect straight geometry; calm premium light; person optional and secondary.",
        "[Output] One 9:16 still. Same room identity; this is the freeze the video ends on.",
      ].join("\n\n"),
    },
  ];
}

/** 静态兜底名单（/prices 拉不到时用；线路轮换频繁，别依赖它） */
const STATIC_IMAGE_PLAN_FALLBACK = [
  "image-plan-11",
  "image-plan-14",
  "image-plan-12",
  "image-plan-15",
  "image-plan-10",
  "image-plan-13",
  SHUYU_IMAGE_PLAN_ID,
  SHUYU_IMAGE_FALLBACK_PLAN_ID,
];

/** 每个故事版拉一次 /prices 动态选线路，失败回退静态名单。 */
export async function resolveImagePlanCandidates(
  options?: ShuyuFetchOptions,
): Promise<string[]> {
  try {
    const dynamic = await getAvailableShuyuImagePlanIds({
      ...options,
      timeoutMs: options?.timeoutMs ?? 15_000,
    });
    if (dynamic.length > 0) return dynamic;
  } catch {
    // fall through to static list
  }
  return STATIC_IMAGE_PLAN_FALLBACK;
}

async function generateOneFrame(args: {
  prompt: string;
  refs: string[];
  keyPrefix: string;
  label: string;
  planCandidates: string[];
  options?: ShuyuFetchOptions;
}): Promise<string> {
  const planCandidates = args.planCandidates;
  let lastError: unknown;
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) await sleep(8_000 * round);
    for (const planId of planCandidates) {
      try {
        const created = await createShuyuImageTask({
          ...args.options,
          timeoutMs: args.options?.timeoutMs ?? 20_000,
          providerRequestKey: `${args.keyPrefix}:${planId}:r${round}`.slice(0, 120),
          planId,
          model: SHUYU_IMAGE_MODEL,
          prompt: args.prompt,
          resolution: /plan-(02|05|11|14)/.test(planId)
            ? "2K"
            : /plan-(03|06|12|15)/.test(planId)
              ? "4K"
              : "1K",
          aspectRatio: "9:16",
          inputImages: args.refs.slice(0, round >= 2 ? 2 : 4),
        });
        const done = await pollShuyuTaskUntilDone(created.taskId, {
          ...args.options,
          label: `${args.label}/${planId}`,
          pollMs: 4_000,
          maxWaitMs: 12 * 60_000,
        });
        return done.url;
      } catch (error) {
        lastError = error;
        const busy = /繁忙|busy|unavailable|refunded|model_unavailable/i.test(
          error instanceof Error ? error.message : String(error),
        );
        if (!busy && !(error instanceof ProviderSubmissionError)) throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("shade storyboard image failed");
}

function frameJudgeCriteria(args: {
  variant: SunnyShutterShadePlotVariant;
  beat: string;
  isFirstFrame: boolean;
}): string {
  return [
    `Beat to depict: ${args.beat}`,
    `Product kind: ${args.variant.productKind}; pull chain (if visible) ONLY on the ${args.variant.pullSide} edge.`,
    "The window + covering must be the clear protagonist (large, straight geometry, matching the product reference photos).",
    args.isFirstFrame
      ? "This is the anchor frame: pick the candidate whose room/window composition works best as the locked scene for the whole video."
      : "Must match the CONTEXT frame(s) exactly: same room, same window, same camera position, same person (if any).",
    "Zero text/logo/watermark anywhere; top-left corner clean.",
  ].join(" ");
}

export async function generateShadeStoryboard(args: {
  index1Based: number;
  productImageUrls: string[];
  purpose: string;
  providerRequestKeyPrefix: string;
  options?: ShuyuFetchOptions;
}): Promise<Image2StoryboardArtifact> {
  const variant = pickSunnyShutterShadeVariant(args.index1Based);
  const plans = framePlans(variant);
  const refs = args.productImageUrls.slice(0, 4);
  const planCandidates = await resolveImagePlanCandidates(args.options);
  const frames: Image2StoryboardArtifact["frames"] = [];

  for (const plan of plans) {
    const isFirstFrame = frames.length === 0;
    // 抽卡：帧1决定全片场景，多抽；后续帧以已选帧为上下文评一致性。
    const picked = await generateFrameWithGacha({
      candidateCount: isFirstFrame
        ? gachaCandidateCount()
        : Math.max(2, gachaCandidateCount() - 1),
      criteria: frameJudgeCriteria({ variant, beat: plan.beat, isFirstFrame }),
      contextUrls: [
        ...frames.map((f) => f.imageUrl),
        ...refs.slice(0, isFirstFrame ? 2 : 1),
      ],
      label: `shade-sb#${args.index1Based}/${plan.id}`,
      generateOnce: (candidateIndex) =>
        generateOneFrame({
          prompt: isFirstFrame
            ? plan.imagePrompt
            : `${plan.imagePrompt}\n\n[SCENE ANCHOR] The FIRST input image(s) are the locked earlier storyboard frames — reproduce their room, window, camera position, and person EXACTLY; only the action/beat changes.`,
          // 帧2/3 把已选前帧放进输入图，房间一致性靠图像锚定而非纯文字。
          refs: isFirstFrame
            ? refs
            : [...frames.map((f) => f.imageUrl), ...refs].slice(0, 4),
          keyPrefix: `${args.providerRequestKeyPrefix}:img:${args.index1Based}:${plan.id}:c${candidateIndex}`,
          label: `shade-sb#${args.index1Based}/${plan.id}/c${candidateIndex}`,
          planCandidates,
          options: args.options,
        }),
    });
    frames.push({
      id: plan.id,
      order: plan.order,
      imageUrl: picked.imageUrl,
      beat: plan.beat,
      imagePrompt: plan.imagePrompt,
      candidateUrls: picked.candidateUrls,
      gachaJudge: picked.judge,
    });
  }

  const artifact: Image2StoryboardArtifact = {
    source: "shuyu_image2",
    model: SHUYU_IMAGE_MODEL,
    purpose: args.purpose,
    generatedAt: new Date().toISOString(),
    frames,
  };
  requireStoryboardBeforeVideo(artifact, {
    runKind: "shutter_acceptance",
    clientLockProfileId: "sunnyshutter",
    minFrames: plans.length,
  });
  return artifact;
}

export async function runShadeI2V(args: {
  index1Based: number;
  productImageUrls: string[];
  storyboard: Image2StoryboardArtifact;
  providerRequestKey: string;
  options?: ShuyuFetchOptions;
}): Promise<{ taskId: string; planId: string; url: string; prompt: string }> {
  const variant = pickSunnyShutterShadeVariant(args.index1Based);
  const prompt = [
    buildSunnyShutterShadePrompt({ variant }),
    "STORYBOARD-FIRST MOTION LOCK: Animate through ALL storyboard frames strictly in order (first input images) with continuous identity — each segment is a short, simple motion. Keep pull chain on the locked side edge only.",
    "TRANSITION LOCK: between storyboard frames use real in-scene motion or a clean hard cut ONLY — never a crossfade/dissolve; never show two moments blended or a see-through person/shade ghost.",
    "END HOLD LOCK: final second is a clean product/lifestyle freeze — absolutely no contact card, no cursive brand text, no phone digits from the model.",
  ].join("\n");
  const sbUrls = [...args.storyboard.frames]
    .sort((a, b) => a.order - b.order)
    .map((f) => f.imageUrl);
  const inputImages = [...sbUrls, ...args.productImageUrls].slice(0, 9);

  let lastError: unknown;
  // 提交阶段的 8s fetch 超时曾把 #2/#3 直接打死 — 提交用 20s 上限 + 多轮重试。
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) await sleep(15_000 * round);
    for (const planId of VIDEO_PLAN_FAILOVER) {
      try {
        const created = await createShuyuVideoTask({
          ...args.options,
          timeoutMs: args.options?.timeoutMs ?? 20_000,
          providerRequestKey:
            `${args.providerRequestKey}:${planId}:${Date.now()}`.slice(0, 120),
          planId,
          prompt: prompt.slice(0, 4_500),
          duration: 15,
          aspectRatio: "9:16",
          inputImages,
        });
        const done = await pollShuyuTaskUntilDone(created.taskId, {
          ...args.options,
          label: `shade-i2v#${args.index1Based}/${planId}`,
          pollMs: 6_000,
          maxWaitMs: 25 * 60_000,
        });
        return {
          taskId: created.taskId,
          planId,
          url: done.url,
          prompt,
        };
      } catch (error) {
        lastError = error;
        const retryable = /繁忙|busy|refunded|unavailable|timed out/i.test(
          error instanceof Error ? error.message : String(error),
        );
        if (!retryable) throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("shade I2V failed on all Fast VIP plans");
}
