import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FinalVideoStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  GOLDEN_PATH_EMAIL,
  GOLDEN_PATH_FIXTURE_PATH,
  GOLDEN_PATH_NAME,
  GOLDEN_PATH_PASSWORD,
  assertRehearsalDatabase,
} from "./golden-path-fixture";

type RenderSummary = {
  totalJobs: number;
  succeeded: number;
  running: number;
  queued: number;
  failed: number;
  cancelled: number;
  finalVideoUrl: string | null;
  finalVideo: { id: string; status: string } | null;
};

test("golden path: register, login, create, mock complete, preview, and download", async ({
  page,
  baseURL,
}, testInfo) => {
  assertRehearsalDatabase();
  expect(process.env.AIVORA_DRY_RUN).toBe("1");
  expect(process.env.VIDEO_ENGINE_MOCK).toBe("true");
  expect(process.env.BLOB_READ_WRITE_TOKEN).toBe("");

  const clientErrors: string[] = [];
  const serverFailures: string[] = [];
  const failedRequests: string[] = [];
  let cancelledRscPrefetches = 0;
  page.on("console", (message) => {
    if (message.type() === "error") clientErrors.push(message.text());
  });
  page.on("pageerror", (error) => clientErrors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown";
    const url = new URL(request.url());
    if (errorText === "net::ERR_ABORTED" && url.searchParams.has("_rsc")) {
      cancelledRscPrefetches += 1;
      return;
    }
    failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
  });

  await test.step("register and arrive naturally in the workspace", async () => {
    await page.goto("/register");
    await page.getByLabel("邮箱").fill(GOLDEN_PATH_EMAIL);
    await page.getByLabel("昵称（可选）").fill(GOLDEN_PATH_NAME);
    await page.getByLabel("密码（至少 8 位）").fill(GOLDEN_PATH_PASSWORD);
    const registration = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && response.url().endsWith("/api/auth/register"),
    );
    await page.getByRole("button", { name: "创建账号" }).click();
    expect((await registration).status()).toBe(200);
    await expect(page).toHaveURL((url) => url.pathname === "/app/create");
    await expect(page.locator(".studio-theme")).toBeVisible();
  });

  await test.step("sign out and sign back in without a cookie bridge", async () => {
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    await page.getByLabel("邮箱").fill(GOLDEN_PATH_EMAIL);
    await page.getByLabel("密码").fill(GOLDEN_PATH_PASSWORD);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/app/create");
  });

  let briefId = "";
  let deliveryOrderId = "";
  await test.step("preview and dispatch one deterministic mock video", async () => {
    const prompt = page.getByLabel("你想做什么样的视频？");
    await prompt.scrollIntoViewIfNeeded();
    await prompt.fill(
      "为年轻人制作一条 15 秒世界杯看球场景产品短片：同一个真实客厅、同一人物和同一产品，产品在前 3 秒清楚出现，不虚构功能。",
    );

    const planResponse = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && response.url().endsWith("/api/video-generation/plan"),
    );
    await page.getByRole("button", { name: "预览方案", exact: true }).click();
    expect((await planResponse).status()).toBe(200);

    const dispatchResponse = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && response.url().endsWith("/api/video-generation/dispatch"),
    );
    const dispatchRequest = page.waitForRequest(
      (request) => request.method() === "POST"
        && request.url().endsWith("/api/video-generation/dispatch"),
    );
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    const originalRequest = await dispatchRequest;
    const response = await dispatchResponse;
    expect(response.status(), await response.text()).toBe(200);
    const payload = await response.json() as {
      ok: true;
      briefId: string;
      deliveryOrderId: string;
    };
    briefId = payload.briefId;
    deliveryOrderId = payload.deliveryOrderId;
    expect(briefId).toBeTruthy();
    expect(deliveryOrderId).toBeTruthy();

    const idempotencyKey = originalRequest.headers()["idempotency-key"];
    expect(idempotencyKey).toBeTruthy();
    const jobsBeforeReplay = await db.videoJob.count({
      where: { videoBriefId: briefId },
    });
    const replay = await page.request.post("/api/video-generation/dispatch", {
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      data: originalRequest.postDataJSON(),
    });
    expect(replay.status(), await replay.text()).toBe(200);
    const replayPayload = await replay.json() as {
      ok: true;
      briefId: string;
      deliveryOrderId: string;
    };
    expect(replayPayload.briefId).toBe(briefId);
    expect(replayPayload.deliveryOrderId).toBe(deliveryOrderId);
    expect(await db.videoJob.count({ where: { videoBriefId: briefId } })).toBe(
      jobsBeforeReplay,
    );
  });

  let renderSummary: RenderSummary | null = null;
  await test.step("reconcile every provider job to a terminal success", async () => {
    await expect.poll(async () => {
      const response = await page.request.post(`/api/briefs/${briefId}/render-status`);
      expect(response.status(), await response.text()).toBe(200);
      renderSummary = await response.json() as RenderSummary;
      return {
        remaining: renderSummary.running + renderSummary.queued,
        failed: renderSummary.failed,
        cancelled: renderSummary.cancelled,
        allSucceeded: renderSummary.totalJobs > 0
          && renderSummary.succeeded === renderSummary.totalJobs,
      };
    }, {
      message: "all mock provider jobs should reach SUCCEEDED",
      timeout: 30_000,
      intervals: [100, 250, 500],
    }).toEqual({ remaining: 0, failed: 0, cancelled: 0, allSucceeded: true });

    expect(renderSummary?.finalVideo?.id).toBeTruthy();
    const fixtureUrl = new URL(GOLDEN_PATH_FIXTURE_PATH, baseURL).toString();
    const jobs = await db.videoJob.findMany({
      where: { videoBriefId: briefId },
      select: { outputVideoUrl: true },
    });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.outputVideoUrl === fixtureUrl)).toBe(true);
  });

  await test.step("simulate the external stitch runner claim and authenticated completion", async () => {
    const finalVideoId = renderSummary?.finalVideo?.id;
    expect(finalVideoId).toBeTruthy();
    const claim = await db.finalVideo.updateMany({
      where: { id: finalVideoId, status: FinalVideoStatus.PENDING },
      data: {
        status: FinalVideoStatus.STITCHING,
        startedAt: new Date(),
        ffmpegError: null,
      },
    });
    expect(claim.count).toBe(1);

    const fixtureUrl = new URL(GOLDEN_PATH_FIXTURE_PATH, baseURL).toString();
    const completion = await page.request.post("/api/internal/stitch/complete", {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
        "content-type": "application/json",
      },
      data: { finalVideoId, stitchedVideoUrl: fixtureUrl },
    });
    expect(completion.status(), await completion.text()).toBe(200);
    expect((await completion.json()).ok).toBe(true);

    await expect.poll(async () => {
      const response = await page.request.get(`/api/briefs/${briefId}/render-status`);
      expect(response.status(), await response.text()).toBe(200);
      renderSummary = await response.json() as RenderSummary;
      return renderSummary.finalVideoUrl;
    }, { timeout: 10_000, intervals: [100, 250] }).toBe(fixtureUrl);
  });

  await test.step("open, play, and download the completed customer asset", async () => {
    await page.goto(`/app/library/${deliveryOrderId}`);
    await expect(page).toHaveURL((url) => url.pathname === `/app/library/${deliveryOrderId}`);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect.poll(async () => video.evaluate(
      (element) => (element as HTMLVideoElement).readyState,
    ), {
      timeout: 15_000,
      intervals: [100, 250],
    }).toBeGreaterThanOrEqual(1);
    await video.evaluate(async (element) => {
      const player = element as HTMLVideoElement;
      player.muted = true;
      await player.play();
    });
    await expect.poll(async () => video.evaluate(
      (element) => (element as HTMLVideoElement).paused,
    ), {
      timeout: 5_000,
      intervals: [100],
    }).toBe(false);

    const downloadLink = page.getByRole("button", { name: "下载成片", exact: true });
    await expect(downloadLink).toHaveAttribute("download", `aivora-${deliveryOrderId}.mp4`);
    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`aivora-${deliveryOrderId}.mp4`);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect((await stat(downloadPath!)).size).toBeGreaterThan(0);

    const evidenceDir = path.join(
      process.cwd(),
      "qa/screenshots/phase1",
      process.env.GOLDEN_PATH_RUN_ID ?? "unknown-run",
    );
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "completed-video.png"), fullPage: true });
  });

  await test.step("verify account and workspace ownership", async () => {
    const account = await db.adminUser.findUnique({
      where: { email: GOLDEN_PATH_EMAIL },
      include: { workspace: true },
    });
    expect(account?.role).toBe("CUSTOMER");
    expect(account?.workspace?.planId).toBe("starter");
    const order = await db.deliveryOrder.findUnique({
      where: { id: deliveryOrderId },
      select: { createdById: true },
    });
    expect(order?.createdById).toBe(account?.id);
  });

  expect(clientErrors, "browser console/page errors").toEqual([]);
  expect(serverFailures, "HTTP 5xx responses observed by the page").toEqual([]);
  expect(failedRequests, "failed browser network requests").toEqual([]);

  const finalSummary = renderSummary as RenderSummary | null;
  await testInfo.attach("golden-path-summary", {
    body: Buffer.from(JSON.stringify({
      runId: process.env.GOLDEN_PATH_RUN_ID,
      deliveryOrderId,
      briefId,
      totalJobs: finalSummary?.totalJobs,
      finalVideoReady: Boolean(finalSummary?.finalVideoUrl),
      mockOnly: true,
      cancelledRscPrefetches,
    }, null, 2)),
    contentType: "application/json",
  });
});
