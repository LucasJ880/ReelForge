import { expect, test } from "@playwright/test";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);


/// 新账号首次进创作页会弹首用引导（正常产品行为，spec 写于它出现之前）。
/// 真实用户会点「跳过」—— 测试同样先关掉它再走主流程。
/// 弹窗在水合后的 useEffect 里才挂载：先等工作台本体出现再给出现窗口。
async function dismissFirstRunOnboarding(page: import("@playwright/test").Page) {
  await page.getByTestId("streamlined-video-studio").waitFor();
  const onboarding = page.getByTestId("first-run-onboarding");
  if (await onboarding.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await onboarding.getByRole("button", { name: "跳过" }).click();
    await onboarding.waitFor({ state: "hidden" });
  }
}

test("RF-038: creation follows one upload-to-generate flow with a persistent final action", async ({ page }) => {

  await page.goto("/app/create");
  await dismissFirstRunOnboarding(page);

  await expect(page.getByTestId("streamlined-first-use-guide")).toBeVisible();
  await expect(page.getByTestId("streamlined-product-assets")).toBeVisible();
  await expect(page.getByTestId("streamlined-generation-mode")).toBeVisible();
  await expect(page.getByTestId("streamlined-video-specs")).toBeVisible();
  await expect(page.getByTestId("streamlined-video-prompt")).toBeVisible();

  const generate = page.locator("#platform-primary-generate");
  await expect(generate).toBeVisible();
  await expect(generate).toBeDisabled();

  /// 0722 改版后客户面**不再暴露线路选择**（统一走 Aivora 引擎，线路由
  /// C1 自动路由决定）。守两个方向：选择器不回潮 + 说明文案在场。
  await expect(page.getByRole("button", { name: /视频生成接口/ })).toHaveCount(0);
  await expect(page.getByText(/统一走 Aivora 引擎/)).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.getByText("1 / 9 张")).toBeVisible();

  await page.getByRole("textbox", { name: "描述你想生成的视频" }).fill(
    "15 秒真实产品演示，保持产品外观一致，先呈现问题，再展示一次清晰使用动作与结果。",
  );
  await expect(generate).toBeEnabled();
  await expect(generate).toHaveText("核对规格与积分");
  await dismissFirstRunOnboarding(page);
  await generate.click();
  /// 0722 起主流程带故事板前置：核对规格 → 生成 Image 2 故事板 →（确认后）生成视频。
  /// 主按钮持久在场、文案随阶段推进 —— 这正是「持久主操作」要守的不变量。
  await expect(generate).toHaveText("生成 Image 2 故事板");
  await expect(generate).toBeEnabled();

  await page.getByRole("button", { name: /高级生成/ }).click();
  await expect(page.getByTestId("streamlined-advanced-options")).toBeVisible();
  await expect(page.getByRole("button", { name: "核对生成方案" })).toBeVisible();

  await page.getByRole("button", { name: "知道了，隐藏提示" }).click();
  await expect(page.getByTestId("streamlined-first-use-guide")).toHaveCount(0);
  await expect(generate).toBeVisible();
});

test("RF-038: mobile dropdown menus stay inside the viewport and close from the keyboard", async ({ page }) => {
  /// 线路选择菜单已随 0722 改版下线；「移动端菜单不出视口 + 键盘可关」这个
  /// 不变量改由仍然存在的下拉菜单（语言切换器）来守。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/create");
  await dismissFirstRunOnboarding(page);

  await page.getByRole("button", { name: /切换语言|Switch language/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 391)).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});
