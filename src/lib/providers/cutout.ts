/**
 * B1 第 0 层 · 产品抠图（PRD §5）。
 *
 * PRD 原话：「整条锚定路线卡在这里，所以实施第一件事是抠图，不是模型调优。
 * 抠图是成熟商品，商用 API 或开源分割模型二选一。」
 *
 * 这里做成可插拔适配器：remove.bg 与 Clipdrop 都是「一张图进、一张
 * 透明背景 PNG 出」的 REST 接口，谁的 key 配了就走谁。
 *
 * **没有 key 时明确抛错，不做假成功。** 旧的 remove-bg.ts 空壳返回
 * `processed: false` 原样透传，那对 I2V 预处理是可以接受的降级，
 * 但对产品锚定不行 —— 锚点的核心就是真实像素切片，没有切片就没有锚点，
 * 假装处理过会让下游把整图当成 RGBA 切片用。
 */

export type CutoutProviderId = "remove_bg" | "clipdrop";

export class CutoutUnavailableError extends Error {
  constructor() {
    super(
      "抠图服务未配置：需要 REMOVE_BG_API_KEY 或 CLIPDROP_API_KEY 之一（商用 key 待接入）",
    );
    this.name = "CutoutUnavailableError";
  }
}

export class CutoutFailedError extends Error {
  constructor(
    readonly provider: CutoutProviderId,
    message: string,
  ) {
    super(`[${provider}] 抠图失败：${message}`);
    this.name = "CutoutFailedError";
  }
}

export function availableCutoutProvider(): CutoutProviderId | null {
  if (process.env.REMOVE_BG_API_KEY?.trim()) return "remove_bg";
  if (process.env.CLIPDROP_API_KEY?.trim()) return "clipdrop";
  return null;
}

export function isCutoutAvailable(): boolean {
  return availableCutoutProvider() !== null;
}

export type CutoutResult = {
  /// 透明背景 RGBA PNG
  rgba: Buffer;
  provider: CutoutProviderId;
};

/// 归一化（0-1）产品区域，原点左上。与锚点的 logoBox 同构。
export type CutoutRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * remove.bg 的 roi 参数：「只允许此矩形内被识别为前景」。
 * 生活场景照（产品只占画面一角）没有它会抠错主体 —— B1 验收实测
 * 把餐桌椅当成了产品。
 *
 * 百分比必须是**整数**：带小数会被拒 `HTTP 400 invalid_roi`
 * （0803 UI 验收真机踩到）。起点向下、终点向上取整 = 框只放大不缩小，
 * 不会把产品边缘裁进背景。
 */
export function roiFormValue(region: CutoutRegion): string {
  const clamp = (value: number) => Math.min(100, Math.max(0, value * 100));
  const x1 = Math.floor(clamp(region.x));
  const y1 = Math.floor(clamp(region.y));
  const x2 = Math.ceil(clamp(region.x + region.width));
  const y2 = Math.ceil(clamp(region.y + region.height));
  return `${x1}% ${y1}% ${x2}% ${y2}%`;
}

/**
 * 抠出产品 RGBA 切片。
 *
 * @param image 原图字节（png/jpg 均可，上游已限制大小）
 */
export async function cutoutProduct(
  image: Buffer,
  options: { roi?: CutoutRegion | null; fetchImpl?: typeof fetch } = {},
): Promise<CutoutResult> {
  const provider = availableCutoutProvider();
  if (!provider) throw new CutoutUnavailableError();
  const doFetch = options.fetchImpl ?? fetch;

  if (provider === "remove_bg") {
    const form = new FormData();
    form.append(
      "image_file",
      new File([new Uint8Array(image)], "product.png", { type: "image/png" }),
    );
    /// size=auto：按账户额度给最高可用分辨率；format=png 保住 alpha。
    form.append("size", "auto");
    form.append("format", "png");
    if (options.roi) form.append("roi", roiFormValue(options.roi));
    const res = await doFetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": process.env.REMOVE_BG_API_KEY!.trim() },
      body: form,
    });
    if (!res.ok) {
      throw new CutoutFailedError(
        "remove_bg",
        `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    return { rgba: Buffer.from(await res.arrayBuffer()), provider };
  }

  /// Clipdrop 无 roi 等价参数：区域约束只在 remove.bg 生效。
  const form = new FormData();
  form.append(
    "image_file",
    new File([new Uint8Array(image)], "product.png", { type: "image/png" }),
  );
  const res = await doFetch("https://clipdrop-api.co/remove-background/v1", {
    method: "POST",
    headers: { "x-api-key": process.env.CLIPDROP_API_KEY!.trim() },
    body: form,
  });
  if (!res.ok) {
    throw new CutoutFailedError(
      "clipdrop",
      `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
    );
  }
  return { rgba: Buffer.from(await res.arrayBuffer()), provider };
}
