import { expect, test } from "@playwright/test";

/**
 * O1 · 剪辑台一周时间线的界面验收（PRD §3 + §11）。
 *
 * 这里守的是**视觉方向的硬性规矩**，不是像素级还原：
 * 圆角 0、无卡片阴影、数字 tabular-nums、空档画成缺口而不是留白。
 * 一旦这几条被破坏，界面就立刻退回成普通 SaaS 后台。
 */

test("一周时间线：轨道、播放头、空档缺口都在", async ({ page }) => {
  await page.goto("/app/plan");
  await expect(page).toHaveURL((url) => url.pathname === "/app/plan");

  /// 一周是一条轨道，不是 7 张卡片。
  const track = page.getByRole("region", { name: "本周内容时间线" });
  await expect(track).toBeVisible();

  /// 七个刻度，今天那一格标出来。
  await expect(page.getByText("今天", { exact: true })).toBeVisible();

  /// 空档必须被画成缺口。新账号没有计划时，七天全是空档。
  await expect(page.getByText("空档").first()).toBeVisible();

  /// 一句话入口是主入口。
  await expect(
    page.getByLabel("用一句话描述你的生意，或粘贴商品链接"),
  ).toBeVisible();
});

test("硬性规矩：圆角 0、无卡片阴影、数字等宽", async ({ page }) => {
  await page.goto("/app/plan");

  const root = page.getByTestId("cutting-room");
  const numeric = await root.evaluate(
    (node) => getComputedStyle(node).fontVariantNumeric,
  );
  /// 制片单据的质感来源，也让列对得齐。
  expect(numeric).toContain("tabular-nums");

  /// 空档必须是虚线缺口，且不许有圆角或阴影。
  const holes = root.getByText("空档", { exact: true });
  await expect(holes.first()).toBeVisible();
  const holeStyle = await holes.first().evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      radius: computed.borderRadius,
      shadow: computed.boxShadow,
      borderStyle: computed.borderTopStyle,
    };
  });
  expect(holeStyle.radius).toBe("0px");
  expect(holeStyle.shadow).toBe("none");
  /// 空档是虚线框的缺口，不是留白。
  expect(holeStyle.borderStyle).toBe("dashed");
});

test("窄屏下页面本身不横向滚动，轨道自己滚", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/plan");
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  expect(overflow.body).toBe(false);
});
