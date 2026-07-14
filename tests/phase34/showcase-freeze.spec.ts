import { expect, test } from "@playwright/test";

test("D-0 keeps the frozen Showcase pixel-identical at 1440x1000", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/showcase", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL((url) => url.pathname === "/showcase");
    await expect(page.locator("main").last()).toBeVisible();
    await page.waitForFunction(() =>
      [...document.images]
        .filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight;
        })
        .every((image) => image.complete),
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const media of document.querySelectorAll<HTMLMediaElement>("video, audio")) {
        media.pause();
        try { media.currentTime = 0; } catch { /* metadata may not be available */ }
      }
    });
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
        video, canvas { visibility: hidden !important; }
      `,
    });
    await expect(page).toHaveScreenshot("showcase-frozen-1440x1000.png", {
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      threshold: 0,
      maxDiffPixels: 0,
    });
  } finally {
    await context.close();
  }
});
