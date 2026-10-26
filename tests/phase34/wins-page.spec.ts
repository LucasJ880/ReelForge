import { expect, test } from "@playwright/test";

/**
 * R5 · 战绩页验收（PRD §4.3）。
 * 一页只回答三件事，落在一面判定台账里；样本不足时只报数（达标 n / 需要 2），不给假排名。
 *
 * 2026-10-25 审计 B5：表现数据回流（青砚同步）还没开——入口撤出导航（路由保留可直达），
 * 一条表现数据都没有时只写空态，不摆判定台账。
 */

test("战绩页：没有表现数据时如实写空态，读数写零、不判赢家", async ({ page }) => {
  await page.goto("/app/wins");
  await expect(page).toHaveURL((url) => url.pathname === "/app/wins");

  const root = page.getByTestId("wins-page");
  await expect(root).toBeVisible();

  /// 演练库里没有表现数据 → 领先结构读数是「0 / 2」，绝不显示一个假赢家。
  const readings = root.getByLabel("战绩读数");
  await expect(readings).toContainText("0 / 2");

  const empty = root.getByTestId("wins-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("还没有表现数据回流");
  /// 没有数据就不摆「再发几条」的六行判定台账
  await expect(root.getByRole("table", { name: "判定台账" })).toHaveCount(0);
});

test("导航：战绩入口暂时撤下，路由与旧赛马路由仍可直达", async ({ page }) => {
  await page.goto("/app/wins");
  const nav = page.getByRole("navigation", { name: "平台主导航" });
  await expect(nav.getByRole("link", { name: "本周内容" })).toBeVisible();
  /// A 级下线 = 导航移除，不是路由删除。
  await expect(nav.getByRole("link", { name: "战绩" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "投放与赛马" })).toHaveCount(0);
  const res = await page.goto("/app/racing");
  expect(res!.status()).toBeLessThan(400);
});
