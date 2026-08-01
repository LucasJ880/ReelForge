import { expect, test } from "@playwright/test";

/**
 * R5 · 战绩页验收（PRD §4.3）。
 * 一页只回答三件事；样本不足时必须直说「还判不了」，不给假排名。
 */

test("战绩页：三问三答齐全，样本不足时直说判不了", async ({ page }) => {
  await page.goto("/app/wins");
  await expect(page).toHaveURL((url) => url.pathname === "/app/wins");

  const root = page.getByTestId("wins-page");
  await expect(root).toBeVisible();

  /// 三个问题一个不能少，也不该多出第四块看板。
  await expect(root.getByText("01 · 哪个结构在赢")).toBeVisible();
  await expect(root.getByText("02 · 下一步试什么")).toBeVisible();
  await expect(root.getByText("03 · 我帮你排了什么")).toBeVisible();

  /// 演练库里没有表现数据 → 必须显示「还判不了」，绝不显示一个假赢家。
  await expect(root.getByRole("heading", { name: "还判不了" })).toBeVisible();

  /// 六个维度的表都在。
  for (const dim of ["结构", "钩子", "模板", "时长", "画幅", "植入"]) {
    await expect(root.getByRole("cell", { name: dim, exact: true })).toBeVisible();
  }
});

test("导航：战绩替换旧赛马入口，旧路由仍可直达", async ({ page }) => {
  await page.goto("/app/wins");
  const nav = page.getByRole("navigation", { name: "平台主导航" });
  await expect(nav.getByRole("link", { name: "战绩" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "本周内容" })).toBeVisible();
  /// A 级下线 = 导航移除，不是路由删除。
  await expect(nav.getByRole("link", { name: "投放与赛马" })).toHaveCount(0);
  const res = await page.goto("/app/racing");
  expect(res!.status()).toBeLessThan(400);
});
