import {
  createBatch,
  expect,
  runKey,
  test,
} from "./framework";

test("生产路由 smoke：统一创作、批量、成品与模板页面均可达", async ({
  page,
}, testInfo) => {
  await page.goto("/app/batches/new");
  const batch = await createBatch(page, {
    imageCount: 1,
    requestedCount: 2,
    key: runKey(testInfo, "smoke"),
  });

  const routes = [
    "/app/create",
    "/app/batches/new",
    `/app/batches/${batch.id}`,
    "/app/library",
    "/app/templates",
    "/app/racing",
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
