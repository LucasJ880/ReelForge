import { z } from "zod";

/**
 * B1 · 产品锚定的对外契约（PRD §5 / M5）。
 *
 * 路由与前端共用这一份：字段变更只改这里。
 * 本文件必须保持客户端可安全引用（只有 zod 与纯类型，无服务端依赖）。
 */

/**
 * 商家在前端框选的产品区域（归一化 0-1 坐标，原点左上）。
 * 一次性人工框选换 100% 可靠基准：既是校验 Gate 的身份区域（logoBox），
 * 也作为 remove.bg 的 roi，防止生活场景照把桌椅当成产品抠出来
 * （B1 验收实测踩过这个坑）。
 */
export const logoBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.02).max(1),
    height: z.number().min(0.02).max(1),
  })
  .refine((box) => box.x + box.width <= 1.001 && box.y + box.height <= 1.001, {
    message: "产品区域超出图片范围",
  });

export type LogoBoxInput = z.infer<typeof logoBoxSchema>;

export const createProductAnchorRequestSchema = z
  .object({
    /// SKU 由商家命名；同一 SKU 重复提交 = 换图重新锚定（服务层 upsert 语义）。
    sku: z.string().trim().min(1).max(80),
    brandName: z.string().trim().min(1).max(120).optional(),
    /// 只收服务端资产 ID，不信任外部 URL（与 upload/blob 的约定一致）。
    sourceAssetId: z.string().trim().min(1).max(200),
    logoBox: logoBoxSchema,
  })
  .strict();

export type CreateProductAnchorRequest = z.infer<
  typeof createProductAnchorRequestSchema
>;

export type ProductAnchorStatusView = "PENDING_CUTOUT" | "READY" | "FAILED";

export type ProductAnchorView = {
  id: string;
  sku: string;
  brandName: string | null;
  status: ProductAnchorStatusView;
  /// PENDING_CUTOUT 时也可能非空（例如「等待抠图服务接入」的原因说明）。
  failureReason: string | null;
  sourceImageUrl: string;
  cutoutUrl: string | null;
  cutoutProvider: string | null;
  logoBox: LogoBoxInput | null;
  createdAt: string;
  updatedAt: string;
};

/** 结构化入参而非 Prisma 类型：契约层不得依赖服务端模块。 */
export function productAnchorView(anchor: {
  id: string;
  sku: string;
  brandName: string | null;
  status: string;
  failureReason: string | null;
  sourceImageUrl: string;
  cutoutUrl: string | null;
  cutoutProvider: string | null;
  logoBoxJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ProductAnchorView {
  const parsedBox = logoBoxSchema.safeParse(anchor.logoBoxJson);
  return {
    id: anchor.id,
    sku: anchor.sku,
    brandName: anchor.brandName,
    status: anchor.status as ProductAnchorStatusView,
    failureReason: anchor.failureReason,
    sourceImageUrl: anchor.sourceImageUrl,
    cutoutUrl: anchor.cutoutUrl,
    cutoutProvider: anchor.cutoutProvider,
    logoBox: parsedBox.success ? parsedBox.data : null,
    createdAt: anchor.createdAt.toISOString(),
    updatedAt: anchor.updatedAt.toISOString(),
  };
}
