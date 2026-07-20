/**
 * SunnyShutter locked pipeline: GPT Image 2 storyboard → Seedance I2V (15s).
 *
 * This is the CEO / peer quality path. If the batch10 acceptance lands well,
 * every SunnyShutter video should use this flow (not text-only Seedance).
 *
 * Spec: docs/acceptance/shutter-safe-shot-policy.md
 */

import {
  SHUYU_IMAGE_FALLBACK_PLAN_ID,
  SHUYU_IMAGE_MODEL,
  SHUYU_IMAGE_PLAN_ID,
  SHUYU_VIDEO_FAST_PLAN_ID,
  SHUYU_VIDEO_PLAN_ID,
  createShuyuImageTask,
  createShuyuVideoTask,
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
  pickSunnyShutterCommerceVariant,
  type SunnyShutterCommercePlotVariant,
} from "@/lib/video-generation/sunnyshutter-commerce-template";

export const SUNNYSHUTTER_LOCKED_PIPELINE_ID =
  "sunnyshutter-image2-storyboard-i2v-15s" as const;

export const SUNNYSHUTTER_PIPELINE_DURATION_SEC = 15 as const;
export const SUNNYSHUTTER_PIPELINE_ASPECT = "9:16" as const;

const SHARED_STORYBOARD_BIBLE = [
  "Photorealistic Canadian home interior with custom white plantation shutters.",
  "PRODUCT LOCK: louvers perfectly parallel, frames perfectly straight, hinge side and panel count match reference photos, no melted wood, no warped geometry.",
  "WINDOW ANCHOR (CEO): the SAME shuttered window is the visual protagonist of every frame — large (roughly half the frame or more), fully inside frame, same camera position/angle across all frames; identical trim color and outside view. Any person is secondary and never blocks the shutters.",
  "Sales ecommerce still — clear product visibility, soft natural window daylight, premium but commercial (not artsy mood film).",
  "No logo, no brand text, no captions, no phone numbers, no prices, no QR codes painted in the image. Keep the top-left corner clean for a post-production watermark.",
  "No hands on tilt bars, no fingers twisting louvers.",
].join(" ");

export type SunnyShutterStoryboardFramePlan = {
  id: string;
  order: number;
  beat: string;
  imagePrompt: string;
};

export type SunnyShutterPipelineVideoPlan = {
  videoPlanId: typeof SHUYU_VIDEO_PLAN_ID | typeof SHUYU_VIDEO_FAST_PLAN_ID;
  prompt: string;
  inputImages: string[];
  durationSec: typeof SUNNYSHUTTER_PIPELINE_DURATION_SEC;
  aspectRatio: typeof SUNNYSHUTTER_PIPELINE_ASPECT;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildSunnyShutterStoryboardFramePlans(
  variant: SunnyShutterCommercePlotVariant,
): SunnyShutterStoryboardFramePlan[] {
  const hook = variant.beats[0] ?? "0-3s HOOK: product conflict visible.";
  const mid =
    variant.beats.length > 2
      ? variant.beats[1]!
      : "MIDDLE — OPERATE / CONTRAST: louvers tilt open/closed on the SAME window; light control clearly visible; no hands on tilt bars.";
  const resolve =
    variant.beats[variant.beats.length - 1] ??
    "RETURN TO PRODUCT: hero hold of referenced plantation shutters.";
  return [
    {
      id: "hook",
      order: 1,
      beat: hook,
      imagePrompt: [
        `[Visual Bible] ${SHARED_STORYBOARD_BIBLE}`,
        `[Conflict] ${variant.conflictAngle}`,
        `[Frame 1 — HOOK] ${hook}`,
        "[Output] One single 9:16 still photograph. Match the plantation shutters to the reference photos exactly.",
      ].join("\n\n"),
    },
    {
      id: "operate",
      order: 2,
      beat: mid,
      imagePrompt: [
        `[Visual Bible] ${SHARED_STORYBOARD_BIBLE}`,
        `[Frame 2 — OPERATE / CONTRAST] ${mid}`,
        "[Output] One single 9:16 still photograph. Same room/window/person as Frame 1; only louver state and light change.",
      ].join("\n\n"),
    },
    {
      id: "product-return",
      order: 3,
      beat: resolve,
      imagePrompt: [
        `[Visual Bible] ${SHARED_STORYBOARD_BIBLE}`,
        `[Conflict resolved via product] ${variant.conflictAngle}`,
        `[Frame 3 — PRODUCT RETURN / CTA HOLD] ${resolve}`,
        "[Output] One single 9:16 still photograph. Hero view of the exact referenced white plantation shutters. No text.",
      ].join("\n\n"),
    },
  ];
}

export function buildSunnyShutterVideoPrompt(args: {
  variant: SunnyShutterCommercePlotVariant;
  productName: string;
  productImageUrls: string[];
}): string {
  // Shuyu hard-caps prompts at 5000 chars. Keep motion prompt compact — full
  // commerce skeleton + long Blob URLs overflow. Geometry is anchored by
  // storyboard stills + product refs in input_images.
  const refLabels = args.productImageUrls.map(
    (_, index) => `product-ref-${index + 1}`,
  );
  const prompt = [
    `SunnyShutter 15s 9:16 ecommerce sales ad for ${args.productName}.`,
    "GOAL: hard-sell CTA ad (cheesy OK). Hook 0-3s → conflict/contrast → return to product for end-card hold.",
    `STYLE LANE: ${args.variant.styleLane}.`,
    `CONFLICT ANGLE: ${args.variant.conflictAngle}.`,
    `MOTION: ${args.variant.motion}.`,
    `BEATS: ${args.variant.beats.join(" || ")}`,
    "PRODUCT NO-DEFORM LOCK: plantation shutter louvers stay perfectly parallel; frames stay straight; match storyboard frames and product-ref images exactly; never warp wood or invent hardware.",
    "SAFE SHOTS ONLY: no hands on tilt bar, no fingers twisting louvers.",
    "STORYBOARD-FIRST: animate continuously from storyboard frame 1 → frame 2 → frame 3 with continuous identity; land on the product-return CTA energy.",
    "SINGLE-SCENE ANTI-GHOST LOCK: one room, one window, one locked camera for the full 15s — no scene change, no crossfade/dissolve, no double exposure or translucent ghost overlays; beats progress by real in-scene motion, hard cut only if unavoidable.",
    "No on-screen text, logos, captions, prices, phone numbers, or QR codes from the model. Keep the top-left corner clean for the post watermark.",
    "Quiet room; no music bed. Soft natural window daylight or warm lifestyle lamps per style lane.",
    `Visual refs in input_images order: storyboard-1, storyboard-2, ${refLabels.join(", ")}.`,
  ].join("\n");
  return prompt.slice(0, 4_500);
}

export async function pollShuyuTaskUntilDone(
  taskId: string,
  options: ShuyuFetchOptions & {
    pollMs?: number;
    maxWaitMs?: number;
    label?: string;
  } = {},
): Promise<{ status: string; url: string | null; raw: unknown }> {
  const pollMs = options.pollMs ?? 5_000;
  const maxWaitMs = options.maxWaitMs ?? 15 * 60_000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    let task;
    try {
      task = await getShuyuVideoTask(taskId, {
        ...options,
        timeoutMs: options.timeoutMs ?? 20_000,
      });
    } catch (error) {
      // 轮询期的瞬时 fetch 超时不应打死整个任务 — 等下一轮再查。
      const msg = error instanceof Error ? error.message : String(error);
      if (/timed out|timeout/i.test(msg)) {
        await sleep(pollMs);
        continue;
      }
      throw error;
    }
    const url = task.outputs?.[0]?.url ?? null;
    if (task.status === "completed") {
      if (!url) {
        throw new Error(
          `${options.label ?? "shuyu-task"} completed without output URL`,
        );
      }
      return { status: task.status, url, raw: task };
    }
    if (
      task.status === "failed" ||
      task.status === "refunded" ||
      task.status === "refund_error"
    ) {
      throw new Error(
        `${options.label ?? "shuyu-task"} terminal failure: ${task.status}`,
      );
    }
    await sleep(pollMs);
  }
  throw new Error(
    `${options.label ?? "shuyu-task"} timed out after ${maxWaitMs}ms (${taskId})`,
  );
}

export async function generateSunnyShutterStoryboard(args: {
  index1Based: number;
  productImageUrls: string[];
  purpose: string;
  providerRequestKeyPrefix: string;
  imagePlanId?: string;
  options?: ShuyuFetchOptions;
}): Promise<Image2StoryboardArtifact> {
  const variant = pickSunnyShutterCommerceVariant(args.index1Based);
  const frames = buildSunnyShutterStoryboardFramePlans(variant);
  const refs = args.productImageUrls.slice(0, 4);
  const generated: Image2StoryboardArtifact["frames"] = [];

  const planCandidates = Array.from(
    new Set(
      [
        args.imagePlanId,
        SHUYU_IMAGE_PLAN_ID, // GPT Image 2 推荐 · 1K
        SHUYU_IMAGE_FALLBACK_PLAN_ID, // GPT Image 2 特价 Low · 1K
        "image-plan-03", // GPT Image 2 推荐 · 4K
        "image-plan-06", // GPT Image 2 线路1 · 4K
        "image-plan-02", // may rotate
        "image-plan-04",
        "image-plan-05",
        "image-plan-10", // Nano Banana if GPT Image 2 all busy
        "image-plan-13",
      ].filter(Boolean) as string[],
    ),
  );

  const generateOnce = async (
    frame: SunnyShutterStoryboardFramePlan,
    frameRefs: string[],
    prompt: string,
    candidateIndex: number,
  ): Promise<string> => {
    let lastError: unknown;
    // Up to 3 rounds × plan candidates — Image2 busy refunds are common.
    for (let round = 0; round < 3; round += 1) {
      if (round > 0) await sleep(8_000 * round);
      for (const planId of planCandidates) {
        try {
          const created = await createShuyuImageTask({
            ...args.options,
            timeoutMs: args.options?.timeoutMs ?? 20_000,
            providerRequestKey:
              `${args.providerRequestKeyPrefix}:img:${args.index1Based}:${frame.id}:c${candidateIndex}:${planId}:r${round}`.slice(
                0,
                120,
              ),
            planId,
            model: SHUYU_IMAGE_MODEL,
            prompt,
            resolution: /plan-0[235]|plan-1[14]/.test(planId)
              ? "2K"
              : /plan-0[36]|plan-1[25]/.test(planId)
                ? "4K"
                : "1K",
            aspectRatio: "9:16",
            inputImages: round >= 2 ? frameRefs.slice(0, 2) : frameRefs,
          });
          const done = await pollShuyuTaskUntilDone(created.taskId, {
            ...args.options,
            label: `storyboard#${args.index1Based}/${frame.id}/c${candidateIndex}/${planId}/r${round}`,
            pollMs: 4_000,
            maxWaitMs: 12 * 60_000,
          });
          if (done.url) return done.url;
        } catch (error) {
          lastError = error;
          const busy = /繁忙|busy|unavailable|refunded|model_unavailable|timed out/i.test(
            error instanceof Error ? error.message : String(error),
          );
          if (!busy) throw error;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All Shuyu image plans unavailable for storyboard");
  };

  for (const frame of frames) {
    const isFirstFrame = generated.length === 0;
    // 帧2/3 把已选前帧放进输入图，房间一致性靠图像锚定而非纯文字。
    const frameRefs = isFirstFrame
      ? refs
      : [...generated.map((f) => f.imageUrl), ...refs].slice(0, 4);
    const prompt = isFirstFrame
      ? frame.imagePrompt
      : `${frame.imagePrompt}\n\n[SCENE ANCHOR] The FIRST input image(s) are the locked earlier storyboard frames — reproduce their room, window, camera position, and person EXACTLY; only the louver state / action changes.`;
    const picked = await generateFrameWithGacha({
      candidateCount: isFirstFrame
        ? gachaCandidateCount()
        : Math.max(2, gachaCandidateCount() - 1),
      criteria: [
        `Beat to depict: ${frame.beat}`,
        "White plantation shutters must match the reference photos (parallel louvers, straight frames) and the shuttered window must be the clear protagonist.",
        isFirstFrame
          ? "Anchor frame: pick the candidate whose room/window composition works best as the locked scene for the whole video."
          : "Must match the CONTEXT frame(s) exactly: same room, same window, same camera position.",
        "Zero text/logo/watermark; top-left corner clean; no hands on tilt bars.",
      ].join(" "),
      contextUrls: [
        ...generated.map((f) => f.imageUrl),
        ...refs.slice(0, isFirstFrame ? 2 : 1),
      ],
      label: `shutter-sb#${args.index1Based}/${frame.id}`,
      generateOnce: (candidateIndex) =>
        generateOnce(frame, frameRefs, prompt, candidateIndex),
    });
    generated.push({
      id: frame.id,
      order: frame.order,
      imageUrl: picked.imageUrl,
      beat: frame.beat,
      imagePrompt: frame.imagePrompt,
      candidateUrls: picked.candidateUrls,
      gachaJudge: picked.judge,
    });
  }

  const artifact: Image2StoryboardArtifact = {
    source: "shuyu_image2",
    model: `${SHUYU_IMAGE_MODEL}/${args.imagePlanId ?? SHUYU_IMAGE_PLAN_ID}`,
    purpose: args.purpose,
    generatedAt: new Date().toISOString(),
    frames: generated,
  };

  requireStoryboardBeforeVideo(artifact, {
    runKind: "shutter_acceptance",
    clientLockProfileId: "sunnyshutter",
    minFrames: 3,
  });

  return artifact;
}

export function buildSunnyShutterI2VPlan(args: {
  index1Based: number;
  productName: string;
  productImageUrls: string[];
  storyboard: Image2StoryboardArtifact;
  /** Prefer Fast VIP for queue speed; audited plan-02 is cheaper flat for 15s. */
  preferFastVip?: boolean;
}): SunnyShutterPipelineVideoPlan {
  const variant = pickSunnyShutterCommerceVariant(args.index1Based);
  const storyboardUrls = [...args.storyboard.frames]
    .sort((a, b) => a.order - b.order)
    .map((f) => f.imageUrl.trim())
    .filter(Boolean);
  const inputImages = [...storyboardUrls, ...args.productImageUrls]
    .filter(Boolean)
    .slice(0, 9);
  return {
    videoPlanId: args.preferFastVip
      ? SHUYU_VIDEO_FAST_PLAN_ID
      : SHUYU_VIDEO_PLAN_ID,
    prompt: buildSunnyShutterVideoPrompt({
      variant,
      productName: args.productName,
      productImageUrls: args.productImageUrls,
    }),
    inputImages,
    durationSec: SUNNYSHUTTER_PIPELINE_DURATION_SEC,
    aspectRatio: SUNNYSHUTTER_PIPELINE_ASPECT,
  };
}

/** Speed-first failover: Fast VIP lanes before slow VIP flat plans. */
const VIDEO_PLAN_FAILOVER = [
  SHUYU_VIDEO_FAST_PLAN_ID, // video-plan-03 Fast VIP 推荐1
  "video-plan-05", // Fast VIP 推荐2
  "video-plan-04", // VIP 推荐1
  "video-plan-06", // VIP 推荐2
  SHUYU_VIDEO_PLAN_ID, // video-plan-02 audited flat
] as const;

export async function submitSunnyShutterI2V(args: {
  plan: SunnyShutterPipelineVideoPlan;
  providerRequestKey: string;
  options?: ShuyuFetchOptions;
}): Promise<{ taskId: string; planId: string }> {
  const candidates = Array.from(
    new Set([args.plan.videoPlanId, ...VIDEO_PLAN_FAILOVER]),
  );
  let lastError: unknown;
  for (const [index, planId] of candidates.entries()) {
    try {
      const created = await createShuyuVideoTask({
        ...args.options,
        providerRequestKey: `${args.providerRequestKey}:${planId}`.slice(0, 120),
        planId,
        prompt: args.plan.prompt,
        duration: args.plan.durationSec,
        aspectRatio: args.plan.aspectRatio,
        inputImages: args.plan.inputImages,
      });
      return { taskId: created.taskId, planId };
    } catch (error) {
      lastError = error;
      const busy =
        error instanceof ProviderSubmissionError &&
        (/unavailable|busy|繁忙/i.test(error.message) ||
          error.code === "model_unavailable");
      if (!busy && index === 0) {
        // Non-busy errors on primary should still try failover once for queue issues.
      }
      if (!busy && index > 0) continue;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All Shuyu video plans unavailable");
}

/**
 * Submit + poll with plan failover when upstream refunds for busy lines.
 */
export async function runSunnyShutterI2VWithFailover(args: {
  plan: SunnyShutterPipelineVideoPlan;
  providerRequestKey: string;
  options?: ShuyuFetchOptions;
  pollMs?: number;
  maxWaitMs?: number;
  label?: string;
}): Promise<{ taskId: string; planId: string; url: string }> {
  const candidates = Array.from(
    new Set([args.plan.videoPlanId, ...VIDEO_PLAN_FAILOVER]),
  );
  let lastError: unknown;
  for (const planId of candidates) {
    try {
      const created = await createShuyuVideoTask({
        ...args.options,
        timeoutMs: args.options?.timeoutMs ?? 20_000,
        providerRequestKey: `${args.providerRequestKey}:${planId}:${Date.now()}`.slice(
          0,
          120,
        ),
        planId,
        prompt: args.plan.prompt,
        duration: args.plan.durationSec,
        aspectRatio: args.plan.aspectRatio,
        inputImages: args.plan.inputImages,
      });
      const done = await pollShuyuTaskUntilDone(created.taskId, {
        ...args.options,
        label: `${args.label ?? "i2v"}/${planId}`,
        pollMs: args.pollMs ?? 8_000,
        maxWaitMs: args.maxWaitMs ?? 45 * 60_000,
      });
      return { taskId: created.taskId, planId, url: done.url! };
    } catch (error) {
      lastError = error;
      const retryable = /繁忙|busy|refunded|unavailable|timed out/i.test(
        error instanceof Error ? error.message : String(error),
      );
      if (!retryable) throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("SunnyShutter I2V failed on all video plans");
}
