import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";

const authFile = "tests/phase34/.auth/customer.json";

setup("建立 Phase 3/4 客户验收登录态", async ({ page }) => {
  await mkdir(path.dirname(authFile), { recursive: true });
  await page.goto("/login?from=/app/create");
  await page.getByLabel("邮箱").fill("final-acceptance@aivora.app");
  await page.getByLabel("密码").fill("aivora-final-acceptance-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find(
          (cookie) => cookie.name === "next-auth.session-token",
        )?.value,
    )
    .toBeTruthy();
  const localSessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "next-auth.session-token",
  )!;
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
  await page.goto("/app/create");
  await expect(page).toHaveURL((url) => url.pathname === "/app/create");
  await page.context().storageState({ path: authFile });
});
