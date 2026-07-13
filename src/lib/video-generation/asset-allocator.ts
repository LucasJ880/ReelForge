import { createHash } from "node:crypto";
import type { BatchStyleImagesPerVideo } from "./batch-style-templates";

export interface AllocatableAsset {
  id: string;
  url: string;
}

export interface AssetAssignment {
  index: number;
  assets: AllocatableAsset[];
  /**
   * 同一有序组合第几次出现。0 = 首次；组合空间耗尽后递增，
   * 与 seed 一起构成可审计变体，不需要破坏全局均衡。
   */
  variantIndex: number;
  seed: number;
  dedupeKey: string;
}

export interface AllocateAssetsInput {
  batchId: string;
  images: AllocatableAsset[];
  count: number;
  templateId: string;
  imagesPerVideo: BatchStyleImagesPerVideo;
}

function uint32Hash(input: string): number {
  // Prisma/Postgres Int 为 signed 32-bit；保留非负 31 bit 便于直接持久化。
  return createHash("sha256").update(input).digest().readUInt32BE(0) & 0x7fffffff;
}

function deterministicShuffle<T>(items: T[], seedText: string): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      rank: uint32Hash(`${seedText}:${index}`),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * 50 图 → N 视频确定性分配。
 *
 * 均衡证明：所有 assignment 的素材槽位来自同一个「洗牌后图片数组」无限循环，
 * 截取前 totalSlots 个槽位；因此任意两图计数只可能相差 0 或 1。
 *
 * 去重策略：有序组合未耗尽时 variantIndex=0；重复出现时递增 variantIndex，
 * 并由 batch/template/组合/序号派生唯一 seed。Provider 用 seed 制造构图变体，
 * assignedAssets + seed 一并持久化，完整可审计。
 */
export function allocateAssets(input: AllocateAssetsInput): AssetAssignment[] {
  const { batchId, images, count, templateId, imagesPerVideo } = input;
  if (!batchId.trim()) throw new Error("batchId 不能为空");
  if (!templateId.trim()) throw new Error("templateId 不能为空");
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error("生成数量必须是 1-200 的整数");
  }
  if (images.length < 1 || images.length > 50) {
    throw new Error("图片数量必须是 1-50");
  }
  if (
    !Number.isInteger(imagesPerVideo.min) ||
    !Number.isInteger(imagesPerVideo.max) ||
    imagesPerVideo.min < 1 ||
    imagesPerVideo.min > imagesPerVideo.max
  ) {
    throw new Error("imagesPerVideo 范围不合法");
  }
  if (images.length < imagesPerVideo.min) {
    throw new Error(
      `当前模板每条至少需要 ${imagesPerVideo.min} 张图，实际只有 ${images.length} 张`,
    );
  }
  const ids = images.map((image) => image.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("images 中存在重复 id");
  }
  for (const image of images) {
    if (!image.id.trim() || !/^https?:\/\//i.test(image.url)) {
      throw new Error("每张图片必须有唯一 id 和 http(s) CDN URL");
    }
  }

  const maxImages = Math.min(imagesPerVideo.max, images.length);
  const range = maxImages - imagesPerVideo.min + 1;
  const inputFingerprint = ids.join("|");
  const shuffled = deterministicShuffle(
    images,
    `${batchId}:${templateId}:${inputFingerprint}:${count}`,
  );

  const combinationOccurrences = new Map<string, number>();
  const assignments: AssetAssignment[] = [];
  let slotCursor = 0;

  for (let index = 0; index < count; index++) {
    const k = imagesPerVideo.min + (index % range);
    const assets: AllocatableAsset[] = [];
    for (let offset = 0; offset < k; offset++) {
      assets.push(shuffled[(slotCursor + offset) % shuffled.length]);
    }
    slotCursor += k;

    const combination = assets.map((asset) => asset.id).join(">");
    const variantIndex = combinationOccurrences.get(combination) ?? 0;
    combinationOccurrences.set(combination, variantIndex + 1);
    const seed = uint32Hash(
      `${batchId}:${templateId}:${combination}:variant:${variantIndex}`,
    );

    assignments.push({
      index,
      assets,
      variantIndex,
      seed,
      dedupeKey: `${combination}#${seed}`,
    });
  }
  return assignments;
}

export function countAssetUsage(
  assignments: AssetAssignment[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    for (const asset of assignment.assets) {
      counts.set(asset.id, (counts.get(asset.id) ?? 0) + 1);
    }
  }
  return counts;
}

export const __test__ = { uint32Hash, deterministicShuffle };
