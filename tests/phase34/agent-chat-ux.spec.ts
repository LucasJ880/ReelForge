import { expect, test } from "@playwright/test";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

const ROUTE_OPTIONS = {
  ok: true,
  defaultRouteId: "volcengine_cn_legacy",
  routes: [
    {
      id: "volcengine_cn_legacy",
      provider: "direct",
      displayName: "火山北京 Seedance 直连",
      model: "doubao-seedance-2-0-260128",
      resolution: null,
      configured: true,
      funded: null,
      available: true,
      unavailableReason: null,
    },
    {
      id: "buddy",
      provider: "shuyu",
      displayName: "合作方 Shuyu · Seedance 720P",
      model: "studio-video",
      resolution: "720P",
      configured: true,
      funded: false,
      available: false,
      unavailableReason: "insufficient_balance",
    },
  ],
};

test("RF-038: creation follows one upload-to-generate flow with a persistent final action", async ({ page }) => {
  await page.route("**/api/video-generation/routes?duration=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ROUTE_OPTIONS),
    });
  });
  await page.route("**/api/upload/blob", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "https://example.com/product.png" }),
    });
  });
  await page.route("**/api/video-generation/classify-asset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        classification: {
          inferredRole: "product_image",
          roleConfidence: 1,
          suggestedUse: "Product identity reference",
          warnings: [],
        },
      }),
    });
  });

  await page.goto("/app/create");

  await expect(page.getByTestId("streamlined-first-use-guide")).toBeVisible();
  await expect(page.getByTestId("streamlined-product-assets")).toBeVisible();
  await expect(page.getByTestId("streamlined-generation-mode")).toBeVisible();
  await expect(page.getByTestId("streamlined-video-specs")).toBeVisible();
  await expect(page.getByTestId("streamlined-video-prompt")).toBeVisible();

  const generate = page.locator("#platform-primary-generate");
  await expect(generate).toBeVisible();
  await expect(generate).toBeDisabled();

  await page.getByRole("button", { name: /视频生成接口: 火山官方接口/ }).click();
  const shuyuRoute = page.getByRole("menuitemradio", { name: /Shuyu 合作接口/ });
  await expect(shuyuRoute).toContainText("900 积分/支");
  await expect(
    page.getByRole("menuitem", { name: /480P 推荐线路 1 \/ 2/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await shuyuRoute.click();
  await expect(generate).toBeDisabled();
  await page.getByRole("button", { name: /视频生成接口: Shuyu 合作接口/ }).click();
  await page.getByRole("menuitemradio", { name: /火山官方接口/ }).click();

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
  await generate.click();
  await expect(generate).toHaveText("生成视频");

  await page.getByRole("button", { name: /高级生成/ }).click();
  await expect(page.getByTestId("streamlined-advanced-options")).toBeVisible();
  await expect(page.getByRole("button", { name: "核对生成方案" })).toBeVisible();

  await page.getByRole("button", { name: "知道了，隐藏提示" }).click();
  await expect(page.getByTestId("streamlined-first-use-guide")).toHaveCount(0);
  await expect(generate).toBeVisible();
});

test("RF-038: mobile provider menu stays inside the viewport and closes from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/video-generation/routes?duration=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ROUTE_OPTIONS),
    });
  });
  await page.goto("/app/create");

  await page.getByRole("button", { name: /视频生成接口: 火山官方接口/ }).click();
  const menu = page.getByRole("menu", { name: /视频生成接口: 火山官方接口/ });
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 391)).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});
