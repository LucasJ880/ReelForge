import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  EDITORIAL_ROUTES,
  ensureAuthenticated,
  resolveRoute,
  stabilizePage,
} from "./editorial-fixtures";

function seconds(value: string): number {
  if (value.endsWith("ms")) return Number.parseFloat(value) / 1000;
  return Number.parseFloat(value) || 0;
}

for (const route of EDITORIAL_ROUTES) {
  test(`${route.key} axe、键盘、缩放与 reduced-motion`, async (
    { page },
    testInfo,
  ) => {
    if (route.key !== "login") await ensureAuthenticated(page);
    const path = await resolveRoute(route, page, testInfo.project.name);
    if (route.key === "login") await page.context().clearCookies();
    await page.goto(path);
    await stabilizePage(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    );
    await testInfo.attach(`${route.key}-axe`, {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
    expect(blocking, "axe critical/serious 必须为 0").toEqual([]);

    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focus, "页面必须有可键盘聚焦元素").not.toBeNull();
    expect(focus?.outlineStyle).not.toBe("none");
    expect(focus?.outlineWidth).not.toBe("0px");

    if (testInfo.project.name === "desktop") {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      const reflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(reflow.document, "200% 缩放不得横向溢出").toBeLessThanOrEqual(
        reflow.viewport + 1,
      );
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    const maxMotionSeconds = await page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll<HTMLElement>("body *")].flatMap((element) => {
          const style = getComputedStyle(element);
          return [...style.transitionDuration.split(","), ...style.animationDuration.split(",")]
            .map((value) => value.trim())
            .map((value) =>
              value.endsWith("ms")
                ? Number.parseFloat(value) / 1000
                : Number.parseFloat(value) || 0,
            );
        }),
      ),
    );
    expect(maxMotionSeconds).toBeLessThanOrEqual(seconds("10ms"));
  });
}
