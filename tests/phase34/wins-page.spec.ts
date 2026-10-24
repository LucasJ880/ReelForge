import { expect, test } from "@playwright/test";

/**
 * R5 · 战绩页验收（PRD §4.3）。
 * 一页只回答三件事，落在一面判定台账里；样本不足时只报数（达标 n / 需要 2），不给假排名。
 */

test("战绩页：判定台账齐全，样本不足时只报数不判赢家", async ({ page }) => {
  await page.goto("/app/wins");
  await expect(page).toHaveURL((url) => url.pathname === "/app/wins");

  const root = page.getByTestId("wins-page");
  await expect(root).toBeVisible();

  /// 三个问题 = 台账的三列 + 末行本周计划；不该再拆成三张等宽卡片。
  const ledger = root.getByRole("table", { name: "判定台账" });
  await expect(ledger).toBeVisible();
  for (const column of ["已有样本", "当前领先", "下一步动作"]) {
    await expect(ledger.getByRole("columnheader", { name: column })).toBeVisible();
  }
  await expect(ledger.getByRole("rowheader", { name: "本周计划", exact: true })).toBeVisible();

  /// 演练库里没有表现数据 → 领先结构读数是「0 / 2 种配方」，绝不显示一个假赢家。
  const readings = root.getByLabel("战绩读数");
  await expect(readings).toContainText("0 / 2");
  await expect(readings).toContainText("种配方");
  await expect(root.getByText(/还判不出哪种结构更好/)).toBeVisible();

  /// 六个维度的行都在。
  for (const dim of ["结构", "钩子", "模板", "时长", "画幅", "植入"]) {
    await expect(ledger.getByRole("rowheader", { name: dim, exact: true })).toBeVisible();
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
