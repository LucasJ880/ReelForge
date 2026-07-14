import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { db } from "../../src/lib/db";
import { registerBatch } from "../final-acceptance/framework";
import {
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_TEMPLATE_SLUG,
} from "../final-acceptance/fixture-data";

const WIDTHS = [1280, 1440, 1920] as const;

type RouteTarget = {
  id: string;
  path: string;
  surface: "public" | "customer" | "internal";
};

async function seedDynamicRoutes() {
  const runId = process.env.FINAL_ACCEPTANCE_RUN_ID ?? randomUUID();
  const [user, template] = await Promise.all([
    db.adminUser.findUniqueOrThrow({ where: { email: FINAL_ACCEPTANCE_EMAIL } }),
    db.styleTemplate.findUniqueOrThrow({
      where: {
        slug_version: { slug: FINAL_ACCEPTANCE_TEMPLATE_SLUG, version: 1 },
      },
    }),
  ]);
  const batch = await db.batchJob.create({
    data: {
      userId: user.id,
      templateId: template.id,
      templateVersion: template.version,
      imageIds: [`${runId}-route-image`],
      imageUrls: [`${process.env.FINAL_ACCEPTANCE_BASE_URL}/file.svg`],
      productName: "Phase 3 seeded route batch",
      requestedCount: 1,
      idempotencyKey: `${runId}-route-batch`,
      requestHash: `${runId}-route-hash`,
      quotaConsumedAt: new Date(),
      status: "COMPLETED",
      completedCount: 1,
      finishedAt: new Date(),
      videoJobs: {
        create: {
          batchIndex: 0,
          batchItemKey: `${runId}-route-job`,
          assignedAssets: { assets: [{ id: `${runId}-route-image`, url: `${process.env.FINAL_ACCEPTANCE_BASE_URL}/file.svg` }] },
          templateSnapshot: { id: template.id, version: template.version },
          promptText: "Phase 3 deterministic route fixture",
          provider: "MOCK",
          status: "SUCCEEDED",
          externalJobId: `${runId}-route-provider-job`,
          outputVideoUrl: "/mock-clips/9x16.mp4",
          outputThumbUrl: "/file.svg",
          submittedAt: new Date(),
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      },
    },
  });
  await registerBatch(batch.id);

  const order = await db.deliveryOrder.create({
    data: {
      title: "Phase 3 route matrix order",
      targetCountry: "CA",
      targetLanguage: "en",
      productInput: { product_name: "Route fixture" },
      createdById: user.id,
      rounds: {
        create: {
          roundIndex: 1,
          status: "PLANNED",
          angles: {
            create: {
              sortOrder: 1,
              type: "OPTIMIZATION",
              title: "Route fixture angle",
              videoBrief: {
                create: {
                  status: "RENDER_SUCCEEDED",
                  durationSec: 5,
                  targetDurationSec: 5,
                  finalVideoUrl: "/mock-clips/9x16.mp4",
                  finalThumbnailUrl: "/file.svg",
                  finalVideo: {
                    create: {
                      targetDurationSec: 5,
                      segmentCount: 1,
                      status: "READY",
                      stitchedVideoUrl: "/mock-clips/9x16.mp4",
                      thumbnailUrl: "/file.svg",
                      finishedAt: new Date(),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    include: {
      rounds: { include: { angles: { include: { videoBrief: true } } } },
    },
  });
  const round = order.rounds[0]!;
  const brief = round.angles[0]!.videoBrief!;
  return { batchId: batch.id, orderId: order.id, roundId: round.id, briefId: brief.id, finalVideoId: brief.finalVideoId! };
}

function routeTargets(ids: Awaited<ReturnType<typeof seedDynamicRoutes>>): RouteTarget[] {
  return [
    { id: "root", path: "/", surface: "public" },
    { id: "login", path: "/login", surface: "public" },
    { id: "register", path: "/register", surface: "public" },
    { id: "persona", path: "/persona", surface: "public" },
    { id: "privacy", path: "/privacy", surface: "public" },
    { id: "showcase", path: "/showcase", surface: "public" },
    { id: "terms", path: "/terms", surface: "public" },
    { id: "app", path: "/app", surface: "customer" },
    { id: "create", path: "/app/create", surface: "customer" },
    { id: "create-images", path: "/app/create/images", surface: "customer" },
    { id: "batches", path: "/app/batches", surface: "customer" },
    { id: "batches-new", path: "/app/batches/new", surface: "customer" },
    { id: "batch-detail", path: `/app/batches/${ids.batchId}`, surface: "customer" },
    { id: "library", path: "/app/library", surface: "customer" },
    { id: "library-detail", path: `/app/library/${ids.finalVideoId}`, surface: "customer" },
    { id: "racing", path: "/app/racing", surface: "customer" },
    { id: "templates", path: "/app/templates", surface: "customer" },
    { id: "internal", path: "/internal", surface: "internal" },
    { id: "internal-ai-usage", path: "/internal/ai-usage", surface: "internal" },
    { id: "internal-brief", path: `/internal/briefs/${ids.briefId}`, surface: "internal" },
    { id: "internal-demo-leads", path: "/internal/demo-leads", surface: "internal" },
    { id: "internal-distillation", path: "/internal/distillation", surface: "internal" },
    { id: "internal-metrics", path: "/internal/metrics", surface: "internal" },
    { id: "internal-orders", path: "/internal/orders", surface: "internal" },
    { id: "internal-order", path: `/internal/orders/${ids.orderId}`, surface: "internal" },
    { id: "internal-orders-new", path: "/internal/orders/new", surface: "internal" },
    { id: "internal-publish", path: "/internal/publish", surface: "internal" },
    { id: "internal-qa", path: "/internal/qa", surface: "internal" },
    { id: "internal-reports", path: "/internal/reports", surface: "internal" },
    { id: "internal-rounds", path: "/internal/rounds", surface: "internal" },
    { id: "internal-round", path: `/internal/rounds/${ids.roundId}`, surface: "internal" },
    { id: "internal-settings", path: "/internal/settings", surface: "internal" },
    { id: "internal-videos", path: "/internal/videos", surface: "internal" },
  ];
}

async function auditRoute(page: Page, target: RouteTarget, width: number) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width, height: 1000 });
  const response = await page.goto(target.path, { waitUntil: "domcontentloaded" });
  expect(response, `${target.id} ${width} returns a document`).not.toBeNull();
  expect(response!.status(), `${target.id} ${width} status`).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator('[data-route-state="error"]')).toHaveCount(0);

  const semantics = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 1,
        };
      })
      .filter((item) => item.visible && (item.left < -1 || item.right > viewport + 1))
      .slice(0, 20);
    const unnamedButtons = [...document.querySelectorAll<HTMLElement>("button")]
      .filter((element) => !element.hasAttribute("disabled"))
      .filter((element) => !(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title")))
      .length;
    const invalidLinks = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map((anchor) => anchor.getAttribute("href"))
      .filter((href) => !href || href === "#").length;
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewport,
      overflow,
      unnamedButtons,
      invalidLinks,
    };
  });
  expect(consoleErrors, `${target.id} ${width} console`).toEqual([]);
  expect(pageErrors, `${target.id} ${width} page errors`).toEqual([]);
  expect(serverErrors, `${target.id} ${width} HTTP 5xx`).toEqual([]);
  expect(semantics.documentWidth, `${target.id} ${width} document width`).toBeLessThanOrEqual(semantics.viewport + 1);
  expect(semantics.overflow, `${target.id} ${width} overflow`).toEqual([]);
  expect(semantics.unnamedButtons, `${target.id} ${width} unnamed buttons`).toBe(0);
  expect(semantics.invalidLinks, `${target.id} ${width} invalid links`).toBe(0);
}

test("33-route matrix has real dynamic records and no console, service, semantic, or desktop overflow defects", async ({ page }, testInfo) => {
  const ids = await seedDynamicRoutes();
  const targets = routeTargets(ids);
  expect(targets).toHaveLength(33);
  await mkdir(path.join("qa", "screenshots", "redesign", "phase34-current"), { recursive: true });

  const scanned: Array<{ route: string; width: number }> = [];
  for (const target of targets) {
    for (const width of WIDTHS) {
      await test.step(`${target.id} at ${width}`, async () => {
        await auditRoute(page, target, width);
        scanned.push({ route: target.path, width });
        if (width === 1440) {
          await page.screenshot({
            path: path.join("qa", "screenshots", "redesign", "phase34-current", `${target.id}.png`),
            fullPage: true,
          });
        }
      });
    }
  }
  await testInfo.attach("route-matrix", {
    body: Buffer.from(JSON.stringify({ count: targets.length, scanned }, null, 2)),
    contentType: "application/json",
  });
});
