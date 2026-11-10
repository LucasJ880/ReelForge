import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  PRODUCT_PROFILES_MAX,
  productDraftFromPrompt,
  type ProductProfileCreateInput,
  type ProductProfilePatchInput,
  type ProductProfileView,
} from "@/lib/contracts/product-profile";
import {
  listRecentCreateSources,
  loadCreateRetryPrefill,
  type RecentCreateSource,
} from "@/lib/services/create-retry-prefill-service";

/**
 * 商品档案（2026-11-10）：商家常拍的商品存一次，以后点一下就带着商品图和卖点进创作页。
 *
 * 全部按属主读写（userId = 当前用户），别人的档案一律当作不存在。图片只记素材 id：
 * 存的时候核一遍「是本人的图片」，读的时候再核一遍——图片后来不归本人了，就从这件商品里消失，不报错。
 * 不物理删除：归档只写 archivedAt（CLAUDE.md §4 铁律 2）。
 */

/** 商品档案表还没建（迁移没跑）：只有这个功能不可用，调用方据此如实提示。 */
export class ProductProfileUnavailableError extends Error {
  constructor() {
    super("product profile storage is not ready");
    this.name = "ProductProfileUnavailableError";
  }
}

export class ProductProfileNotFoundError extends Error {
  constructor() {
    super("product profile not found");
    this.name = "ProductProfileNotFoundError";
  }
}

/** 带来的图片里有不是本人的、或不是图片的。 */
export class ProductProfileImagesError extends Error {
  constructor() {
    super("product profile images are not usable");
    this.name = "ProductProfileImagesError";
  }
}

/** 已经存满了。 */
export class ProductProfileLimitError extends Error {
  constructor() {
    super("product profile limit reached");
    this.name = "ProductProfileLimitError";
  }
}

/** 那一单没有可用的商品图 / 描述，存不成档案。 */
export class ProductProfileImportError extends Error {
  constructor() {
    super("order cannot be saved as a product profile");
    this.name = "ProductProfileImportError";
  }
}

function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingTable(error)) throw new ProductProfileUnavailableError();
    throw error;
  }
}

type Row = {
  id: string;
  name: string;
  sellingPoints: string;
  size: string | null;
  imageAssetIds: string[];
  updatedAt: Date;
};

const ROW_SELECT = { id: true, name: true, sellingPoints: true, size: true, imageAssetIds: true, updatedAt: true } as const;

type OwnedImage = { id: string; url: string; mimeType: string; width: number | null; height: number | null };

/** 这些 id 里仍归本人所有的图片。 */
async function ownedImages(userId: string, assetIds: string[]): Promise<Map<string, OwnedImage>> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return new Map();
  const assets = await db.mediaAsset.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, url: true, mimeType: true, width: true, height: true },
  });
  return new Map(
    assets.filter((asset) => asset.mimeType.toLowerCase().startsWith("image/")).map((asset) => [asset.id, asset]),
  );
}

function toView(row: Row, images: Map<string, OwnedImage>): ProductProfileView {
  return {
    id: row.id,
    name: row.name,
    sellingPoints: row.sellingPoints,
    size: row.size,
    images: row.imageAssetIds
      .filter((assetId) => images.has(assetId))
      .map((assetId) => ({ assetId, url: (images.get(assetId) as OwnedImage).url })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertUsableImages(userId: string, assetIds: string[]): Promise<void> {
  const images = await ownedImages(userId, assetIds);
  if (assetIds.some((assetId) => !images.has(assetId))) throw new ProductProfileImagesError();
}

/** 本人没归档的商品，最近改过的在前。 */
export async function listProductProfiles(userId: string): Promise<ProductProfileView[]> {
  return guarded(async () => {
    const rows = await db.productProfile.findMany({
      where: { userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: PRODUCT_PROFILES_MAX,
      select: ROW_SELECT,
    });
    const images = await ownedImages(userId, rows.flatMap((row) => row.imageAssetIds));
    return rows.map((row) => toView(row, images));
  });
}

async function insertProfile(
  userId: string,
  data: { name: string; sellingPoints: string; size: string | null; imageAssetIds: string[] },
): Promise<ProductProfileView> {
  await assertUsableImages(userId, data.imageAssetIds);
  return guarded(async () => {
    const active = await db.productProfile.count({ where: { userId, archivedAt: null } });
    if (active >= PRODUCT_PROFILES_MAX) throw new ProductProfileLimitError();
    const row = await db.productProfile.create({ data: { userId, ...data }, select: ROW_SELECT });
    return toView(row, await ownedImages(userId, row.imageAssetIds));
  });
}

/** 新建一件商品：手填，或者把拍过的一单（本人的）存成档案。 */
export async function createProductProfile(userId: string, input: ProductProfileCreateInput): Promise<ProductProfileView> {
  if (input.kind === "manual") {
    return insertProfile(userId, {
      name: input.name,
      sellingPoints: input.sellingPoints,
      size: input.size,
      imageAssetIds: input.imageAssetIds,
    });
  }
  const prefill = await loadCreateRetryPrefill(input.orderId, userId);
  if (!prefill || prefill.productAssets.length === 0) throw new ProductProfileImportError();
  const draft = productDraftFromPrompt(prefill.prompt);
  if (!draft.name) throw new ProductProfileImportError();
  return insertProfile(userId, { ...draft, imageAssetIds: prefill.productAssets.map((asset) => asset.id) });
}

/** 改字段或归档。只动本人没归档的那一条；找不到就是不存在。 */
export async function updateProductProfile(
  userId: string,
  id: string,
  patch: ProductProfilePatchInput,
): Promise<ProductProfileView | null> {
  if (patch.imageAssetIds) await assertUsableImages(userId, patch.imageAssetIds);
  return guarded(async () => {
    const data: Prisma.ProductProfileUpdateManyMutationInput = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.sellingPoints !== undefined ? { sellingPoints: patch.sellingPoints } : {}),
      ...(patch.size !== undefined ? { size: patch.size } : {}),
      ...(patch.imageAssetIds ? { imageAssetIds: patch.imageAssetIds } : {}),
      ...(patch.archived ? { archivedAt: new Date() } : {}),
    };
    const result = await db.productProfile.updateMany({ where: { id, userId, archivedAt: null }, data });
    if (result.count === 0) throw new ProductProfileNotFoundError();
    if (patch.archived) return null;
    const row = await db.productProfile.findFirst({ where: { id, userId }, select: ROW_SELECT });
    if (!row) throw new ProductProfileNotFoundError();
    return toView(row, await ownedImages(userId, row.imageAssetIds));
  });
}

/** 创作页 `?product=<id>` 的预填：这件商品的话 + 仍归本人的商品图。别人的、归档的、表没建 → null。 */
export interface ProductProfilePrefill {
  id: string;
  name: string;
  sellingPoints: string;
  size: string | null;
  productAssets: OwnedImage[];
}

export async function loadProductProfilePrefill(userId: string, productId: string): Promise<ProductProfilePrefill | null> {
  const id = productId.trim();
  if (!id || id.length > 200) return null;
  let row: Row | null;
  try {
    row = await db.productProfile.findFirst({ where: { id, userId, archivedAt: null }, select: ROW_SELECT });
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!row) return null;
  const images = await ownedImages(userId, row.imageAssetIds);
  return {
    id: row.id,
    name: row.name,
    sellingPoints: row.sellingPoints,
    size: row.size,
    productAssets: row.imageAssetIds.filter((assetId) => images.has(assetId)).map((assetId) => images.get(assetId) as OwnedImage),
  };
}

/** 「商品」页要的全部数据。available=false 表示档案表还没建，页面如实说明、不装成「你还没有商品」。 */
export interface ProductLibraryData {
  available: boolean;
  products: ProductProfileView[];
  /// 最近拍过、还没存成档案的（按第一张商品图判断是不是同一件）
  suggestions: RecentCreateSource[];
}

export async function loadProductLibrary(userId: string): Promise<ProductLibraryData> {
  let products: ProductProfileView[];
  try {
    products = await listProductProfiles(userId);
  } catch (error) {
    if (!(error instanceof ProductProfileUnavailableError)) throw error;
    console.warn("[products] product profile table is not ready");
    return { available: false, products: [], suggestions: [] };
  }
  const recent = await listRecentCreateSources(userId, 8);
  return { available: true, products, suggestions: unsavedSources(recent, products).slice(0, 4) };
}

/** 去掉已经存成档案的那些（档案里有这一单的第一张商品图）。 */
export function unsavedSources(recent: RecentCreateSource[], products: ProductProfileView[]): RecentCreateSource[] {
  const saved = new Set(products.flatMap((product) => product.images.map((image) => image.assetId)));
  return recent.filter((source) => !saved.has(source.firstAssetId));
}

/**
 * 创作页那一行「接着拍」：存好的商品在前，不够四格再用最近拍过、还没存的补上。
 * 可选装饰：读不到就当没有并留一行日志，创作页照常能用（同 loadRecentCreateSourcesOrNone 的理由）。
 */
export interface CreateShortcut {
  kind: "product" | "order";
  id: string;
  /// 商品名，或那一单的创作描述（调用方自己截短）
  title: string;
  thumbnailUrl: string;
  imageCount: number;
}

export async function loadCreateShortcutsOrNone(userId: string, limit = 4): Promise<CreateShortcut[]> {
  let products: ProductProfileView[] = [];
  try {
    products = (await listProductProfiles(userId)).filter((product) => product.images.length > 0);
  } catch (error) {
    if (!(error instanceof ProductProfileUnavailableError)) {
      console.warn("[create] product profiles unavailable:", error instanceof Error ? error.message : String(error));
    }
  }
  const shortcuts: CreateShortcut[] = products.slice(0, limit).map((product) => ({
    kind: "product",
    id: product.id,
    title: product.name,
    thumbnailUrl: product.images[0].url,
    imageCount: product.images.length,
  }));
  if (shortcuts.length >= limit) return shortcuts;
  try {
    const recent = unsavedSources(await listRecentCreateSources(userId, limit * 2), products);
    for (const source of recent.slice(0, limit - shortcuts.length)) {
      shortcuts.push({
        kind: "order",
        id: source.orderId,
        title: source.prompt,
        thumbnailUrl: source.thumbnailUrl,
        imageCount: source.imageCount,
      });
    }
  } catch (error) {
    console.warn("[create] recent sources unavailable:", error instanceof Error ? error.message : String(error));
  }
  return shortcuts;
}
