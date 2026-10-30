import type { Locator, Page } from "@playwright/test";
import {
  PHONE_PHOTO_HEIGHT,
  PHONE_PHOTO_MIN_BYTES,
  PHONE_PHOTO_WIDTH,
  type OptionColors,
} from "./prod-smoke-helpers";

/**
 * 发布后冒烟里在浏览器页面中执行的两件事（e2e/prod-smoke.spec.ts 用）：现画一张手机原图、
 * 读原生下拉选项的颜色。单独成文件，方便对着本地静态页验证它们本身没写错。
 */

/**
 * 在页面里画一张手机原图尺寸的噪声 JPEG：用浏览器自己的编码器，文件签名、尺寸都是真的。
 * 纯噪声几乎压不动（质量 0.7 约 6.1MB、0.8 约 7.4MB），从低往高试，取第一张够大的，少占上传额度。
 */
export async function drawPhonePhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height, minBytes }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      /// willReadFrequently = CPU 画布：GPU 画布在无头 Chromium 里第一次编码后像素会丢，再编出来是空图
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas 2d 不可用");
      const image = context.createImageData(width, height);
      const random = new Uint8Array(65_536); // getRandomValues 单次上限 64KB
      for (let offset = 0; offset < image.data.length; offset += random.length) {
        crypto.getRandomValues(random);
        image.data.set(random.subarray(0, Math.min(random.length, image.data.length - offset)), offset);
      }
      for (let alpha = 3; alpha < image.data.length; alpha += 4) image.data[alpha] = 255;
      context.putImageData(image, 0, 0);
      for (const quality of [0.7, 0.75, 0.8, 0.9]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob || blob.size < minBytes) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        return btoa(binary);
      }
      throw new Error(`JPEG 编码到质量 0.9 仍不足 ${minBytes} 字节`);
    },
    { width: PHONE_PHOTO_WIDTH, height: PHONE_PHOTO_HEIGHT, minBytes: PHONE_PHOTO_MIN_BYTES },
  );
  return Buffer.from(base64, "base64");
}

/** 读一个下拉里每个选项的计算样式；颜色用 canvas 换算成 sRGB（oklch / color() 也能比）。 */
export async function readOptionColors(select: Locator): Promise<OptionColors[]> {
  return select.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas 2d 不可用");
    const toRgba = (css: string) => {
      context.clearRect(0, 0, 1, 1);
      /// 先置透明：万一某个值 canvas 不认，结果是「透明」——判失败，而不是沿用上一个颜色蒙混过关
      context.fillStyle = "rgba(0, 0, 0, 0)";
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    return Array.from((element as HTMLSelectElement).options, (option) => {
      const style = getComputedStyle(option);
      return {
        label: option.label,
        cssColor: style.color,
        cssBackground: style.backgroundColor,
        color: toRgba(style.color),
        background: toRgba(style.backgroundColor),
      };
    });
  });
}
