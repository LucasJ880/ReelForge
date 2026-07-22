import { readFile, writeFile } from "node:fs/promises";
import {
  expect,
  test as base,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";
import { db } from "../../src/lib/db";
import {
  FINAL_ACCEPTANCE_ASSET_COUNT,
  FINAL_ACCEPTANCE_ASSET_PREFIX,
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_TEMPLATE_NAME,
  RUN_STATE_PATH,
} from "./fixture-data";

export {
  FINAL_ACCEPTANCE_EMAIL,
  FINAL_ACCEPTANCE_PASSWORD,
  FINAL_ACCEPTANCE_TEMPLATE_NAME,
  FINAL_ACCEPTANCE_TEMPLATE_SLUG,
} from "./fixture-data";
export const TERMINAL_BATCH_STATUSES = new Set([
  "COMPLETED",
  "PARTIAL_FAILED",
  "FAILED",
  "CANCELLED",
]);

const ALLOWED_RESOURCE_CANCELLATIONS = [
  {
    label: "导航切换导致的媒体取消",
    url: /\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm)(?:\?|$)/i,
    error: /ERR_ABORTED|cancelled|canceled/i,
  },
  {
    label: "浏览器可选 favicon 取消",
    url: /\/favicon\.ico(?:\?|$)/i,
    error: /ERR_ABORTED|cancelled|canceled/i,
  },
  {
    label: "客户端导航替换旧 RSC 请求",
    url: /[?&]_rsc=/i,
    error: /ERR_ABORTED|cancelled|canceled/i,
  },
  {
    label: "注册完成后的受保护页验收导航替换登录回跳",
    url: /\/login\?from=%2Fapp%2Fcreate(?:&|$)/i,
    error: /ERR_ABORTED|cancelled|canceled/i,
  },
  {
    label: "用户主动取消单图上传",
    url: /\/api\/upload\/blob(?:\?|$)/i,
    error: /ERR_ABORTED|cancelled|canceled/i,
  },
  {
    label: "步骤切换取消未完成的模板封面",
    url: /^https:\/\/images\.unsplash\.com\//i,
    error: /ERR_ABORTED|cancelled|canceled/i,
  },
  {
    label: "离开批量创建页时取消未完成的模板列表请求",
    url: /\/api\/batch-style-templates(?:\?|$)/i,
    error: /ERR_ABORTED|cancelled|canceled/i,
  },
] as const;

export interface BatchJob {
  id: string;
  batchIndex: number | null;
  status: "QUEUED" | "PAUSED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  assignedAssets: {
    assets?: Array<{ id: string; url: string }>;
    seed?: number;
    dedupeKey?: string;
  } | null;
  outputVideoUrl: string | null;
  outputThumbUrl: string | null;
  lastProgress: number | null;
  userSafeError: string | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    action: string;
  } | null;
  retryCount: number;
}

export interface Batch {
  id: string;
  status:
    | "EXPANDING"
    | "RUNNING"
    | "PAUSED"
    | "COMPLETED"
    | "PARTIAL_FAILED"
    | "FAILED"
    | "CANCELLED";
  requestedCount: number;
  queuedCount: number;
  pausedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  statusReason: string | null;
  template: { id: string; version: number; nameZh: string };
  videoJobs: BatchJob[];
}

interface EvidenceEntry {
  ts: string;
  kind: string;
  [key: string]: unknown;
}

interface Finding {
  kind: "console-error" | "page-error" | "http-5xx" | "request-failed";
  message: string;
  url?: string;
}

export interface EvidenceCollector {
  console: EvidenceEntry[];
  network: EvidenceEntry[];
  findings: Finding[];
  requestStartedAt: WeakMap<Request, number>;
}

async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: "application/json",
  });
}

function instrumentEvidencePage(
  page: Page,
  evidence: EvidenceCollector,
): void {
  page.on("console", (message) => {
    const entry = {
      ts: new Date().toISOString(),
      kind: "console",
      level: message.type(),
      text: message.text(),
      location: message.location(),
      pageUrl: page.url(),
    };
    evidence.console.push(entry);
    if (message.type() === "error") {
      evidence.findings.push({
        kind: "console-error",
        message: message.text(),
        url: message.location().url || page.url(),
      });
    }
  });
  page.on("pageerror", (error) => {
    evidence.console.push({
      ts: new Date().toISOString(),
      kind: "pageerror",
      message: error.message,
      stack: error.stack,
      pageUrl: page.url(),
    });
    evidence.findings.push({
      kind: "page-error",
      message: error.message,
      url: page.url(),
    });
  });
  page.on("request", (request) => {
    evidence.requestStartedAt.set(request, performance.now());
  });
  page.on("response", (response) => {
    const request = response.request();
    evidence.network.push({
      ts: new Date().toISOString(),
      kind: "response",
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      url: response.url(),
      pageUrl: page.url(),
      durationMs: Math.round(
        performance.now() -
          (evidence.requestStartedAt.get(request) ?? performance.now()),
      ),
    });
    if (response.status() >= 500) {
      evidence.findings.push({
        kind: "http-5xx",
        message: `HTTP ${response.status()} ${request.method()}`,
        url: response.url(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown request failure";
    const allowed = ALLOWED_RESOURCE_CANCELLATIONS.some(
      (rule) => rule.url.test(request.url()) && rule.error.test(errorText),
    );
    evidence.network.push({
      ts: new Date().toISOString(),
      kind: "requestfailed",
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      pageUrl: page.url(),
      errorText,
      allowed,
    });
    if (!allowed) {
      evidence.findings.push({
        kind: "request-failed",
        message: errorText,
        url: request.url(),
      });
    }
  });
}

export const test = base.extend<{
  acceptanceIsolation: void;
  evidence: EvidenceCollector;
  evidenceAuto: void;
}>({
  acceptanceIsolation: [
    async ({}, provide) => {
      const runId = process.env.FINAL_ACCEPTANCE_RUN_ID;
      if (!runId) {
        throw new Error("Final Acceptance 缺少 FINAL_ACCEPTANCE_RUN_ID");
      }

      const account = await db.adminUser.findUnique({
        where: { email: FINAL_ACCEPTANCE_EMAIL },
        select: { id: true },
      });
      if (!account) {
        throw new Error("Final Acceptance 验收账号尚未种子化");
      }

      await db.$transaction(async (tx) => {
        await tx.batchJob.deleteMany({
          where: {
            idempotencyKey: { startsWith: runId },
            userId: account.id,
          },
        });
        await tx.userUsagePeriod.deleteMany({
          where: { userId: account.id },
        });
      });

      const remainingUsage = await db.userUsagePeriod.count({
        where: { userId: account.id },
      });
      if (remainingUsage !== 0) {
        throw new Error(
          `Final Acceptance 用量隔离失败：仍有 ${remainingUsage} 条聚合记录`,
        );
      }

      await provide();
    },
    { auto: true },
  ],
  evidence: async ({ page, context }, provide) => {
    const evidence: EvidenceCollector = {
      console: [],
      network: [],
      findings: [],
      requestStartedAt: new WeakMap(),
    };

    await context.addInitScript(() => {
      const state = { lcp: 0, longTasks: [] as number[] };
      Object.defineProperty(window, "__finalAcceptancePerf", {
        value: state,
        configurable: true,
      });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    });

    instrumentEvidencePage(page, evidence);
    context.on("page", (openedPage) => {
      if (openedPage !== page) instrumentEvidencePage(openedPage, evidence);
    });

    await provide(evidence);
  },
  evidenceAuto: [
    async ({ page, evidence }, provide, testInfo) => {
      await provide();
      const performanceEvidence = await page
        .evaluate(() => {
          const perf = (
            window as Window & {
              __finalAcceptancePerf?: { lcp: number; longTasks: number[] };
            }
          ).__finalAcceptancePerf;
          return {
            url: location.href,
            navigation: performance
              .getEntriesByType("navigation")
              .map((entry) => entry.toJSON()),
            paint: performance.getEntriesByType("paint").map((entry) => entry.toJSON()),
            resources: performance
              .getEntriesByType("resource")
              .map((entry) => entry.toJSON()),
            lcpMs: perf?.lcp ?? null,
            longTasksMs: perf?.longTasks ?? [],
          };
        })
        .catch((error) => ({ collectionError: (error as Error).message }));

      await Promise.all([
        attachJson(testInfo, "console-evidence", evidence.console),
        attachJson(testInfo, "network-evidence", evidence.network),
        attachJson(testInfo, "performance-evidence", performanceEvidence),
        attachJson(testInfo, "findings", evidence.findings),
      ]);
      expect(
        evidence.findings,
        `发现默认阻断项：${JSON.stringify(evidence.findings, null, 2)}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function browserFetch<T>(
  page: Page,
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: T; text: string }> {
  return page.evaluate(
    async ({ requestUrl, requestInit }) => {
      const response = await fetch(requestUrl, {
        method: requestInit.method,
        headers: requestInit.headers,
        body:
          requestInit.body === undefined
            ? undefined
            : JSON.stringify(requestInit.body),
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: response.status, body, text };
    },
    { requestUrl: url, requestInit: init },
  ) as Promise<{ status: number; body: T; text: string }>;
}

export async function getAcceptanceTemplate(page: Page): Promise<{
  id: string;
  version: number;
}> {
  const result = await browserFetch<{
    templates?: Array<{ id: string; version: number; nameZh: string }>;
    error?: string;
  }>(page, "/api/batch-style-templates");
  expect(result.status, result.text).toBe(200);
  const template = result.body.templates?.find(
    (candidate) => candidate.nameZh === FINAL_ACCEPTANCE_TEMPLATE_NAME,
  );
  expect(template, "seed 必须提供最终验收单图模板").toBeDefined();
  return template!;
}

export function acceptanceAssetIds(count: number) {
  if (count > FINAL_ACCEPTANCE_ASSET_COUNT) {
    throw new Error(`Final acceptance only seeds ${FINAL_ACCEPTANCE_ASSET_COUNT} assets`);
  }
  return Array.from(
    { length: count },
    (_, index) => `${FINAL_ACCEPTANCE_ASSET_PREFIX}-${index + 1}`,
  );
}

export async function registerBatch(batchId: string): Promise<void> {
  const state = JSON.parse(await readFile(RUN_STATE_PATH, "utf8")) as {
    runId: string;
    batchIds: string[];
    seededAt: string;
  };
  if (!state.batchIds.includes(batchId)) state.batchIds.push(batchId);
  await writeFile(RUN_STATE_PATH, JSON.stringify(state, null, 2));
}

export async function dispatchCurrentSingleVideo(
  page: Page,
  prompt: string,
): Promise<{ briefId: string; nextUrl: string }> {
  /// 首次使用弹窗随 hydration 异步挂载，goto 后立即检查会漏掉；
  /// locator handler 会在弹窗任意时刻挡住后续操作时自动关闭它。
  const onboarding = page.getByTestId("first-run-onboarding");
  await page.addLocatorHandler(onboarding, async () => {
    await onboarding.getByRole("button", { name: "开始创作" }).click();
  });

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/upload/blob"),
  );
  await page
    .getByTestId("streamlined-product-assets")
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "single-video-product.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
  expect((await uploadResponse).status()).toBe(201);
  await expect(
    page.getByTestId("streamlined-product-assets").getByText(/1 \/ 9 张/),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "描述你想生成的视频" })
    .fill(prompt);
  const planResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/video-generation/plan"),
  );
  await page.getByRole("button", { name: "核对规格与积分" }).click();
  expect((await planResponse).status()).toBe(200);

  const storyboardResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/video-generation/storyboards"),
  );
  await page.getByRole("button", { name: "生成 Image 2 故事板" }).click();
  expect((await storyboardResponse).status()).toBe(201);
  await expect(page.getByTestId("storyboard-frame-grid").locator("article")).toHaveCount(4);

  const approve = page.getByRole("button", { name: "确认全部分镜" });
  /// 生产环境由 cron/poll-videos 周期性推进故事板逐帧生成；验收服务器没有
  /// 调度器，这里按同样节拍驱动它，让推进不只依赖页面自身的轮询链。
  const pollCronHeaders = process.env.CRON_SECRET
    ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
    : undefined;
  await expect
    .poll(
      async () => {
        await page.request
          .get("/api/cron/poll-videos", pollCronHeaders ? { headers: pollCronHeaders } : {})
          .catch(() => undefined);
        return approve.isEnabled().catch(() => false);
      },
      { timeout: 45_000, intervals: [1_500] },
    )
    .toBe(true);
  const approvalResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/video-generation\/storyboards\/[^/]+\/approve$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await approve.click();
  expect((await approvalResponse).status()).toBe(200);
  await expect(page.getByText("故事板已确认", { exact: true })).toBeVisible();

  const dispatchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/video-generation/dispatch"),
  );
  await page.getByRole("button", { name: "生成视频", exact: true }).click();
  const dispatched = await dispatchResponse;
  expect(dispatched.status()).toBe(200);
  return (await dispatched.json()) as { briefId: string; nextUrl: string };
}

export async function createBatch(
  page: Page,
  args: {
    imageCount: number;
    requestedCount: number;
    key: string;
    prefix?: string;
    expectedStatus?: 200 | 201;
  },
): Promise<Batch> {
  const template = await getAcceptanceTemplate(page);
  const result = await browserFetch<{ batch?: Batch; error?: string }>(
    page,
    "/api/batches",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": args.key,
      },
      body: {
        templateId: template.id,
        templateVersion: template.version,
        assetIds: acceptanceAssetIds(args.imageCount),
        requestedCount: args.requestedCount,
        productName: `Final Acceptance ${args.key}`,
      },
    },
  );
  expect(result.status, result.text).toBe(args.expectedStatus ?? 201);
  expect(result.body.batch, "创建批次响应必须包含 batch").toBeDefined();
  await registerBatch(result.body.batch!.id);
  return result.body.batch!;
}

export async function getBatch(page: Page, batchId: string): Promise<Batch> {
  const result = await browserFetch<{ batch?: Batch; error?: string }>(
    page,
    `/api/batches/${batchId}/status`,
  );
  expect(result.status, result.text).toBe(200);
  expect(result.body.batch).toBeDefined();
  return result.body.batch!;
}

export async function tickBatch(page: Page, batchId: string): Promise<Batch> {
  const result = await browserFetch<{ batch?: Batch; error?: string }>(
    page,
    `/api/batches/${batchId}/status`,
    { method: "POST" },
  );
  expect(result.status, result.text).toBe(200);
  expect(result.body.batch).toBeDefined();
  return result.body.batch!;
}

export async function waitForTerminal(
  page: Page,
  batchId: string,
  testInfo: TestInfo,
  timeoutMs = 120_000,
): Promise<{ batch: Batch; samples: Array<Record<string, unknown>> }> {
  const deadline = Date.now() + timeoutMs;
  const samples: Array<Record<string, unknown>> = [];
  let previousProgress = -1;
  while (Date.now() < deadline) {
    const batch = await tickBatch(page, batchId);
    const finished =
      batch.completedCount + batch.failedCount + batch.cancelledCount;
    const runningProgress = batch.videoJobs
      .filter((job) => job.status === "RUNNING")
      .reduce((sum, job) => sum + (job.lastProgress ?? 0) / 100, 0);
    const progress = Math.round(
      ((finished + runningProgress) / batch.requestedCount) * 100,
    );
    expect(progress, "批次聚合进度不得回退").toBeGreaterThanOrEqual(previousProgress);
    previousProgress = progress;
    samples.push({
      ts: new Date().toISOString(),
      status: batch.status,
      progress,
      queued: batch.queuedCount,
      running: batch.runningCount,
      completed: batch.completedCount,
      failed: batch.failedCount,
      cancelled: batch.cancelledCount,
    });
    if (TERMINAL_BATCH_STATUSES.has(batch.status)) {
      await attachJson(testInfo, `batch-${batchId}-samples`, samples);
      return { batch, samples };
    }
    await page.waitForTimeout(100);
  }
  await attachJson(testInfo, `batch-${batchId}-samples-timeout`, samples);
  throw new Error(`批次 ${batchId} 在 ${timeoutMs}ms 内未到终态`);
}

export async function sampleFps(page: Page, durationMs = 1_000): Promise<number> {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const started = performance.now();
        const frame = (now: number) => {
          frames += 1;
          if (now - started >= duration) {
            resolve((frames * 1_000) / (now - started));
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    durationMs,
  );
}

export async function sampleScrollFps(
  page: Page,
  selector: string,
  durationMs = 1_000,
): Promise<number> {
  return page.evaluate(
    ({ targetSelector, duration }) =>
      new Promise<number>((resolve, reject) => {
        const target = document.querySelector<HTMLElement>(targetSelector);
        if (!target) {
          reject(new Error(`滚动目标不存在：${targetSelector}`));
          return;
        }
        let frames = 0;
        const started = performance.now();
        const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
        const frame = (now: number) => {
          frames += 1;
          const elapsed = now - started;
          target.scrollTop = maxScroll * Math.min(1, elapsed / duration);
          if (elapsed >= duration) {
            resolve((frames * 1_000) / elapsed);
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { targetSelector: selector, duration: durationMs },
  );
}

export function runKey(testInfo: TestInfo, journey: string): string {
  const runId = process.env.FINAL_ACCEPTANCE_RUN_ID ?? "missing-run-id";
  return `${runId}-${journey}-${testInfo.project.name}`;
}
