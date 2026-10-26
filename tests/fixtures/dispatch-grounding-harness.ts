import { createHash } from "node:crypto";
import { db } from "../../src/lib/db";
import { dispatchVideoForBrief } from "../../src/lib/services/video-service";

/**
 * 单条派发的 grounding 夹具：monkey-patch Prisma，截在分段派发之前（第二次读 brief 返回 null），
 * 只取 dispatchVideoForBrief 写回 brief 的参考图与改写后的段提示词。零计费、不碰供应商。
 */
export const BASE_SEGMENT_PROMPT = [
  "9:16 vertical UGC-style short video shot on a phone, 15s continuous story told in 4 quick cuts.",
  "LOCATION: real lived-in home environment",
  "PRODUCT SHAPE LOCK: keep the product.",
  'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "带它出门。"',
].join("\n");

export function directorPlanFixture(segments: Array<{ fromSec: number; toSec: number }>) {
  return {
    language: "zh-CN",
    targetDurationSec: segments[segments.length - 1].toSec,
    platform: "tiktok",
    strategySummary: {
      targetAudience: "宠物主",
      corePainPoint: "看不到狗在干嘛",
      emotionalAngle: "安心",
      keySellingPoints: ["第一视角"],
    },
    timelineScript: [{ fromSec: 0, toSec: segments[segments.length - 1].toSec, visual: "公园" }],
    segmentPlan: segments.map((segment, segmentIndex) => ({
      segmentIndex,
      durationSec: segment.toSec - segment.fromSec,
      fromSec: segment.fromSec,
      toSec: segment.toSec,
      role: "hook",
      seedancePrompt: BASE_SEGMENT_PROMPT,
      negativePrompt: "no text",
    })),
    editingPlan: {},
  };
}

export interface StoryboardRunFixture {
  inputImageUrls: string[];
  anchorCutoutUrls?: string[];
  personAssetIds?: string[];
  frameCount: number;
  durationSec: number;
}

export interface DispatchCapture {
  referenceImageUrls: string[];
  directorPlan: Record<string, unknown> | null;
  prompts: string[];
  personAssetQueries: number;
}

type Patchable = Record<string, unknown>;

export async function captureDispatchGrounding(
  run: StoryboardRunFixture,
  segments: Array<{ fromSec: number; toSec: number }>,
): Promise<DispatchCapture> {
  const restore: Array<() => void> = [];
  const patch = (model: Patchable, patches: Patchable) => {
    for (const [key, value] of Object.entries(patches)) {
      const original = model[key];
      model[key] = value;
      restore.push(() => {
        model[key] = original;
      });
    }
  };
  let briefReads = 0;
  const updates: Array<Record<string, unknown>> = [];
  let personAssetQueries = 0;
  patch(db.videoBrief as unknown as Patchable, {
    findUnique: async () => {
      briefReads += 1;
      return briefReads === 1
        ? { id: "brief-1", targetDurationSec: segments[segments.length - 1].toSec, directorPlan: directorPlanFixture(segments) }
        : null;
    },
    update: async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
      return {};
    },
  });
  patch(db.storyboardRun as unknown as Patchable, {
    findUnique: async () => ({
      id: "run-1",
      userId: "owner-1",
      status: "APPROVED",
      sourcePrompt: "一只金毛在公园奔跑。",
      aspectRatio: "9:16",
      durationSec: run.durationSec,
      inputImageUrls: run.inputImageUrls,
      anchorCutoutUrls: run.anchorCutoutUrls ?? [],
      personAssetIds: run.personAssetIds ?? [],
      frames: Array.from({ length: run.frameCount }, (_, ordinal) => ({
        id: `f${ordinal}`,
        ordinal,
        beat: `beat ${ordinal + 1}`,
        status: "SUCCEEDED",
        isCurrent: true,
        outputAsset: { userId: "owner-1", url: `https://a.test/frame-${ordinal}.png` },
      })),
    }),
  });
  patch(db.mediaAsset as unknown as Patchable, {
    findMany: async (args: { where: { id: { in: string[] } } }) => {
      personAssetQueries += 1;
      return args.where.id.in.map((id) => ({ id, url: `https://a.test/person-${id}.jpg`, mimeType: "image/jpeg" }));
    },
  });
  try {
    await dispatchVideoForBrief("brief-1").catch((error: Error) => {
      if (!/Brief 不存在/.test(error.message)) throw error;
    });
  } finally {
    for (const undo of restore.reverse()) undo();
  }
  const written = updates[0] ?? {};
  const directorPlan = (written.directorPlan as Record<string, unknown> | undefined) ?? null;
  const segmentPlan = (directorPlan?.segmentPlan as Array<{ seedancePrompt: string }> | undefined) ?? [];
  return {
    referenceImageUrls: (written.referenceImageUrls as string[] | undefined) ?? [],
    directorPlan,
    prompts: segmentPlan.map((segment) => segment.seedancePrompt),
    personAssetQueries,
  };
}

/** 无切片、无主播的派发矩阵：实拍 0–9 张 × 帧 4/5 × 单段/两段。 */
export async function plainDispatchMatrixDigest(): Promise<string> {
  const hash = createHash("sha256");
  for (const photos of [0, 1, 2, 3, 5, 9]) {
    for (const [frameCount, durationSec, segments] of [
      [4, 15, [{ fromSec: 0, toSec: 15 }]],
      [5, 30, [{ fromSec: 0, toSec: 15 }, { fromSec: 15, toSec: 30 }]],
    ] as const) {
      const capture = await captureDispatchGrounding(
        {
          inputImageUrls: Array.from({ length: photos }, (_, i) => `https://a.test/real-${i}.jpg`),
          frameCount,
          durationSec,
        },
        [...segments],
      );
      hash.update(JSON.stringify({ refs: capture.referenceImageUrls, prompts: capture.prompts }));
    }
  }
  return hash.digest("hex");
}

if (process.argv[1]?.endsWith("dispatch-grounding-harness.ts")) {
  plainDispatchMatrixDigest().then((digest) => console.log(digest));
}
