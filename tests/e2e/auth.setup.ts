import { expect, test as setup } from "@playwright/test";

const authFile = "tests/e2e/.auth/personal.json";

setup("建立个人用户登录态", async ({ page }) => {
  await page.goto("/login?from=/personal/videos");
  await page.getByPlaceholder("账号（邮箱）").fill("demo@aivora.app");
  await page.getByPlaceholder("密码").fill("aivora2026");
  await page.getByRole("button", { name: "登 录" }).click();
  await expect(page).toHaveURL(/\/personal\/videos/, { timeout: 20_000 });
  await page.context().storageState({ path: authFile });
});
