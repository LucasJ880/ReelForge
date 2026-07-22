import { db } from "../../src/lib/db";
import {
  browserFetch,
  dispatchCurrentSingleVideo,
  expect,
  test,
} from "./framework";

test("P6：新用户从注册到首条成片少于 10 分钟", async ({ page }, testInfo) => {
  const startedAt = performance.now();
  const suffix = `${process.env.FINAL_ACCEPTANCE_RUN_ID ?? Date.now()}-${testInfo.project.name}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(-60);
  const email = `onboarding-${suffix}@aivora.invalid`;
  const password = "Aivora-onboarding-2026";

  await page.context().clearCookies();
  await page.goto("/register");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("昵称（可选）").fill("First Video QA");
  await page.getByLabel("密码（至少 8 位）").fill(password);
  const registration = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/auth/register"),
  );
  await page.getByRole("button", { name: "创建账号" }).click();
  expect((await registration).status()).toBe(200);

  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find(
          (cookie) => cookie.name === "next-auth.session-token",
        )?.value,
      { timeout: 20_000 },
    )
    .toBeTruthy();
  const cookies = await page.context().cookies();
  const localSession = cookies.find(
    (cookie) => cookie.name === "next-auth.session-token",
  );
  if (
    localSession &&
    !cookies.some((cookie) => cookie.name === "__Secure-next-auth.session-token")
  ) {
    await page.context().addCookies([
      {
        name: "__Secure-next-auth.session-token",
        value: localSession.value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  }

  await page.goto("/app/create");
  await expect(page).toHaveURL((url) => url.pathname === "/app/create");
  const payload = await dispatchCurrentSingleVideo(
    page,
    "为一款便携保温杯制作 15 秒真实自然光产品演示，主体稳定，不添加参考图之外的功能。",
  );

  let renderStatus:
    | {
        totalJobs: number;
        succeeded: number;
        running: number;
        queued: number;
        failed: number;
        finalVideoUrl: string | null;
      }
    | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await browserFetch<NonNullable<typeof renderStatus>>(
      page,
      `/api/briefs/${payload.briefId}/render-status`,
      { method: "POST" },
    );
    expect(result.status, result.text).toBe(200);
    renderStatus = result.body;
    if (renderStatus.running + renderStatus.queued === 0) break;
    await page.waitForTimeout(100);
  }
  expect(renderStatus?.failed).toBe(0);
  expect(renderStatus?.succeeded).toBe(renderStatus?.totalJobs);

  const stitchResponse = await page.request.post("/api/cron/stitch-videos", {
    headers: process.env.CRON_SECRET
      ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
      : undefined,
  });
  expect(stitchResponse.status(), await stitchResponse.text()).toBe(200);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await browserFetch<NonNullable<typeof renderStatus>>(
      page,
      `/api/briefs/${payload.briefId}/render-status`,
    );
    expect(result.status, result.text).toBe(200);
    renderStatus = result.body;
    if (renderStatus.finalVideoUrl) break;
    await page.waitForTimeout(100);
  }

  const account = await db.adminUser.findUnique({
    where: { email },
    include: { workspace: true },
  });
  expect(account?.role).toBe("CUSTOMER");
  expect(account?.workspace?.planId).toBe("starter");
  expect(renderStatus?.finalVideoUrl).toBeTruthy();
  expect(performance.now() - startedAt).toBeLessThan(10 * 60_000);

  await testInfo.attach("first-video-time", {
    body: Buffer.from(
      JSON.stringify(
        {
          elapsedMs: Math.round(performance.now() - startedAt),
          project: testInfo.project.name,
          plan: account?.workspace?.planId,
          totalJobs: renderStatus?.totalJobs,
          succeeded: renderStatus?.succeeded,
          finalVideoReady: Boolean(renderStatus?.finalVideoUrl),
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});
