/**
 * Image2 storyboard-first hard gate — **SunnyShutter client only**.
 *
 * Peer guidance (WeChat): generate storyboard with Image2 / gpt-image-2 BEFORE
 * Seedance submit for shutter / presenter plot-locked runs. Text beats alone
 * (PLOT LOCK) are not enough — visual keyframes must exist.
 *
 * Other merchants do not inherit this gate; add a new client lock profile when
 * onboarding the next customer.
 *
 * Existing Image2 path: `src/lib/providers/openai-image.ts` (gpt-image-2) and
 * Phase 1 of `scripts/sunny-shutter-investor-demo-v21.ts`.
 *
 * Spec: docs/acceptance/shutter-safe-shot-policy.md
 */

import {
  resolveClientLockProfile,
  usesSunnyShutterLocks,
  type ClientLockProfileId,
} from "@/lib/video-generation/client-lock-profiles";

export const STORYBOARD_FIRST_RUN_KINDS = [
  "shutter_acceptance",
  "shutter_presenter",
] as const;

export type StoryboardFirstRunKind =
  | (typeof STORYBOARD_FIRST_RUN_KINDS)[number]
  | "general";

export type Image2StoryboardFrame = {
  id: string;
  order: number;
  /** Public URL (preferred) or absolute file path after Image2 generation. */
  imageUrl: string;
  beat?: string;
  imagePrompt?: string;
  /** 抽卡：本帧生成的全部候选图（imageUrl 为择优胜者）。 */
  candidateUrls?: string[];
  /** 抽卡评审：择优结论（checked=false 表示评审不可用、fail-open 取第一张）。 */
  gachaJudge?: { chosenIndex: number; checked: boolean; note: string };
};

export type Image2StoryboardSource =
  | "openai_image2"
  | "shuyu_image2"
  | "manual_keyframes";

export type Image2StoryboardArtifact = {
  source: Image2StoryboardSource;
  /** e.g. gpt-image-2 when source is openai_image2 */
  model?: string;
  purpose: string;
  frames: Image2StoryboardFrame[];
  generatedAt?: string;
};

export type StoryboardGateContext = {
  runKind: StoryboardFirstRunKind;
  /** Default: 2 for shutter_* runs, 1 otherwise. */
  minFrames?: number;
};

export type StoryboardValidationResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

const DEFAULT_SHUTTER_MIN_FRAMES = 2;

export function isStoryboardRequired(context: {
  runKind: StoryboardFirstRunKind;
}): boolean {
  return (
    context.runKind === "shutter_acceptance" ||
    context.runKind === "shutter_presenter"
  );
}

/** Prompts built by `renderSafeShutterPrompt` always imply storyboard-first. */
export function promptImpliesStoryboardFirst(prompt: string): boolean {
  if (!prompt?.trim()) return false;
  return (
    /PRODUCT MECHANICS PRECONDITIONS/i.test(prompt) ||
    /\bPLOT LOCK\b/i.test(prompt)
  );
}

function defaultMinFrames(runKind: StoryboardFirstRunKind): number {
  return isStoryboardRequired({ runKind }) ? DEFAULT_SHUTTER_MIN_FRAMES : 1;
}

function hasUsableImageUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  const value = url.trim();
  return (
    /^https?:\/\//i.test(value) ||
    value.startsWith("/") ||
    value.startsWith("file:")
  );
}

export function validateImage2Storyboard(
  artifact: Image2StoryboardArtifact | null | undefined,
  opts?: { minFrames?: number },
): StoryboardValidationResult {
  const reasons: string[] = [];
  if (!artifact) {
    return {
      ok: false,
      reasons: [
        "missing image2 storyboard artifact — generate storyboard frames with gpt-image-2 (Image2) before Seedance submit",
      ],
    };
  }
  if (
    artifact.source !== "openai_image2" &&
    artifact.source !== "shuyu_image2" &&
    artifact.source !== "manual_keyframes"
  ) {
    reasons.push(`unsupported storyboard source: ${String(artifact.source)}`);
  }
  if (!artifact.purpose?.trim()) {
    reasons.push("storyboard purpose is required");
  }
  if (!Array.isArray(artifact.frames) || artifact.frames.length === 0) {
    reasons.push("storyboard frames[] is empty");
  } else {
    const minFrames = opts?.minFrames ?? 1;
    if (artifact.frames.length < minFrames) {
      reasons.push(
        `need at least ${minFrames} storyboard frame(s), got ${artifact.frames.length}`,
      );
    }
    for (const frame of artifact.frames) {
      if (!frame?.id?.trim()) {
        reasons.push("each frame needs a non-empty id");
        continue;
      }
      if (!Number.isFinite(frame.order)) {
        reasons.push(`frame ${frame.id}: order must be a number`);
      }
      if (!hasUsableImageUrl(frame.imageUrl)) {
        reasons.push(
          `frame ${frame.id}: imageUrl missing or not a usable http(s)/path`,
        );
      }
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * Fail-closed pre-dispatch check. No-op for `runKind: "general"`.
 * Throws Error with actionable message when shutter/presenter runs lack frames.
 */
export function requireStoryboardBeforeVideo(
  artifact: Image2StoryboardArtifact | null | undefined,
  context: StoryboardGateContext & {
    /** Required for scoping: only SunnyShutter fail-closes. */
    clientLockProfileId?: ClientLockProfileId | string | null;
  },
): void {
  const profile = resolveClientLockProfile({
    clientLockProfileId: context.clientLockProfileId,
  });
  if (!usesSunnyShutterLocks(profile)) return;
  if (!isStoryboardRequired(context)) return;
  const minFrames = context.minFrames ?? defaultMinFrames(context.runKind);
  const result = validateImage2Storyboard(artifact, { minFrames });
  if (!result.ok) {
    throw new Error(
      `[storyboard-lock] storyboard-first required for sunnyshutter/${context.runKind}: ${result.reasons.join("; ")}`,
    );
  }
}

/** Adapt sunny-shutter-investor-demo-v21 StoryboardRecord → canonical artifact. */
export function storyboardFromDemoRecord(record: {
  purpose: string;
  source: "openai" | "manual" | string;
  model?: string;
  generatedAt?: string;
  segments: Array<{
    index: number;
    title?: string;
    blobUrl?: string;
    localPath?: string;
  }>;
}): Image2StoryboardArtifact {
  const source: Image2StoryboardSource =
    record.source === "manual" ? "manual_keyframes" : "openai_image2";
  return {
    source,
    model: record.model,
    purpose: record.purpose,
    generatedAt: record.generatedAt,
    frames: record.segments.map((seg) => ({
      id: `seg-${seg.index}`,
      order: seg.index,
      imageUrl: (seg.blobUrl || seg.localPath || "").trim(),
      beat: seg.title,
    })),
  };
}

export function parseStoryboardArtifact(raw: unknown): Image2StoryboardArtifact {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid storyboard artifact: expected object");
  }
  const obj = raw as Record<string, unknown>;

  /// Investor-demo shape: { source: openai|manual, segments: [...] }
  if (Array.isArray(obj.segments) && typeof obj.purpose === "string") {
    const artifact = storyboardFromDemoRecord({
      purpose: obj.purpose,
      source: String(obj.source ?? "openai"),
      model: typeof obj.model === "string" ? obj.model : undefined,
      generatedAt:
        typeof obj.generatedAt === "string" ? obj.generatedAt : undefined,
      segments: obj.segments as Array<{
        index: number;
        title?: string;
        blobUrl?: string;
        localPath?: string;
      }>,
    });
    const check = validateImage2Storyboard(artifact, { minFrames: 1 });
    if (!check.ok) {
      throw new Error(`invalid storyboard artifact: ${check.reasons.join("; ")}`);
    }
    return artifact;
  }

  /// Canonical shape: { source, purpose, frames }
  if (Array.isArray(obj.frames) && typeof obj.purpose === "string") {
    const source = obj.source;
    if (source !== "openai_image2" && source !== "manual_keyframes") {
      throw new Error("invalid storyboard artifact: bad source");
    }
    const artifact: Image2StoryboardArtifact = {
      source,
      model: typeof obj.model === "string" ? obj.model : undefined,
      purpose: obj.purpose,
      generatedAt:
        typeof obj.generatedAt === "string" ? obj.generatedAt : undefined,
      frames: obj.frames as Image2StoryboardFrame[],
    };
    const check = validateImage2Storyboard(artifact, { minFrames: 1 });
    if (!check.ok) {
      throw new Error(`invalid storyboard artifact: ${check.reasons.join("; ")}`);
    }
    return artifact;
  }

  throw new Error(
    "invalid storyboard artifact: need purpose + frames[] (or demo segments[])",
  );
}

export function storyboardGateIssues(args: {
  prompts: string[];
  storyboard?: Image2StoryboardArtifact | null;
  runKind?: StoryboardFirstRunKind;
  minFrames?: number;
  /** Only SunnyShutter enables this gate; other clients always get []. */
  clientLockProfileId?: ClientLockProfileId | string | null;
}): Array<{ code: string; message: string }> {
  const profile = resolveClientLockProfile({
    clientLockProfileId: args.clientLockProfileId,
  });
  if (!usesSunnyShutterLocks(profile)) return [];

  const implied = args.prompts.some(promptImpliesStoryboardFirst);
  const runKind =
    args.runKind ?? (implied ? "shutter_presenter" : "general");
  if (!implied && !isStoryboardRequired({ runKind })) {
    return [];
  }
  const effectiveKind: StoryboardFirstRunKind =
    runKind === "general" && implied ? "shutter_presenter" : runKind;
  const minFrames =
    args.minFrames ?? defaultMinFrames(effectiveKind);
  const result = validateImage2Storyboard(args.storyboard, { minFrames });
  if (result.ok) return [];
  return [
    {
      code: "missing_image2_storyboard",
      message: `SunnyShutter storyboard-first gate: ${result.reasons.join("; ")}. Generate Image2 (gpt-image-2) keyframes before Seedance submit.`,
    },
  ];
}
