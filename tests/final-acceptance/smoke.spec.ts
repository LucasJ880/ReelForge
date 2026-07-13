import {
  createBatch,
  expect,
  runKey,
  test,
} from "./framework";

test("生产路由 smoke：公开、个人、创建与监控页面均可达", async ({
  page,
}, testInfo) => {
  await page.goto("/batch-create");
  const batch = await createBatch(page, {
    imageCount: 1,
    requestedCount: 2,
    key: runKey(testInfo, "smoke"),
  });

  const routes = [
    "/design",
    "/batch-create",
    `/batches/${batch.id}`,
    "/personal/videos",
    "/personal/templates",
  ];
  const evidence: Array<{ route: string; status: number | null; title: string }> = [];
  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    evidence.push({
      route,
      status: response?.status() ?? null,
      title: await page.title(),
    });
    expect(response, `${route} 必须返回文档响应`).not.toBeNull();
    expect(response!.status(), `${route} 不得返回错误页面`).toBeLessThan(400);
    await expect(page.locator("body")).toBeVisible();
  }
  await testInfo.attach("route-smoke-evidence", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
});
