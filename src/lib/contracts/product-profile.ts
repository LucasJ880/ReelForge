import { z } from "zod";
import { stripHookAngle } from "@/lib/create/hook-angles";
import { PRODUCT_SIZE_MAX, applyProductSize, detectProductSize, stripProductSize } from "@/lib/create/product-size";

/**
 * 商品档案（2026-11-10）。纯契约：客户端组件、接口与测试共用，不引服务端模块。
 *
 * 一件商品 = 名字 + 卖点 + 实际大小 + 一组商品图。商家回来多半是给同一件商品再拍一条：
 * 存一次，之后点一下就带着商品图和这段话进创作页，只需要再写「这次想怎么拍」。
 *
 * 图片不复制：只记素材 id（MediaAsset），读的时候按属主再核一遍。
 */
export const PRODUCT_NAME_MAX = 40;
export const PRODUCT_SELLING_POINTS_MAX = 600;
/** 和创作页的商品图上限一致 */
export const PRODUCT_IMAGES_MAX = 9;
/** 一个账号最多存多少件（没归档的） */
export const PRODUCT_PROFILES_MAX = 60;

const assetId = z.string().trim().min(1).max(200);

const fields = {
  name: z.string().trim().min(1).max(PRODUCT_NAME_MAX),
  sellingPoints: z.string().trim().max(PRODUCT_SELLING_POINTS_MAX),
  size: z.string().trim().max(PRODUCT_SIZE_MAX),
  imageAssetIds: z.array(assetId).min(1).max(PRODUCT_IMAGES_MAX),
};

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** 新建：手填，或者从拍过的一单存过来（fromOrderId）。 */
export const productProfileCreateSchema = z.union([
  z
    .object({
      name: fields.name,
      sellingPoints: fields.sellingPoints.default(""),
      size: fields.size.default(""),
      imageAssetIds: fields.imageAssetIds,
    })
    .strict()
    .transform((input) => ({
      kind: "manual" as const,
      name: input.name,
      sellingPoints: input.sellingPoints,
      size: input.size || null,
      imageAssetIds: uniqueIds(input.imageAssetIds),
    })),
  z
    .object({ fromOrderId: z.string().trim().min(1).max(200) })
    .strict()
    .transform((input) => ({ kind: "import" as const, orderId: input.fromOrderId })),
]);

export type ProductProfileCreateInput = z.infer<typeof productProfileCreateSchema>;

/** 修改：只改带上的字段；`archived: true` = 归档（记录保留，不再出现在列表里）。 */
export const productProfilePatchSchema = z
  .object({
    name: fields.name.optional(),
    sellingPoints: fields.sellingPoints.optional(),
    size: fields.size.optional(),
    imageAssetIds: fields.imageAssetIds.optional(),
    archived: z.literal(true).optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), { message: "empty patch" })
  .transform((input) => ({
    name: input.name,
    sellingPoints: input.sellingPoints,
    /// 传空串 = 清掉尺寸
    size: input.size === undefined ? undefined : input.size || null,
    imageAssetIds: input.imageAssetIds ? uniqueIds(input.imageAssetIds) : undefined,
    archived: input.archived === true,
  }));

export type ProductProfilePatchInput = z.infer<typeof productProfilePatchSchema>;

export type ProductProfileImage = { assetId: string; url: string };

export type ProductProfileView = {
  id: string;
  name: string;
  sellingPoints: string;
  size: string | null;
  /// 仍归本人所有的商品图；一张都不剩时这件商品拍不了，页面会提示补图
  images: ProductProfileImage[];
  updatedAt: string;
};

/**
 * 带进创作页的那段话：「名字：卖点」，尺寸另起一行（和创作页「商品尺寸」写的是同一行，改得动、删得掉）。
 * 只写商品本身；这次想怎么拍，由商家接着往下写。
 */
export function productProfilePrompt(
  profile: Pick<ProductProfileView, "name" | "sellingPoints" | "size">,
  locale: "zh" | "en",
): string {
  const name = profile.name.trim();
  const points = profile.sellingPoints.trim();
  /// 冒号跟着内容的语言走，不跟界面语言：英文界面里存的中文商品，接出来不该是「唇釉: 玫瑰…」
  const separator = /[\u3400-\u9fff]/u.test(name + points) ? "：" : ": ";
  const base = !points ? name : points.startsWith(name) ? points : `${name}${separator}${points}`;
  return applyProductSize(base, profile.size ?? "", locale);
}

/**
 * 从以前写过的一段创作描述里拆出一份档案草稿：去掉我们补的「开头方向」「尺寸」那两行，
 * 第一句当名字（冒号 / 句号 / 逗号之前，截到上限），整段当卖点，尺寸行单独取出来。
 */
export function productDraftFromPrompt(prompt: string): { name: string; sellingPoints: string; size: string | null } {
  const size = detectProductSize(prompt)?.trim() || null;
  const body = stripProductSize(stripHookAngle(prompt)).trim();
  const firstLine = body.split("\n")[0] ?? "";
  const head = firstLine.split(/[：:。.，,；;！!？?]/u)[0]?.trim() || firstLine.trim();
  const name = Array.from(head).slice(0, PRODUCT_NAME_MAX).join("");
  return {
    name,
    sellingPoints: Array.from(body).slice(0, PRODUCT_SELLING_POINTS_MAX).join(""),
    size: size ? Array.from(size).slice(0, PRODUCT_SIZE_MAX).join("") : null,
  };
}
