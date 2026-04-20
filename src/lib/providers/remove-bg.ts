/**
 * I2V 参考图抠图/白底预处理。
 *
 * MVP 行为：若未配置 REMOVE_BG_API_KEY，原样返回（不处理）。
 * V2 可接入 remove.bg / Clipdrop / 自建 SAM 服务。
 */

export interface ProcessImageResult {
  url: string;
  processed: boolean;
  /** 处理说明或跳过理由 */
  note?: string;
}

export async function processReferenceImage(
  imageUrl: string,
): Promise<ProcessImageResult> {
  if (!process.env.REMOVE_BG_API_KEY) {
    return {
      url: imageUrl,
      processed: false,
      note: "REMOVE_BG_API_KEY 未配置，跳过抠图",
    };
  }

  // V2: 真实抠图 API 调用
  // 返回处理后的白底图 URL（上传到 Vercel Blob 后返回）
  return {
    url: imageUrl,
    processed: false,
    note: "TODO: 接入真实抠图服务",
  };
}

export async function processReferenceImages(
  urls: string[],
): Promise<ProcessImageResult[]> {
  return Promise.all(urls.map(processReferenceImage));
}
