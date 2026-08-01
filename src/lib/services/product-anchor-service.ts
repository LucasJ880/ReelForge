import sharp from "sharp";
import { db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import {
  cutoutProduct,
  CutoutUnavailableError,
  isCutoutAvailable,
} from "@/lib/providers/cutout";
import type { LogoBox } from "@/lib/services/logo-fidelity-gate";

/**
 * B1 · 产品身份锚定三层管线的第 0 层（PRD §5 / M5）。
 *
 * 一个 SKU 做一次，之后所有内容复用。锚点 = RGBA 切片 + mask + logo 区域框。
 *
 * 抠图 key 未配置时锚点停在 PENDING_CUTOUT，**不做假成功** ——
 * 假装处理过会让下游把整图当成 RGBA 切片用，那正是「整图重绘」那一档。
 * key 配上后跑 processPendingAnchors() 即可续上，不需要商家重新提交。
 */

export type CreateAnchorArgs = {
  userId: string;
  sku: string;
  sourceImageUrl: string;
  brandName?: string | null;
  /// 用户框一次 logo 区域（归一化坐标）。
  /// 一次性人工换 100% 可靠基准 —— 比让模型猜框可靠得多。
  logoBox?: LogoBox | null;
};

export async function createProductAnchor(args: CreateAnchorArgs) {
  const anchor = await db.productAnchor.upsert({
    where: { userId_sku: { userId: args.userId, sku: args.sku } },
    create: {
      userId: args.userId,
      sku: args.sku,
      sourceImageUrl: args.sourceImageUrl,
      brandName: args.brandName ?? null,
      logoBoxJson: args.logoBox ?? undefined,
    },
    update: {
      /// 换图 = 重新锚定：切片与 mask 作废，回到待抠图。
      sourceImageUrl: args.sourceImageUrl,
      brandName: args.brandName ?? null,
      logoBoxJson: args.logoBox ?? undefined,
      cutoutUrl: null,
      maskUrl: null,
      status: "PENDING_CUTOUT",
      failureReason: null,
    },
  });

  if (!isCutoutAvailable()) {
    /// 明确停在待抠图，界面上能看到原因。这不是失败态：key 到位就能续跑。
    return db.productAnchor.update({
      where: { id: anchor.id },
      data: {
        failureReason:
          "等待抠图服务接入（remove.bg / Clipdrop 商用 key 待配置）",
      },
    });
  }

  return runCutout(anchor.id);
}

/**
 * 执行抠图并派生 mask。独立出来是为了 key 后配的场景：
 * `processPendingAnchors` 扫 PENDING_CUTOUT 逐个续跑。
 */
export async function runCutout(anchorId: string) {
  const anchor = await db.productAnchor.findUniqueOrThrow({
    where: { id: anchorId },
  });

  try {
    const sourceRes = await fetch(anchor.sourceImageUrl);
    if (!sourceRes.ok) {
      throw new Error(`原图取不到：HTTP ${sourceRes.status}`);
    }
    const source = Buffer.from(await sourceRes.arrayBuffer());

    const { rgba, provider } = await cutoutProduct(source);
    const mask = await maskFromAlpha(rgba);

    const storage = getStorageProvider();
    const prefix = `product-anchors/${anchor.id}`;
    const [cutoutObj, maskObj] = await Promise.all([
      storage.uploadBuffer("renders", rgba, {
        key: `${prefix}/cutout.png`,
        access: "public",
        contentType: "image/png",
        overwrite: true,
      }),
      storage.uploadBuffer("renders", mask, {
        key: `${prefix}/mask.png`,
        access: "public",
        contentType: "image/png",
        overwrite: true,
      }),
    ]);

    return db.productAnchor.update({
      where: { id: anchor.id },
      data: {
        cutoutUrl: cutoutObj.url,
        maskUrl: maskObj.url,
        cutoutProvider: provider,
        status: "READY",
        failureReason: null,
      },
    });
  } catch (err) {
    if (err instanceof CutoutUnavailableError) {
      /// key 没配不算失败，留在待抠图。
      return db.productAnchor.update({
        where: { id: anchor.id },
        data: { failureReason: err.message },
      });
    }
    return db.productAnchor.update({
      where: { id: anchor.id },
      data: {
        status: "FAILED",
        failureReason: (err as Error).message.slice(0, 500),
      },
    });
  }
}

/** key 后配时的续跑入口：扫所有停在待抠图的锚点。 */
export async function processPendingAnchors(limit = 20) {
  const pending = await db.productAnchor.findMany({
    where: { status: "PENDING_CUTOUT" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let ready = 0;
  for (const anchor of pending) {
    const updated = await runCutout(anchor.id);
    if (updated.status === "READY") ready += 1;
  }
  return { scanned: pending.length, ready };
}

/**
 * 从 RGBA 的 alpha 通道派生 mask：白 = 产品，黑 = 背景。
 *
 * 阈值取 128 而不是 >0：抠图边缘有半透明羽化像素，
 * 把它们算进产品会让 mask 边缘带一圈锯齿状的「毛边保护区」。
 */
export async function maskFromAlpha(rgba: Buffer): Promise<Buffer> {
  return sharp(rgba)
    .ensureAlpha()
    .extractChannel("alpha")
    .threshold(128)
    .png()
    .toBuffer();
}

/**
 * 路径 A 的 mask 变换：OpenAI images.edit 的语义是**透明区域才允许重画**。
 * 我们的 mask 是「白=产品」，所以要变成「产品不透明（锁死）、环境透明（可画）」。
 */
export async function toEditableMask(mask: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(mask)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i += 1) {
    const isProduct = data[i] >= 128;
    out[i * 4] = 0;
    out[i * 4 + 1] = 0;
    out[i * 4 + 2] = 0;
    /// 产品像素不透明 = 不许画；环境透明 = 可画。
    out[i * 4 + 3] = isProduct ? 255 : 0;
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * 路径 B · 贴回合成（PRD §5 第 1 层）：
 * 模型生成环境 → 锚点 RGBA 原位贴回。Shuyu image2 无 mask 能力走这条。
 *
 * 光影匹配（PRD 提到的进阶步骤）此版不做：贴回是确定性操作，
 * 光影匹配是另一个生成问题，混在一起会让「产品像素零重画」这个保证失效。
 */
export async function compositeAnchorOnto(
  environment: Buffer,
  cutout: Buffer,
): Promise<Buffer> {
  const envMeta = await sharp(environment).metadata();
  const width = envMeta.width ?? 1024;
  const height = envMeta.height ?? 1024;

  /// 切片按环境图等比缩放到不超过画面（保持产品原比例，不拉伸）。
  const fitted = await sharp(cutout)
    .resize(width, height, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  return sharp(environment)
    .composite([{ input: fitted, gravity: "centre" }])
    .png()
    .toBuffer();
}
