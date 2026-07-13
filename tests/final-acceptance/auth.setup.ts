import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";

const authFile = "tests/final-acceptance/.auth/personal.json";

setup("建立最终验收独立登录态", async ({ page }) => {
  await mkdir(path.dirname(authFile), { recursive: true });
  await page.goto("/login?from=/app/batches/new");
  await page.getByLabel("邮箱").fill("final-acceptance@aivora.app");
  await page.getByLabel("密码").fill("aivora-final-acceptance-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find(
          (cookie) => cookie.name === "next-auth.session-token",
        )?.value,
      { timeout: 20_000 },
    )
    .toBeTruthy();
  const localSessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "next-auth.session-token",
  )!;
  // next-auth v4 在 production build 中按 HTTPS 生产配置读取
  // __Secure 名称；localhost 的 HTTP 登录端点只能写入非 Secure 名称。
  // 两者值相同，仅桥接本地 next start 验收，真实 HTTPS 不需要此步骤。
  await page.context().addCookies([
    {
      name: "__Secure-next-auth.session-token",
      value: localSessionCookie.value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/app/batches/new");
  await expect(page).toHaveURL((url) => url.pathname === "/app/batches/new");
  const protectedResponse = await page.request.get("/api/batch-style-templates");
  expect(protectedResponse.status(), "生产模式登录态必须可访问受保护 API").toBe(200);
  await page.context().storageState({ path: authFile });
});
