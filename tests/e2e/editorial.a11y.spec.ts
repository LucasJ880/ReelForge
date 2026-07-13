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

    const focusable = page.locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const focusCount = await focusable.count();
    expect(focusCount, "页面必须有可键盘聚焦元素").toBeGreaterThan(0);

    const tabChecks = Math.min(focusCount, 8);
    for (let index = 0; index < tabChecks; index += 1) {
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
      expect(focus, `第 ${index + 1} 次 Tab 必须聚焦可见元素`).not.toBeNull();
      expect(focus?.outlineStyle).not.toBe("none");
      expect(focus?.outlineWidth).not.toBe("0px");
    }

    const cjkItalic = await page.evaluate(() =>
      [...document.querySelectorAll("em, i, .italic")].some((element) =>
        /[\u3400-\u9fff\uf900-\ufaff]/.test(element.textContent ?? ""),
      ),
    );
    expect(cjkItalic, "中文不得使用斜体").toBe(false);

    if (testInfo.project.name === "desktop") {
      const container = page.locator(".editorial-page").first();
      if ((await container.count()) > 0) {
        const width = await container.evaluate((element) => element.clientWidth);
        expect(width).toBeLessThanOrEqual(1200);
      }

      await page.setViewportSize({ width: 720, height: 1000 });
      await page.waitForTimeout(50);
      const reflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll<HTMLElement>("body *")]
          .filter(
            (element) =>
              element.getBoundingClientRect().right >
              document.documentElement.clientWidth + 1,
          )
          .slice(0, 8)
          .map((element) => ({
            tag: element.tagName,
            className: element.className.toString().slice(0, 160),
            right: Math.round(element.getBoundingClientRect().right),
          })),
      }));
      expect(
        reflow.document,
        `200% 缩放不得横向溢出：${JSON.stringify(reflow.offenders)}`,
      ).toBeLessThanOrEqual(reflow.viewport + 1);
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
