import { createHash } from "node:crypto";
import sharp from "sharp";

import { db } from "@/lib/db";
import type { UnifiedVideoGenerationRequestInput } from "@/lib/schemas/unified-input";
import type {
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "@/types/video-generation";

export interface MediaAssetRecord {
  id: string;
  userId: string;
  workspaceId: string | null;
  storageKey: string;
  url: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOwnedMediaAssetInput {
  userId: string;
  workspaceId?: string | null;
  storageKey: string;
  url: string;
  mimeType: string;
  bytes: Buffer | Uint8Array;
}

interface MediaAssetRepository {
  create(args: {
    data: {
      userId: string;
      workspaceId: string | null;
      storageKey: string;
      url: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      width: number | null;
      height: number | null;
    };
  }): Promise<MediaAssetRecord>;
  findMany(args: {
    where: { userId: string; id: { in: string[] } };
  }): Promise<MediaAssetRecord[]>;
}

let repositoryOverride: MediaAssetRepository | null = null;

function repository(): MediaAssetRepository {
  if (repositoryOverride) return repositoryOverride;
  return {
    create: (args) => db.mediaAsset.create(args),
    findMany: (args) => db.mediaAsset.findMany(args),
  };
}

async function imageDimensions(
  bytes: Buffer,
  mimeType: string,
): Promise<{ width: number | null; height: number | null }> {
  if (!mimeType.toLowerCase().startsWith("image/")) {
    return { width: null, height: null };
  }
  const metadata = await sharp(bytes).metadata();
  return {
    width: metadata.width ?? null,
    height: metadata.height ?? null,
  };
}

export async function createOwnedMediaAsset(
  input: CreateOwnedMediaAssetInput,
): Promise<MediaAssetRecord> {
  const bytes = Buffer.from(input.bytes);
  const dimensions = await imageDimensions(bytes, input.mimeType);
  return repository().create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      storageKey: input.storageKey,
      url: input.url,
      mimeType: input.mimeType,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...dimensions,
    },
  });
}

export class MediaAssetNotFoundError extends Error {
  constructor() {
    super("Media asset not found");
    this.name = "MediaAssetNotFoundError";
  }
}

export class MediaAssetTypeError extends Error {
  constructor(message = "Media asset must be an image") {
    super(message);
    this.name = "MediaAssetTypeError";
  }
}

export async function resolveOwnedMediaAssets(args: {
  userId: string;
  assetIds: string[];
}): Promise<MediaAssetRecord[]> {
  if (args.assetIds.length === 0) return [];
  const uniqueIds = [...new Set(args.assetIds)];
  const records = await repository().findMany({
    where: { userId: args.userId, id: { in: uniqueIds } },
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  return args.assetIds.map((assetId) => {
    const record = byId.get(assetId);
    if (!record) throw new MediaAssetNotFoundError();
    return record;
  });
}

export async function resolveOwnedImageAssets(args: {
  userId: string;
  assetIds: string[];
}): Promise<MediaAssetRecord[]> {
  const assets = await resolveOwnedMediaAssets(args);
  if (assets.some((asset) => !asset.mimeType.toLowerCase().startsWith("image/"))) {
    throw new MediaAssetTypeError();
  }
  return assets;
}

function mediaType(mimeType: string): UploadedAsset["type"] {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  throw new MediaAssetNotFoundError();
}

export async function resolveOwnedCreationRequest(args: {
  userId: string;
  request: UnifiedVideoGenerationRequestInput;
}): Promise<UnifiedVideoGenerationRequest> {
  const assets = await resolveOwnedMediaAssets({
    userId: args.userId,
    assetIds: args.request.attachments.map((attachment) => attachment.assetId),
  });
  return {
    ...args.request,
    attachments: args.request.attachments.map((attachment, index) => {
      const asset = assets[index];
      return {
        ...attachment,
        id: asset.id,
        assetId: asset.id,
        type: mediaType(asset.mimeType),
        url: asset.url,
        mimeType: asset.mimeType,
        fileName: asset.storageKey.split("/").at(-1) || attachment.fileName,
        width: asset.width,
        height: asset.height,
      };
    }),
  };
}

export function __setMediaAssetRepositoryForTests(
  repository: MediaAssetRepository | null,
): void {
  repositoryOverride = repository;
}
