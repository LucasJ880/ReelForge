/**
 * 确定性 logo 贴印（logo 版「产品锚点」，0805）。
 *
 * 背景：生成式印 logo 是抽卡 —— 同一提示词抽出过「SUNNY 词标（丢圆盘）」、
 * 「盘内 SR6 乱码 + 假小字」，v1 也是两抽才合格。CEO 方向：不必百分百还原，
 * 但拼写/构成不能错。根治 = 品牌 lockup 资产直接按像素贴到静帧上，
 * 不经过任何生成模型；生成模型只负责画「无字标的干净产品」。
 *
 * 能力：
 *  - patch：先用同一静帧上的干净材质条覆盖旧字标（清场）；
 *  - composite：真 lockup 按目标宽度缩放、可调透明度贴上（印制感来自
 *    半透明 + 材质本身的光影从字标下透出）。
 *
 * 本模块只处理静帧（产品图 / 英雄镜头素材）。动镜头贴印需要跟踪，明确不做。
 */

import sharp from "sharp";

export interface ImprintPatch {
  /** 要清场的区域（旧字标所在） */
  cover: { left: number; top: number; width: number; height: number };
  /** 干净材质取样区（同一材质、同一光照带，尺寸任意，会缩放到 cover） */
  from: { left: number; top: number; width: number; height: number };
  /** 边缘羽化像素（默认 8）：斜面/渐变材质上矩形克隆会露边，羽化后融入 */
  featherPx?: number;
}

export interface ImprintSpec {
  basePath: string;
  lockupPath: string;
  outputPath: string;
  /** 贴印落位：中心点 + 目标宽度（像素，等比缩放） */
  dest: { centerX: number; centerY: number; width: number };
  /** 印制感透明度（0-1，默认 0.92：让材质光影微微透出） */
  opacity?: number;
  patch?: ImprintPatch;
}

async function lockupWithOpacity(
  lockupPath: string,
  width: number,
  opacity: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const resized = await sharp(lockupPath)
    .resize({ width, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = resized;
  if (opacity < 1) {
    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * opacity);
    }
  }
  const buffer = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return { buffer, width: info.width, height: info.height };
}

/** 在静帧上确定性贴印品牌 lockup，返回 outputPath。 */
export async function imprintLogoOnStill(spec: ImprintSpec): Promise<string> {
  const opacity = spec.opacity ?? 0.92;
  const meta = await sharp(spec.basePath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`cannot read base image size: ${spec.basePath}`);
  }

  const composites: sharp.OverlayOptions[] = [];

  if (spec.patch) {
    const { cover } = spec.patch;
    const feather = Math.max(0, spec.patch.featherPx ?? 8);
    let patchPipeline = sharp(spec.basePath)
      .extract(spec.patch.from)
      .resize(cover.width, cover.height, { fit: "fill" });
    if (feather > 0) {
      /// 软边 alpha 蒙版：白色内缩圆角矩形 + 高斯模糊 → 克隆条边缘融进材质
      const inset = feather;
      const mask = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cover.width}" height="${cover.height}">
          <defs><filter id="f"><feGaussianBlur stdDeviation="${feather / 2}"/></filter></defs>
          <rect x="${inset}" y="${inset}" width="${cover.width - inset * 2}" height="${cover.height - inset * 2}" rx="${feather}" fill="white" filter="url(#f)"/>
        </svg>`,
      );
      patchPipeline = patchPipeline.composite([
        { input: mask, blend: "dest-in" },
      ]);
    }
    const patchBuf = await patchPipeline.png().toBuffer();
    composites.push({ input: patchBuf, left: cover.left, top: cover.top });
  }

  const lockup = await lockupWithOpacity(
    spec.lockupPath,
    spec.dest.width,
    opacity,
  );
  const left = Math.round(spec.dest.centerX - lockup.width / 2);
  const top = Math.round(spec.dest.centerY - lockup.height / 2);
  if (
    left < 0 ||
    top < 0 ||
    left + lockup.width > meta.width ||
    top + lockup.height > meta.height
  ) {
    throw new Error(
      `lockup out of bounds: ${lockup.width}x${lockup.height}@(${left},${top}) on ${meta.width}x${meta.height}`,
    );
  }
  composites.push({ input: lockup.buffer, left, top });

  await sharp(spec.basePath).composite(composites).toFile(spec.outputPath);
  return spec.outputPath;
}
