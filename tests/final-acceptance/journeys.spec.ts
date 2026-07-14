import {
  browserFetch,
  createBatch,
  expect,
  getAcceptanceTemplate,
  getBatch,
  imageUrls,
  registerBatch,
  runKey,
  sampleFps,
  sampleScrollFps,
  test,
  tickBatch,
  waitForTerminal,
  type Batch,
} from "./framework";
import { request as playwrightRequest } from "@playwright/test";
import { db } from "../../src/lib/db";

test("J1：20 图 100 条的分配、93/7 终态、虚拟化、播放与批量下载", async ({
  page,
  evidence,
}, testInfo) => {
  await page.goto("/app/batches/new");
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 20 }, (_, index) => ({
      name: `j1-product-${index + 1}.png`,
      mimeType: "image/png",
      buffer: tinyPng,
    })),
  );
  await expect(page.getByText(/已完成 20 · 上传中 0 · 失败 0/)).toBeVisible({
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "下一步" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "最终验收单图模板" })
    .click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("生成数量输入").fill("100");
  await expect(page.getByText(/每张图约使用 5\.0 次/)).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "创建 100 条视频" }).click();
  await expect(page).toHaveURL(/\/app\/batches\/(?!new(?:$|[/?]))[^/?]+$/, {
    timeout: 30_000,
  });
  const batchId = new URL(page.url()).pathname.split("/").at(-1)!;
  await registerBatch(batchId);
  const batch = await getBatch(page, batchId);

  const initialUsage = new Map<string, number>();
  for (const job of batch.videoJobs) {
    const assets = job.assignedAssets?.assets ?? [];
    expect(assets, `视频 ${job.batchIndex} 必须恰好分配一张图`).toHaveLength(1);
    const imageId = assets[0].id;
    initialUsage.set(imageId, (initialUsage.get(imageId) ?? 0) + 1);
  }
  expect([...initialUsage.values()].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 20 }, () => 5),
  );

  const terminal = await waitForTerminal(page, batch.id, testInfo);
  expect(terminal.batch.completedCount).toBe(93);
  expect(terminal.batch.failedCount).toBe(7);
  const failedJobs = terminal.batch.videoJobs.filter(
    (job) => job.status === "FAILED",
  );
  expect(failedJobs).toHaveLength(7);
  for (const job of failedJobs) {
    expect(job).not.toHaveProperty(
      "errorMessage",
      `客户 API 不得泄漏任务 ${job.id} 的机器诊断`,
    );
    expect(job.error?.code, `失败任务 ${job.id} 必须有稳定错误码`).toMatch(
      /^PROVIDER_(?:ERROR|TIMEOUT)$/,
    );
    expect(job.error?.message, `失败任务 ${job.id} 必须提供用户可见原因`).toMatch(
      /失败|超时|无响应/,
    );
    expect(job.error?.retryable).toBe(true);
  }
  const internalFailures = await db.videoJob.findMany({
    where: { id: { in: failedJobs.map((job) => job.id) } },
    select: { id: true, errorMessage: true },
  });
  expect(internalFailures).toHaveLength(7);
  for (const job of internalFailures) {
    expect(job.errorMessage, `内部审计仍须保留任务 ${job.id} 的机器原因`).toMatch(
      /\[(?:provider|watchdog):/,
    );
  }

  await page.goto(`/app/batches/${batch.id}`);
  const grid = page.getByRole("region", { name: "批次视频任务列表" });
  await expect(grid).toHaveAttribute("data-virtualized", "true");
  await expect(grid).toHaveAttribute("data-total-cards", "100");
  await expect(page.locator("[data-batch-poll-connections]")).toHaveAttribute(
    "data-batch-poll-connections",
    "1",
  );
  expect(await page.locator("[data-batch-video-card]").count()).toBeLessThan(100);

  const videos = page.locator("video");
  const played = new Set<string>();
  for (let attempt = 0; attempt < 12 && played.size < 3; attempt += 1) {
    for (let index = 0; index < (await videos.count()) && played.size < 3; index += 1) {
      const playback = await videos.nth(index).evaluate(async (video) => {
        const media = video as HTMLVideoElement;
        const key =
          media.closest("[data-batch-video-card]")?.textContent ??
          media.currentSrc ??
          media.src;
        media.muted = true;
        try {
          await media.play();
          return { key, ok: true, currentTime: media.currentTime, error: null };
        } catch (error) {
          return { key, ok: false, currentTime: media.currentTime, error: String(error) };
        }
      });
      expect(
        playback.ok,
        `第 ${played.size + 1} 个 mock 视频必须可播放：${playback.error}`,
      ).toBe(true);
      played.add(playback.key);
    }
    if (played.size < 3) {
      await grid.evaluate((element) => {
        element.scrollTop += Math.max(320, element.clientHeight);
      });
      await page.waitForTimeout(100);
    }
  }
  expect(played.size, "虚拟网格滚动后必须可播放 3 条不同成片").toBeGreaterThanOrEqual(3);
  const scrollFps = await sampleScrollFps(
    page,
    '[role="region"][aria-label="批次视频任务列表"]',
  );
  await testInfo.attach("j1-virtual-grid-performance", {
    body: Buffer.from(JSON.stringify({ scrollFps, renderedCards: await page.locator("[data-batch-video-card]").count() }, null, 2)),
    contentType: "application/json",
  });
  expect(scrollFps, "100 卡片虚拟网格滚动帧率低于预算").toBeGreaterThanOrEqual(55);

  await page.evaluate(() => {
    const state = { clicks: 0, downloads: [] as string[] };
    Object.defineProperty(window, "__finalAcceptanceDownloads", { value: state });
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      state.clicks += 1;
      state.downloads.push(this.download);
      void original;
    };
  });
  await page.getByRole("button", { name: "全选已完成" }).click();
  await expect(page.getByRole("button", { name: "下载所选 (93)" })).toBeEnabled();
  await page.getByRole("button", { name: "下载所选 (93)" }).click();
  const downloads = await page.evaluate(
    () =>
      (
        window as unknown as Window & {
          __finalAcceptanceDownloads: { clicks: number; downloads: string[] };
        }
      ).__finalAcceptanceDownloads,
  );
  expect(downloads.clicks).toBe(93);
  expect(new Set(downloads.downloads).size).toBe(93);

  const statusRequests = evidence.network.filter(
    (entry) =>
      entry.kind === "response" &&
      String(entry.url).includes(`/api/batches/${batch.id}/status`),
  );
  expect(statusRequests.length).toBeGreaterThan(0);
  expect(
    evidence.network.filter((entry) =>
      /\/api\/batches\/[^/]+\/jobs\/[^/]+\/status/.test(String(entry.url)),
    ),
    "禁止每卡单独轮询",
  ).toEqual([]);
});

test("J2：刷新、历史导航、上下文重开、持续采样与幂等", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/app/batches/new");
  const key = runKey(testInfo, "j2");
  const first = await createBatch(page, {
    imageCount: 4,
    requestedCount: 20,
    key,
  });
  const duplicate = await createBatch(page, {
    imageCount: 4,
    requestedCount: 20,
    key,
    expectedStatus: 200,
  });
  expect(duplicate.id).toBe(first.id);
  expect(duplicate.videoJobs).toHaveLength(20);

  await page.goto(`/app/batches/${first.id}`);
  for (let index = 0; index < 3; index += 1) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(`批次 ${first.id}`, { exact: false })).toBeVisible();
  }

  await page.goto("/app/batches/new");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/app/batches/${first.id}$`));
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/batches\/new$/);

  const reopened = await context.newPage();
  await reopened.goto(`/app/batches/${first.id}`);
  await expect(reopened.getByText(`批次 ${first.id}`, { exact: false })).toBeVisible();
  await reopened.close();

  const soakMs = Number(process.env.FINAL_ACCEPTANCE_SOAK_MS ?? "5000");
  const deadline = Date.now() + soakMs;
  let previous = -1;
  const samples: Array<Record<string, unknown>> = [];
  while (Date.now() < deadline) {
    const current = await tickBatch(page, first.id);
    const progress = Math.round(
      ((current.completedCount + current.failedCount + current.cancelledCount) /
        current.requestedCount) *
        100,
    );
    expect(progress, "刷新与重连期间进度不得回退").toBeGreaterThanOrEqual(previous);
    previous = progress;
    samples.push({
      ts: new Date().toISOString(),
      status: current.status,
      progress,
      jobs: current.videoJobs.length,
    });
    await page.waitForTimeout(Math.min(250, Math.max(10, deadline - Date.now())));
  }
  expect(samples.length, "持续状态采样必须产生多个真实样本").toBeGreaterThan(2);
  expect(samples.every((sample) => sample.jobs === 20)).toBe(true);
  await testInfo.attach("j2-continuous-state-samples", {
    body: Buffer.from(JSON.stringify({ configuredDurationMs: soakMs, samples }, null, 2)),
    contentType: "application/json",
  });
});

test("J3：单条重试与全部重试均通过 UI 回到真实状态机", async ({
  page,
}, testInfo) => {
  await page.goto("/app/batches/new");
  const batch = await createBatch(page, {
    imageCount: 2,
    requestedCount: 20,
    key: runKey(testInfo, "j3"),
  });
  const firstTerminal = await waitForTerminal(page, batch.id, testInfo);
  expect(firstTerminal.batch.failedCount).toBeGreaterThan(0);

  await page.goto(`/app/batches/${batch.id}`);
  const singleRetryResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/batches/${batch.id}/jobs/`) &&
      response.url().endsWith("/retry"),
  );
  await page.getByRole("button", { name: "重试", exact: true }).first().click();
  expect((await singleRetryResponse).status()).toBe(200);
  await waitForTerminal(page, batch.id, testInfo);
  let current = await getBatch(page, batch.id);
  expect(current.videoJobs.some((job) => job.retryCount >= 1)).toBe(true);

  await page.reload();
  const retryAll = page.getByRole("button", { name: /重试可恢复任务/ });
  await expect(retryAll).toBeVisible();
  const retryAllResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/batches/${batch.id}/retry`),
  );
  await retryAll.click();
  expect((await retryAllResponse).status()).toBe(200);
  await waitForTerminal(page, batch.id, testInfo);
  current = await getBatch(page, batch.id);
  expect(
    current.videoJobs.filter((job) => job.retryCount >= 1).length,
    "单条重试和全部重试应分别留下可审计的 retryCount",
  ).toBeGreaterThanOrEqual(2);
  expect(current.status, "全部失败重试后批次必须转为 completed").toBe("COMPLETED");
  expect(current.completedCount).toBe(current.requestedCount);
});

test("J4：UI 边界、API 非法输入、双击幂等、真实上传、50 图与取消", async ({
  page,
  evidence,
}, testInfo) => {
  await page.goto("/app/batches/new");
  const template = await getAcceptanceTemplate(page);
  const validBody = {
    templateId: template.id,
    templateVersion: template.version,
    images: imageUrls(2, runKey(testInfo, "j4-valid")),
    requestedCount: 2,
  };

  const templateListResponse = await page.request.get(
    "/api/batch-style-templates",
  );
  expect(templateListResponse.status()).toBe(200);
  expect(await templateListResponse.json()).toMatchObject({
    ok: true,
    templates: expect.any(Array),
  });

  const healthResponse = await page.request.get("/api/health");
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toMatchObject({
    ok: true,
    database: "connected",
    region: "na",
  });
  const healthHead = await page.request.head("/api/health");
  expect(healthHead.status()).toBe(healthResponse.status());

  const missingId = runKey(testInfo, "j4-missing");
  const routeFailures = [
    await page.request.get(`/api/batches/${missingId}/status`),
    await page.request.post(`/api/batches/${missingId}/status`),
    await page.request.post(`/api/batches/${missingId}/cancel`),
    await page.request.post(`/api/batches/${missingId}/retry`),
    await page.request.post(
      `/api/batches/${missingId}/jobs/${missingId}-job/retry`,
    ),
  ];
  for (const response of routeFailures) {
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "RESOURCE_NOT_FOUND",
      retryable: false,
      action: "contact_support",
    });
  }

  const dispatchValidation = await page.request.post(
    "/api/video-generation/dispatch",
    {
      headers: {
        "content-type": "application/json",
        "idempotency-key": runKey(testInfo, "j4-dispatch-invalid"),
      },
      data: { request: {} },
    },
  );
  expect(dispatchValidation.status()).toBe(400);
  expect(await dispatchValidation.json()).toMatchObject({
    ok: false,
    code: "VALIDATION_FAILED",
    retryable: false,
    action: "fix_request",
  });

  const anonymousEndpoints = [
    { path: "/api/batch-style-templates", method: "GET" },
    { path: "/api/batches", method: "POST" },
    { path: "/api/upload/blob", method: "POST" },
    { path: "/api/video-generation/dispatch", method: "POST" },
  ] as const;
  const anonymousRequest = await playwrightRequest.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: { cookies: [], origins: [] },
  });
  try {
    expect((await anonymousRequest.storageState()).cookies).toEqual([]);
    const anonymousFailures = await Promise.all(
      anonymousEndpoints.map(async ({ path, method }) => {
        const response =
          method === "GET"
            ? await anonymousRequest.get(path)
            : await anonymousRequest.post(path);
        return {
          method,
          path,
          status: response.status(),
          body: await response.json(),
        };
      }),
    );
    expect(
      anonymousFailures.map(({ method, path, status }) => ({
        method,
        path,
        status,
      })),
    ).toEqual(
      anonymousEndpoints.map(({ method, path }) => ({
        method,
        path,
        status: 401,
      })),
    );
    for (const response of anonymousFailures) {
      expect(response.body).toMatchObject({
        ok: false,
        code: "AUTH_REQUIRED",
        retryable: false,
        action: "sign_in",
      });
    }
    await testInfo.attach("j4-anonymous-auth-contract", {
      body: Buffer.from(JSON.stringify(anonymousFailures, null, 2)),
      contentType: "application/json",
    });
  } finally {
    await anonymousRequest.dispose();
  }

  const invalidCases = [
    {
      name: "51 images",
      body: { ...validBody, images: imageUrls(51, runKey(testInfo, "j4-51")) },
      status: 400,
    },
    { name: "N=251", body: { ...validBody, requestedCount: 251 }, status: 400 },
    { name: "decimal", body: { ...validBody, requestedCount: 1.5 }, status: 400 },
    { name: "negative", body: { ...validBody, requestedCount: -1 }, status: 400 },
    {
      name: "duplicate image id",
      body: {
        ...validBody,
        images: [
          { id: "duplicate", url: "https://example.com/a.png" },
          { id: "duplicate", url: "https://example.com/b.png" },
        ],
      },
      status: 409,
    },
  ];
  for (const invalid of invalidCases) {
    const response = await page.request.post("/api/batches", {
      headers: {
        "content-type": "application/json",
        "idempotency-key": `${runKey(testInfo, "j4-invalid")}-${invalid.name}`,
      },
      data: invalid.body,
    });
    const body = (await response.json()) as {
      ok?: boolean;
      code?: string;
      error?: string;
      retryable?: boolean;
      action?: string;
    };
    expect(response.status(), `${invalid.name}: ${JSON.stringify(body)}`).toBe(
      invalid.status,
    );
    expect(body.error, `${invalid.name} 必须给出明确错误`).toBeTruthy();
    expect(body.ok, `${invalid.name} 必须使用客户错误契约`).toBe(false);
    expect(body.code, `${invalid.name} 必须给出机器错误码`).toBeTruthy();
    expect(body.retryable, `${invalid.name} 不得暗示可安全重试`).toBe(false);
    expect(body.action, `${invalid.name} 必须给出恢复动作`).toBeTruthy();
  }

  const doubleKey = runKey(testInfo, "j4-double-click");
  const double = await page.evaluate(
    async ({ body, key }) => {
      const submit = async () => {
        const response = await fetch("/api/batches", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      };
      return Promise.all([submit(), submit()]);
    },
    { body: validBody, key: doubleKey },
  );
  expect(double.map((result) => result.status).sort()).toEqual([200, 201]);
  const doubleIds = double.map(
    (result) => (result.body as { batch: { id: string } }).batch.id,
  );
  expect(new Set(doubleIds).size).toBe(1);
  await registerBatch(doubleIds[0]);

  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "仅支持 PNG、JPG、WEBP" }),
  ).toBeVisible();

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  let uploadCancelled = false;
  page.on("requestfailed", (request) => {
    if (
      request.url().includes("/api/upload/blob") &&
      /ERR_ABORTED|cancelled|canceled/i.test(request.failure()?.errorText ?? "")
    ) {
      uploadCancelled = true;
    }
  });
  await page.route("**/api/upload/blob", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue().catch(() => undefined);
  });
  await input.setInputFiles({
    name: "cancel-during-upload.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await expect(page.getByText(/上传中 1/)).toBeVisible();
  await page
    .getByRole("button", { name: "删除 cancel-during-upload.png" })
    .click();
  await expect(page.getByText("0/50 张")).toBeVisible();
  await expect
    .poll(() => uploadCancelled, {
      timeout: 5_000,
      message: "删除上传中的图片必须中止底层网络请求",
    })
    .toBe(true);
  await page.unroute("**/api/upload/blob");

  await input.setInputFiles(
    Array.from({ length: 50 }, (_, index) => ({
      name: `final-acceptance-${index + 1}.png`,
      mimeType: "image/png",
      buffer: tinyPng,
    })),
  );
  await expect(
    page.getByText(/已完成 50 · 上传中 0 · 失败 0/),
    "真实 storage provider 必须接收 50 个 1x1 PNG；若 Blob/TOS 未配置，此断言应明确失败",
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("50/50 张")).toBeVisible();

  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  const countInput = page.getByLabel("生成数量输入");
  await expect(countInput).toHaveAttribute("min", "1");
  await expect(countInput).toHaveAttribute("max", "250");
  await countInput.fill("-1");
  await expect(countInput).toHaveValue("1");
  await countInput.fill("251");
  await expect(countInput).toHaveValue("250");

  // H1 quota injection: prove the actual customer wizard consumes the stable
  // recovery action instead of reducing a 429 to a generic failure.
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.route("**/api/batches", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "QUOTA_EXCEEDED",
        error: "本月视频生成次数已用完。",
        retryable: false,
        action: "view_usage",
      }),
    });
  });
  await page.getByRole("button", { name: "创建 250 条视频" }).click();
  await expect(
    page.getByRole("main").getByText("本月视频生成次数已用完。"),
  ).toBeVisible();
  await expect(
    page.getByText(/当前套餐额度已用尽，请联系账户负责人核对用量或升级套餐/),
  ).toBeVisible();
  const expected429 = evidence.findings.findIndex(
    (finding) =>
      finding.kind === "console-error" &&
      finding.url?.endsWith("/api/batches") &&
      finding.message.includes("429"),
  );
  expect(
    expected429,
    "quota chaos injection must emit exactly the expected browser 429 diagnostic",
  ).toBeGreaterThanOrEqual(0);
  evidence.findings.splice(expected429, 1);
  await page.unroute("**/api/batches");

  const nonImage = await page.request.post("/api/upload/blob", {
    multipart: {
      file: {
        name: "plain.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("plain"),
      },
    },
  });
  expect(nonImage.status(), await nonImage.text()).toBe(415);
  expect(await nonImage.json()).toMatchObject({
    ok: false,
    code: "VALIDATION_FAILED",
    retryable: false,
    action: "fix_request",
  });

  const acceptanceOwner = await db.batchJob.findUnique({
    where: { id: doubleIds[0] },
    select: { userId: true },
  });
  expect(acceptanceOwner).toBeTruthy();
  await db.userUsagePeriod.deleteMany({
    where: { userId: acceptanceOwner!.userId },
  });

  const cancellable = await createBatch(page, {
    imageCount: 2,
    requestedCount: 200,
    key: runKey(testInfo, "j4-cancel"),
  });
  const cancelled = await browserFetch<{ cancelled?: number; batch?: Batch; error?: string }>(
    page,
    `/api/batches/${cancellable.id}/cancel`,
    { method: "POST" },
  );
  expect(cancelled.status, cancelled.text).toBe(200);
  expect(cancelled.body.cancelled).toBeGreaterThan(0);
  expect(cancelled.body.batch?.cancelledCount).toBeGreaterThan(0);
});

test("J5：两个批次并行推进且各自通过 HTTP UI 验证", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/app/batches/new");
  const template = await getAcceptanceTemplate(page);
  const keys = [runKey(testInfo, "j5-a"), runKey(testInfo, "j5-b")];
  const created = await page.evaluate(
    async ({ templateId, templateVersion, requestKeys, imagesByBatch }) =>
      Promise.all(
        requestKeys.map(async (key, batchIndex) => {
          const response = await fetch("/api/batches", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": key,
            },
            body: JSON.stringify({
              templateId,
              templateVersion,
              images: imagesByBatch[batchIndex],
              requestedCount: 50,
            }),
          });
          return { status: response.status, text: await response.text() };
        }),
      ),
    {
      templateId: template.id,
      templateVersion: template.version,
      requestKeys: keys,
      imagesByBatch: keys.map((key) => imageUrls(20, key)),
    },
  );
  const batches = created.map((result) => {
    expect(result.status, result.text).toBe(201);
    return (JSON.parse(result.text) as { batch: Batch }).batch;
  });
  for (const batch of batches) await registerBatch(batch.id);

  const [left, right] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([left.goto("/app/batches/new"), right.goto("/app/batches/new")]);
  const batchesInFlight = Promise.all([
    waitForTerminal(left, batches[0].id, testInfo),
    waitForTerminal(right, batches[1].id, testInfo),
  ]);

  const singlePage = await context.newPage();
  await singlePage.goto("/app/create");
  await singlePage
    .getByLabel("你想做什么样的视频？")
    .fill("15 秒中文 UGC 产品演示，突出耐用与便携，真实自然光，清晰展示使用前后。");
  const planResponse = singlePage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/video-generation/plan"),
  );
  await singlePage
    .getByRole("button", { name: "预览方案" })
    .click();
  expect((await planResponse).status()).toBe(200);
  const dispatchButton = singlePage.getByRole("button", {
    name: "生成视频",
    exact: true,
  });
  await expect(dispatchButton).toBeVisible();
  const dispatchResponse = singlePage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/video-generation/dispatch"),
  );
  await dispatchButton.click();
  const dispatchHttpResponse = await dispatchResponse;
  expect(dispatchHttpResponse.status()).toBe(200);
  const dispatchPayload = (await dispatchHttpResponse.json()) as {
    briefId: string;
    nextUrl: string;
  };
  await expect(singlePage).toHaveURL(/\/app\/library\?highlight=/);
  let singleSummary:
    | { totalJobs: number; succeeded: number; running: number; queued: number; failed: number }
    | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await browserFetch<{
      totalJobs: number;
      succeeded: number;
      running: number;
      queued: number;
      failed: number;
    }>(singlePage, `/api/briefs/${dispatchPayload.briefId}/render-status`, {
      method: "POST",
    });
    expect(result.status, result.text).toBe(200);
    singleSummary = result.body;
    if (singleSummary.running + singleSummary.queued === 0) break;
    await singlePage.waitForTimeout(100);
  }
  expect(singleSummary?.failed).toBe(0);
  expect(singleSummary?.succeeded).toBe(singleSummary?.totalJobs);
  const stitchHeaders = process.env.CRON_SECRET
    ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
    : undefined;
  const stitchResponse = await singlePage.request.post("/api/cron/stitch-videos", {
    headers: stitchHeaders,
  });
  expect(stitchResponse.status(), await stitchResponse.text()).toBe(200);
  let finalVideoUrl: string | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await browserFetch<{ finalVideoUrl: string | null }>(
      singlePage,
      `/api/briefs/${dispatchPayload.briefId}/render-status`,
    );
    expect(result.status, result.text).toBe(200);
    finalVideoUrl = result.body.finalVideoUrl;
    if (finalVideoUrl) break;
    await singlePage.waitForTimeout(100);
  }
  expect(finalVideoUrl, "旧单条链路必须完成合成并产出最终 URL").toBeTruthy();
  await singlePage.goto(dispatchPayload.nextUrl);
  await expect(singlePage).toHaveURL(/\/app\/library\?highlight=/);
  await expect(singlePage.getByText(/已完成|可下载/).first()).toBeVisible();

  const [leftResult, rightResult] = await batchesInFlight;
  expect(leftResult.batch.id).not.toBe(rightResult.batch.id);
  expect(leftResult.batch.videoJobs).toHaveLength(50);
  expect(rightResult.batch.videoJobs).toHaveLength(50);

  await Promise.all([
    left.goto(`/app/batches/${batches[0].id}`),
    right.goto(`/app/batches/${batches[1].id}`),
  ]);
  await Promise.all([
    expect(left.getByText(`批次 ${batches[0].id}`, { exact: false })).toBeVisible(),
    expect(right.getByText(`批次 ${batches[1].id}`, { exact: false })).toBeVisible(),
  ]);
  await Promise.all([left.close(), right.close(), singlePage.close()]);
});

test("J8：CDP Slow 3G、监控路由延迟、LCP/FPS/route 预算", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/app/library");
  const routeStarted = performance.now();
  await page.getByRole("button", { name: /批量生成/ }).first().click();
  await expect(page).toHaveURL((url) => url.pathname === "/app/batches/new");
  const routeSwitchMs = performance.now() - routeStarted;
  await page.waitForTimeout(500);
  const normalLcpMs = await page.evaluate(
    () =>
      (
        window as Window & {
          __finalAcceptancePerf?: { lcp: number };
        }
      ).__finalAcceptancePerf?.lcp ?? 0,
  );

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: (50 * 1024) / 8,
    uploadThroughput: (20 * 1024) / 8,
    connectionType: "cellular3g",
  });

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "slow-3g-product.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await expect(
    page.getByText(/已完成 1 · 上传中 0 · 失败 0/),
    "Slow 3G 下单图上传必须最终完成且不假死",
  ).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "下一步" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "最终验收单图模板" })
    .click();
  await page.getByRole("button", { name: "下一步" }).click();
  const countInput = page.getByLabel("生成数量输入");
  await countInput.fill("1");
  await page.getByRole("button", { name: "下一步" }).click();
  const submit = page.getByRole("button", { name: /创建 1 条视频/ });
  const submitStarted = performance.now();
  await submit.click();
  await expect(submit).toBeDisabled({ timeout: 200 });
  const submitFeedbackMs = performance.now() - submitStarted;
  await expect(page).toHaveURL(/\/app\/batches\/(?!new(?:$|[/?]))[^/?]+$/, {
    timeout: 120_000,
  });
  const batchId = new URL(page.url()).pathname.split("/").at(-1)!;
  await registerBatch(batchId);

  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: "none",
  });

  const delayMs = Number(process.env.FINAL_ACCEPTANCE_MONITOR_DELAY_MS ?? "30000");
  await page.route(`**/api/batches/${batchId}/status`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
  const statusStarted = performance.now();
  const pendingStatus = tickBatch(page, batchId);
  await expect(page.getByRole("progressbar", { name: /批次总进度/ })).toBeVisible({
    timeout: 200,
  });
  const response = await pendingStatus;
  const statusResponseMs = performance.now() - statusStarted;
  expect(response.id).toBe(batchId);
  expect(statusResponseMs, "监控延迟证据必须覆盖 30 秒配置").toBeGreaterThanOrEqual(
    delayMs,
  );

  const fps = await sampleFps(page);
  const perf = await page.evaluate(() => {
    const state = (
      window as Window & {
        __finalAcceptancePerf?: { lcp: number; longTasks: number[] };
      }
    ).__finalAcceptancePerf;
    return { lcpMs: state?.lcp ?? 0, longTasksMs: state?.longTasks ?? [] };
  });
  const budgets = {
    lcpMs: Number(process.env.FINAL_ACCEPTANCE_LCP_BUDGET_MS ?? "2500"),
    routeSwitchMs: Number(process.env.FINAL_ACCEPTANCE_ROUTE_BUDGET_MS ?? "1000"),
    feedbackMs: 200,
    maxLongTaskMs: 100,
    fps: Number(process.env.FINAL_ACCEPTANCE_FPS_BUDGET ?? "55"),
  };
  await testInfo.attach("j8-slow-3g-performance", {
    body: Buffer.from(
      JSON.stringify(
        {
          emulation: "Slow 3G upload + 30s monitor response",
          delayMs,
          routeSwitchMs,
          submitFeedbackMs,
          statusResponseMs,
          normalLcpMs,
          fps,
          perf,
          budgets,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
  expect(normalLcpMs, "正常网络必须采集到 LCP").toBeGreaterThan(0);
  expect(normalLcpMs, "正常网络 LCP 超预算").toBeLessThanOrEqual(budgets.lcpMs);
  expect(routeSwitchMs, "路由切换超预算").toBeLessThanOrEqual(
    budgets.routeSwitchMs,
  );
  expect(submitFeedbackMs, "提交按钮反馈超过 200ms").toBeLessThanOrEqual(
    budgets.feedbackMs,
  );
  expect(Math.max(0, ...perf.longTasksMs), "主线程冻结超过 100ms").toBeLessThanOrEqual(
    budgets.maxLongTaskMs,
  );
  expect(fps, "监控页动画帧率低于预算").toBeGreaterThanOrEqual(budgets.fps);
});
