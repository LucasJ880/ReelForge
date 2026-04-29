import { Prisma, RawAssetStatus, RawAssetType } from "@prisma/client";
import { db } from "@/lib/db";

export interface RegisterRawAssetInput {
  deliveryOrderId: string;
  type: RawAssetType;
  name: string;
  url: string;
  mimeType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  checksum?: string;
  notes?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface PreprocessRawAssetOptions {
  silenceThresholdDb?: number;
  motionThreshold?: number;
  marginBeforeMs?: number;
  marginAfterMs?: number;
  targetShotMs?: number;
  minShotMs?: number;
  transcript?: string;
  visualSummary?: string;
}

const DEFAULT_PREPROCESS = {
  silenceThresholdDb: -28,
  motionThreshold: 0.02,
  marginBeforeMs: 300,
  marginAfterMs: 500,
  targetShotMs: 4500,
  minShotMs: 1200,
};

const SUPPORTED_VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const SUPPORTED_IMAGE_EXT = /\.(png|jpe?g|webp)(\?|$)/i;
const SUPPORTED_AUDIO_EXT = /\.(mp3|wav|m4a|aac)(\?|$)/i;

export async function registerRawAsset(input: RegisterRawAssetInput) {
  assertSupportedRawAsset(input);

  const asset = await db.rawAsset.create({
    data: {
      deliveryOrderId: input.deliveryOrderId,
      type: input.type,
      name: input.name,
      url: input.url,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      width: input.width,
      height: input.height,
      fileSizeBytes: input.fileSizeBytes,
      checksum: input.checksum,
      notes: input.notes,
      tags: input.tags as unknown as Prisma.InputJsonValue,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  await syncLegacyFootageAssets(input.deliveryOrderId);
  return asset;
}

export async function listRawAssets(deliveryOrderId: string) {
  return db.rawAsset.findMany({
    where: { deliveryOrderId },
    orderBy: { createdAt: "desc" },
    include: { shots: { orderBy: { shotIndex: "asc" } } },
  });
}

function assertSupportedRawAsset(input: RegisterRawAssetInput) {
  const byType = {
    [RawAssetType.VIDEO]: {
      pattern: SUPPORTED_VIDEO_EXT,
      label: "视频素材仅支持 mp4、mov、m4v、webm",
    },
    [RawAssetType.IMAGE]: {
      pattern: SUPPORTED_IMAGE_EXT,
      label: "图片素材仅支持 png、jpg、jpeg、webp",
    },
    [RawAssetType.AUDIO]: {
      pattern: SUPPORTED_AUDIO_EXT,
      label: "音频素材仅支持 mp3、wav、m4a、aac",
    },
  }[input.type];

  if (!byType.pattern.test(input.url)) {
    throw new Error(
      `${byType.label}。请重新上传支持格式，或确认素材 URL 保留正确文件扩展名：${input.name}`,
    );
  }
}

export async function preprocessRawAsset(
  rawAssetId: string,
  options: PreprocessRawAssetOptions = {},
) {
  const asset = await db.rawAsset.findUnique({
    where: { id: rawAssetId },
    include: { deliveryOrder: true },
  });
  if (!asset) throw new Error("素材不存在");

  const settings = { ...DEFAULT_PREPROCESS, ...options };
  await db.rawAsset.update({
    where: { id: rawAssetId },
    data: { status: RawAssetStatus.PROCESSING, errorMessage: null },
  });

  try {
    const shots = buildShotCandidates({
      asset,
      settings,
      transcript: options.transcript,
      visualSummary: options.visualSummary,
    });

    await db.$transaction([
      db.footageShot.deleteMany({ where: { rawAssetId } }),
      ...shots.map((shot) =>
        db.footageShot.create({
          data: {
            rawAssetId,
            shotIndex: shot.shotIndex,
            startMs: shot.startMs,
            endMs: shot.endMs,
            durationMs: shot.durationMs,
            thumbnailUrl: shot.thumbnailUrl,
            transcript: shot.transcript,
            visualSummary: shot.visualSummary,
            tags: shot.tags,
            qualityScore: shot.qualityScore,
            usabilityNotes: shot.usabilityNotes,
            technical: shot.technical as Prisma.InputJsonValue,
          },
        }),
      ),
      db.rawAsset.update({
        where: { id: rawAssetId },
        data: {
          status: RawAssetStatus.INDEXED,
          metadata: {
            ...jsonObject(asset.metadata),
            preprocess: settings,
            indexedShotCount: shots.length,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);

    await syncLegacyFootageAssets(asset.deliveryOrderId);
    return db.rawAsset.findUnique({
      where: { id: rawAssetId },
      include: { shots: { orderBy: { shotIndex: "asc" } } },
    });
  } catch (err) {
    await db.rawAsset.update({
      where: { id: rawAssetId },
      data: {
        status: RawAssetStatus.FAILED,
        errorMessage: (err as Error).message,
      },
    });
    throw err;
  }
}

export async function preprocessDeliveryOrderAssets(
  deliveryOrderId: string,
  options: PreprocessRawAssetOptions = {},
) {
  const assets = await db.rawAsset.findMany({
    where: { deliveryOrderId, status: { not: RawAssetStatus.INDEXED } },
    orderBy: { createdAt: "asc" },
  });
  if (assets.length === 0) {
    throw new Error("没有可预处理的 RawAsset：请先上传或登记真实素材");
  }

  const indexed = [];
  for (const asset of assets) {
    indexed.push(await preprocessRawAsset(asset.id, options));
  }
  return indexed;
}

function buildShotCandidates(params: {
  asset: {
    type: RawAssetType;
    name: string;
    url: string;
    durationMs: number | null;
    notes: string | null;
    tags: Prisma.JsonValue;
  };
  settings: typeof DEFAULT_PREPROCESS;
  transcript?: string;
  visualSummary?: string;
}) {
  const { asset, settings } = params;
  if (asset.type === RawAssetType.IMAGE) {
    return [
      {
        shotIndex: 1,
        startMs: 0,
        endMs: settings.targetShotMs,
        durationMs: settings.targetShotMs,
        thumbnailUrl: asset.url,
        transcript: params.transcript ?? null,
        visualSummary:
          params.visualSummary ?? asset.notes ?? `Still image asset: ${asset.name}`,
        tags: normalizeTags(asset.tags, ["image", "product"]),
        qualityScore: 0.72,
        usabilityNotes: "静态素材可用于产品 hero、封面或 CTA 画面。",
        technical: {
          source: "poc_indexer",
          edit: "still_image",
          marginBeforeMs: settings.marginBeforeMs,
          marginAfterMs: settings.marginAfterMs,
        },
      },
    ];
  }

  const durationMs = Math.max(asset.durationMs ?? 18000, settings.minShotMs);
  const shotCount = Math.max(
    1,
    Math.min(8, Math.ceil(durationMs / settings.targetShotMs)),
  );
  const baseDuration = Math.floor(durationMs / shotCount);
  const transcriptParts = splitTranscript(params.transcript, shotCount);
  const baseTags = normalizeTags(asset.tags, [
    asset.type === RawAssetType.AUDIO ? "audio" : "video",
    "real_footage",
  ]);

  return Array.from({ length: shotCount }).map((_, i) => {
    const rawStart = i * baseDuration;
    const rawEnd = i === shotCount - 1 ? durationMs : (i + 1) * baseDuration;
    const startMs = Math.max(0, rawStart - settings.marginBeforeMs);
    const endMs = Math.min(durationMs, rawEnd + settings.marginAfterMs);
    const duration = Math.max(settings.minShotMs, endMs - startMs);

    return {
      shotIndex: i + 1,
      startMs,
      endMs: Math.min(durationMs, startMs + duration),
      durationMs: Math.min(durationMs, startMs + duration) - startMs,
      thumbnailUrl: null,
      transcript: transcriptParts[i] ?? null,
      visualSummary:
        params.visualSummary ??
        asset.notes ??
        `${asset.name} 的第 ${i + 1} 个可用镜头片段`,
      tags: [...baseTags, i === 0 ? "hook_candidate" : "b_roll"].slice(0, 8),
      qualityScore: Number((0.68 + Math.min(i, 3) * 0.04).toFixed(2)),
      usabilityNotes:
        i === 0
          ? "适合作为前 3 秒 hook 或产品出现镜头。"
          : "适合作为中段证明、使用场景或节奏补充镜头。",
      technical: {
        source: "poc_indexer",
        edit: "audio_or_motion_threshold",
        silenceThresholdDb: settings.silenceThresholdDb,
        motionThreshold: settings.motionThreshold,
        marginBeforeMs: settings.marginBeforeMs,
        marginAfterMs: settings.marginAfterMs,
      },
    };
  });
}

async function syncLegacyFootageAssets(deliveryOrderId: string) {
  const [order, assets] = await Promise.all([
    db.deliveryOrder.findUnique({
      where: { id: deliveryOrderId },
      select: { productInput: true },
    }),
    db.rawAsset.findMany({
      where: { deliveryOrderId },
      orderBy: { createdAt: "asc" },
      include: { shots: true },
    }),
  ]);
  if (!order) return;

  const productInput = jsonObject(order.productInput);
  await db.deliveryOrder.update({
    where: { id: deliveryOrderId },
    data: {
      productInput: {
        ...productInput,
        footage_assets: assets.map((asset) => ({
          id: asset.id,
          type: asset.type.toLowerCase(),
          name: asset.name,
          url: asset.url,
          status: asset.status,
          shot_count: asset.shots.length,
        })),
      } as Prisma.InputJsonValue,
    },
  });
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTags(value: Prisma.JsonValue, fallback: string[]) {
  if (Array.isArray(value)) {
    return value
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
      .slice(0, 8);
  }
  return fallback;
}

function splitTranscript(transcript: string | undefined, count: number) {
  if (!transcript) return [];
  const sentences = transcript
    .split(/(?<=[。！？.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [];
  const chunks = Array.from({ length: count }, () => [] as string[]);
  sentences.forEach((sentence, index) => {
    chunks[index % count].push(sentence);
  });
  return chunks.map((items) => items.join(" "));
}
