import { expect, test, type Page } from "@playwright/test";
import {
  PHONE_PHOTO_HEIGHT,
  PHONE_PHOTO_MIN_BYTES,
  PHONE_PHOTO_WIDTH,
  optionColorProblem,
} from "./prod-smoke-helpers";
import { drawPhonePhoto, readOptionColors } from "./prod-smoke-page";

/**
 * 冒烟的探测器先自检一遍（离线，不碰生产）：探测器要是认不出坏样子，冒烟就会对着坏掉的生产报绿；
 * 浏览器升级改了计算样式的行为，也是这里先红。随冒烟一起跑（playwright.prod-smoke.config.ts）。
 *
 * 下拉页面照 streamlined-video-studio 的 ChipSelect 写：透明、不可见的原生 select 叠在芯片上，
 * 页面是深底浅字——选项不单独上色时，原生弹层就是 10-30 的白底白字。
 */
function chipSelectPage(optionCss: string): string {
  return `<!doctype html><html><head><style>
    body { background: #000; color: #fff; }
    ${optionCss}
  </style></head><body><main>
    <label style="position: relative; display: inline-flex;">
      <span>创意模板</span><span aria-hidden="true">自动匹配（推荐）</span>
      <select style="position: absolute; inset: 0; appearance: none; opacity: 0;">
        <option value="auto">自动匹配（推荐）</option>
        <option value="unboxing">开箱测评</option>
        <option value="pain-point">痛点解决</option>
      </select>
    </label>
  </main></body></html>`;
}

async function templateOptionProblems(page: Page, optionCss: string): Promise<Array<string | null>> {
  await page.setContent(chipSelectPage(optionCss));
  const template = page.locator("label").filter({ hasText: "创意模板" }).locator("select");
  return (await readOptionColors(template)).map(optionColorProblem);
}

test.describe("探测器自检（离线）", () => {
  test("下拉：认得出 10-30 的白底白字，放得过修好的配色", async ({ page }) => {
    const broken = await templateOptionProblems(page, "");
    expect(broken, "选项不上色（10-30 修复前）必须判失败").toHaveLength(3);
    for (const problem of broken) expect(problem).toMatch(/底色透明/);

    /// 与 globals.css 的修复同一写法（--popover #1b1e23 / --popover-foreground #ffffff）
    const fixed = "select { color-scheme: dark; } select option, select optgroup { background-color: #1b1e23; color: #ffffff; }";
    expect(await templateOptionProblems(page, fixed)).toEqual([null, null, null]);

    /// oklch 这类新色彩写法也得能比，不能因为解析不了就放过或误报
    expect(await templateOptionProblems(page, "select option { background-color: oklch(0.235 0.011 258); color: oklch(1 0 0); }"))
      .toEqual([null, null, null]);
    for (const problem of await templateOptionProblems(page, "select option { background-color: #1b1e23; color: #3a3f46; }")) {
      expect(problem).toMatch(/低于 4\.5:1/);
    }
  });

  test("测试图：浏览器解得开的 JPEG，3024×4032，≥6MB", async ({ page }) => {
    await page.setContent("<!doctype html><title>phone photo</title>");
    const photo = await drawPhonePhoto(page);
    expect(photo.length).toBeGreaterThanOrEqual(PHONE_PHOTO_MIN_BYTES);
    expect(photo.subarray(0, 3).toString("hex"), "JPEG 文件签名").toBe("ffd8ff");
    const decoded = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      return { width: bitmap.width, height: bitmap.height };
    }, photo.toString("base64"));
    expect(decoded).toEqual({ width: PHONE_PHOTO_WIDTH, height: PHONE_PHOTO_HEIGHT });
  });
});
