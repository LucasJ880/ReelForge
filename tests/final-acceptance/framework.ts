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
  errorMessage: string | null;
  userSafeError: string | null;
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
  evidence: EvidenceCollector;
  evidenceAuto: void;
}>({
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

test.beforeEach(async () => {
  const runId = process.env.FINAL_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  await db.batchJob.deleteMany({
    where: {
      idempotencyKey: { startsWith: runId },
      user: { email: FINAL_ACCEPTANCE_EMAIL },
    },
  });
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

export function imageUrls(count: number, prefix: string) {
  const baseURL =
    process.env.FINAL_ACCEPTANCE_BASE_URL ?? "http://localhost:3100";
  const imageUrl = `${baseURL}/file.svg`;
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-image-${index + 1}`,
    url: imageUrl,
  }));
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

export async function createBatch(
  page: Page,
  args: {
    imageCount: number;
    requestedCount: number;
    key: string;
    prefix?: string;
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
        images: imageUrls(args.imageCount, args.prefix ?? args.key),
        requestedCount: args.requestedCount,
        productName: `Final Acceptance ${args.key}`,
      },
    },
  );
  expect(result.status, result.text).toBe(201);
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
