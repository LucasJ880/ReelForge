import { expect, test } from "@playwright/test";

async function switchLocale(
  page: import("@playwright/test").Page,
  triggerLabel: string,
  localeLabel: string,
) {
  await page.getByRole("button", { name: triggerLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: localeLabel, exact: true }).click();
}

async function expectLocaleState(
  page: import("@playwright/test").Page,
  locale: "zh-CN" | "en-US",
) {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect.poll(async () => {
    const cookie = (await page.context().cookies()).find(
      (candidate) => candidate.name === "aivora_locale",
    );
    return cookie?.value;
  }).toBe(locale);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("aivora.locale"))).toBe(locale);
}

test("RF-037 customer locale switch persists across the complete Studio journey", async ({ page }) => {
  await page.goto("/app/create");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "从产品图到故事板，再到最终视频" })).toBeVisible();

  await switchLocale(page, "切换语言", "English");
  await expectLocaleState(page, "en-US");
  await expect(page.getByRole("heading", { name: "From product images to storyboard to final video" })).toBeVisible();

  const englishJourney = [
    ["/app/templates", "Template library"],
    ["/app/batches", "Batch production"],
    ["/app/racing", "Campaign racing"],
    ["/app/library", "Video library"],
  ] as const;
  for (const [href, heading] of englishJourney) {
    await page.goto(href);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }

  await switchLocale(page, "Switch language", "中文");
  await expectLocaleState(page, "zh-CN");
  /// 真机实测切回中文 1s 内翻转；演练（prod build + 冷 RSC 缓存）首次刷新更慢，放宽到 30s 判别「慢 vs 坏」。
  await expect(page.getByRole("heading", { name: "成品库", exact: true })).toBeVisible({ timeout: 30_000 });
});

test("RF-037 unauthenticated locale switch persists from login to registration", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await expect(page.getByText("欢迎回到工作室", { exact: true })).toBeVisible();
    await switchLocale(page, "切换语言", "English");
    await expectLocaleState(page, "en-US");
    await expect(page.getByText("Welcome back to the studio", { exact: true })).toBeVisible();

    await page.goto("/register");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByText("Create your Aivora account", { exact: true })).toBeVisible();

    for (const [href, heading] of [
      ["/privacy", "Privacy Policy"],
      ["/terms", "Terms of Service"],
      ["/persona", "Start with one video. Scale into controlled batch production."],
    ] as const) {
      await page.goto(href);
      await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    await switchLocale(page, "Switch language", "中文");
    await expectLocaleState(page, "zh-CN");
    await expect(page.getByRole("heading", { name: "从一支视频开始，扩展到可控的批量生产。" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("RF-037 mobile Studio exposes the same persistent locale control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/create");
  const switcher = page.locator('button[aria-label="切换语言"]:visible');
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByRole("menuitem", { name: "English", exact: true }).click();
  await expectLocaleState(page, "en-US");
  await expect(page.getByRole("heading", { name: "From product images to storyboard to final video" })).toBeVisible();
});
