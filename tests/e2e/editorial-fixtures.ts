import type { Page, TestInfo } from "@playwright/test";

export interface EditorialRoute {
  key:
    | "design"
    | "agent"
    | "create-video"
    | "batch-create"
    | "batch-monitor"
    | "videos"
    | "templates"
    | "login";
  path: string;
}

export const EDITORIAL_ROUTES: EditorialRoute[] = [
  { key: "design", path: "/app/create" },
  { key: "agent", path: "/app/create" },
  { key: "create-video", path: "/app/create" },
  { key: "batch-create", path: "/app/batches/new" },
  { key: "batch-monitor", path: "/app/batches/__fixture__" },
  { key: "videos", path: "/app/library" },
  { key: "templates", path: "/app/templates" },
  { key: "login", path: "/login" },
];

export async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto("/app/library");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByRole("button", { name: /使用演示账号体验/ }).click();
    await page.waitForURL(/\/app\/library/, { timeout: 20_000 });
  }
}

export async function createBatchFixture(
  page: Page,
  projectName: string,
): Promise<string> {
  await ensureAuthenticated(page);
  const templatesResult = await page.evaluate(async () => {
    const response = await fetch("/api/batch-style-templates");
    return { status: response.status, body: await response.json() };
  });
  if (templatesResult.status !== 200) {
    throw new Error(`模板 fixture 获取失败：${templatesResult.status}`);
  }
  const { templates } = templatesResult.body as {
    templates: Array<{ id: string; version: number }>;
  };
  const template = templates[0];
  if (!template) throw new Error("模板 fixture 为空");

  const idempotencyKey = `editorial-${projectName}-stable-v1`;
  const result = await page.evaluate(
    async ({ template, idempotencyKey }) => {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          templateId: template.id,
          templateVersion: template.version,
          images: Array.from({ length: 4 }, (_, index) => ({
            id: `fixture-image-${index + 1}`,
            url: `https://example.com/editorial-fixture-${index + 1}.jpg`,
          })),
          requestedCount: 8,
          productName: "Editorial Studio 测试产品",
        }),
      });
      return { status: response.status, body: await response.text() };
    },
    { template, idempotencyKey },
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`批次 fixture 创建失败：${result.status} ${result.body}`);
  }
  const payload = JSON.parse(result.body) as { batch: { id: string } };
  await page.evaluate(async (batchId) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`/api/batches/${batchId}/status`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        batch?: { status?: string };
      };
      if (
        payload.batch?.status &&
        ["COMPLETED", "PARTIAL_FAILED", "FAILED", "CANCELLED"].includes(
          payload.batch.status,
        )
      ) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }, payload.batch.id);
  return payload.batch.id;
}

export async function resolveRoute(
  route: EditorialRoute,
  page: Page,
  projectName: string,
): Promise<string> {
  if (route.key !== "batch-monitor") return route.path;
  return `/app/batches/${await createBatchFixture(page, projectName)}`;
}

export async function stabilizePage(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach((video) => video.pause());
  });
}

export async function attachDomAudit(
  page: Page,
  testInfo: TestInfo,
  routeKey: string,
): Promise<void> {
  const audit = await page.evaluate(() => {
    const overflow = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .slice(0, 30)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        testId: element.dataset.testid ?? null,
        className: element.className.toString().slice(0, 180),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    const landmarks = [...document.querySelectorAll("main, nav, aside, header, footer")].map(
      (element) => ({
        tag: element.tagName.toLowerCase(),
        label: element.getAttribute("aria-label"),
      }),
    );
    return {
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      overflow,
      landmarks,
      interactiveCount: document.querySelectorAll(
        "a, button, input, select, textarea, [tabindex]",
      ).length,
    };
  });

  await testInfo.attach(`${routeKey}-dom-audit`, {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
}
