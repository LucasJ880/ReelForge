import { expect, test } from "@playwright/test";
import {
  attachDomAudit,
  EDITORIAL_ROUTES,
  ensureAuthenticated,
  resolveRoute,
  stabilizePage,
} from "./editorial-fixtures";

for (const route of EDITORIAL_ROUTES) {
  test(`${route.key} 双视口视觉基线`, async ({ page }, testInfo) => {
    if (route.key !== "login") await ensureAuthenticated(page);
    const path = await resolveRoute(route, page, testInfo.project.name);
    if (route.key === "login") await page.context().clearCookies();

    await page.goto(path);
    await stabilizePage(page);

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect.soft(dimensions.document, "页面不得横向溢出").toBeLessThanOrEqual(
      dimensions.viewport + 1,
    );
    await attachDomAudit(page, testInfo, route.key);

    await expect(page).toHaveScreenshot([
      route.key,
      `${testInfo.project.name}.png`,
    ], {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.005,
    });
  });
}
