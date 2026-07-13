import { expect, test as setup } from "@playwright/test";

const authFile = "tests/e2e/.auth/personal.json";

setup("建立个人用户登录态", async ({ page }) => {
  await page.goto("/login?from=/app/library");
  await page.getByLabel("邮箱").fill("demo@aivora.app");
  await page.getByLabel("密码").fill("aivora2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/library/, { timeout: 20_000 });
  await page.context().storageState({ path: authFile });
});
