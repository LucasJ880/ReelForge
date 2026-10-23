import { expect, test as setup } from "@playwright/test";

const authFile = "tests/e2e/.auth/personal.json";

/// 凭据走环境变量：演示账号密码曾随客户端包公开，不再写进仓库。
/// 用专门的测试账号（*@aivora.test，seed-visual-fixture 负责创建），不要用演示账号：
/// 演示账号在任何环境都是只读的，batch-monitor 这类要提交批次的用例会 403。
const email = process.env.E2E_LOGIN_EMAIL ?? "";
const password = process.env.E2E_LOGIN_PASSWORD ?? "";

setup("建立个人用户登录态", async ({ page }) => {
  if (!email || !password) {
    throw new Error("需要 E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD（专用测试账号，如 visual-qa@aivora.test）");
  }
  await page.goto("/login?from=/app/library");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/library/, { timeout: 20_000 });
  await page.context().storageState({ path: authFile });
});
