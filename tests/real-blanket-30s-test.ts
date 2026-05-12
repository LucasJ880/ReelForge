/**
 * Real 30s Blanket Video End-to-End Test —— Cozy Home Living.
 *
 * 严格成本契约（按用户原文）：
 *   - 恰好 1 个 creative direction（1 Round + 1 ContentAngle）
 *   - 恰好 2 个 Seedance segment job（segIdx 0/1，每段 15s）
 *   - 恰好 1 个 final stitched video（FinalVideo READY，Vercel Blob URL）
 *   - 0 盲重试（任一段失败 → 抛错暴露给人类，不自动二次扣费）
 *   - 0 多 variant race（不创建额外 ContentAngle / VideoJob）
 *
 * 真实 Provider 调用：
 *   - 1 × OpenAI script (gpt-5.5)        ← wizard-script-service 创建 VideoBrief 必经
 *   - 1 × OpenAI director (gpt-5.5)       ← director-service 生成 segmentPlan
 *   - 2 × Seedance T2V (15s each, 9:16)   ← dispatchMultiSegmentGeneration
 *   - 1 × 本地 ffmpeg                     ← stitch-service (STITCH_RUNTIME=local)
 *   - 1 × Vercel Blob upload              ← persistStitchedFile
 *
 * 估算成本：~$1.65 USD + ~¥4.5 RMB（具体看脚本输出 token 数）。
 *
 * 启动前置：
 *   - 不要设 LLM_FORCE_MOCK / VIDEO_ENGINE_MOCK / IMAGE_ENGINE_MOCK / DIRECTOR_FORCE_MOCK / SCRIPT_FORCE_MOCK
 *   - dev server 必须先启动并就绪：`STITCH_RUNTIME=local npm run dev`（默认走真实 Provider）
 *   - .env.local 必须有：OPENAI_API_KEY / ARK_API_KEY / BLOB_READ_WRITE_TOKEN / DATABASE_URL
 *
 * 运行：
 *   STITCH_RUNTIME=local npx dotenv -e .env.local -- \
 *     npx tsx tests/real-blanket-30s-test.ts
 *
 * 命名 .ts（非 .test.ts）— 不会被 npm test 默认收走。
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { ensureSingleDirectionRound } from "../src/lib/services/angle-service";
import { generateAndPersistWizardScript } from "../src/lib/services/wizard-script-service";
import { generateAndPersistDirectorPlan } from "../src/lib/services/director-service";
import {
  dispatchVideoForBrief,
  reconcileBriefRenderStatus,
} from "../src/lib/services/video-service";
import { stitchFinalVideo } from "../src/lib/services/stitch-service";
import { db } from "../src/lib/db";
import { VideoJobStatus, FinalVideoStatus } from "@prisma/client";
import type { ClientBrief } from "../src/lib/schemas/client-brief";

// ---------- env guards: 反向（拒绝 mock 模式） ----------

const MOCK_FLAGS: Array<[string, string | undefined]> = [
  ["LLM_FORCE_MOCK", process.env.LLM_FORCE_MOCK],
  ["VIDEO_ENGINE_MOCK", process.env.VIDEO_ENGINE_MOCK],
  ["IMAGE_ENGINE_MOCK", process.env.IMAGE_ENGINE_MOCK],
  ["DIRECTOR_FORCE_MOCK", process.env.DIRECTOR_FORCE_MOCK],
  ["SCRIPT_FORCE_MOCK", process.env.SCRIPT_FORCE_MOCK],
];
const offendingMock = MOCK_FLAGS.filter(
  ([, v]) => v != null && /^(true|1|yes)$/i.test(String(v).trim()),
);
if (offendingMock.length > 0) {
  console.error(
    "❌ Refusing to run REAL test — these mock flags are still ON: " +
      offendingMock.map(([k, v]) => `${k}=${v}`).join(", "),
  );
  console.error("   Unset them or use the mock walkthrough script instead.");
  process.exit(2);
}

const REQUIRED_ENV = ["OPENAI_API_KEY", "ARK_API_KEY", "BLOB_READ_WRITE_TOKEN", "DATABASE_URL"];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`❌ Missing required env: ${missingEnv.join(", ")}`);
  process.exit(2);
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const OUT_DIR = join(process.cwd(), "tmp", "real-test-evidence");
mkdirSync(OUT_DIR, { recursive: true });

// ---------- helper: HTTP (login + create project) ----------

async function loginAndGetCookie(): Promise<string> {
  const csrfRes = await fetch(APP_URL + "/api/auth/csrf");
  const setCookie1 = csrfRes.headers.get("set-cookie") ?? "";
  const csrfMatch = setCookie1.match(/next-auth\.csrf-token=([^;]+)/);
  const csrfCookieValue = csrfMatch?.[1] ?? "";
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  const csrfToken = csrfBody.csrfToken;

  const loginCookies = `next-auth.csrf-token=${csrfCookieValue}; next-auth.callback-url=${encodeURIComponent(APP_URL)}`;
  const params = new URLSearchParams();
  params.set("email", "iliaoyiyu@gmail.com");
  params.set("password", "mingzi520");
  params.set("csrfToken", csrfToken);
  params.set("callbackUrl", APP_URL + "/projects");
  params.set("json", "true");

  const res = await fetch(APP_URL + "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: loginCookies },
    body: params.toString(),
    redirect: "manual",
  });
  const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  let sessionToken = "";
  for (const c of setCookies) {
    const m = c.match(/next-auth\.session-token=([^;]+)/);
    if (m) sessionToken = m[1];
  }
  if (!sessionToken) {
    throw new Error(`Login failed: no session-token in set-cookie. status=${res.status}`);
  }
  return `next-auth.session-token=${sessionToken}; next-auth.csrf-token=${csrfCookieValue}`;
}

// ---------- 主流程 ----------

const BRIEF: ClientBrief = {
  businessName: `Cozy Home Living [REAL ${new Date().toISOString().slice(0, 16).replace("T", " ")}]`,
  industry: "home_goods",
  objective: "get_leads",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 30,
  brandTone: "warm",
  brandAssets: {
    ctaText: "Tap to shop the collection",
  },
  candidateCardSlugs: [],
  keyMessage:
    "A soft, plush winter blanket that makes any sofa or bed feel instantly cozy. Generous size, premium fleece, and a warm minimalist look.",
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
};

const TIMINGS: Record<string, number> = {};
function tic(label: string) {
  TIMINGS[label] = Date.now();
}
function toc(label: string): number {
  const t = TIMINGS[label];
  if (!t) return 0;
  const dt = Date.now() - t;
  delete TIMINGS[label];
  return dt;
}

async function main() {
  console.log("═════════════════════════════════════════════════════");
  console.log("  REAL 30s Blanket Video Test — Cozy Home Living");
  console.log("  PROVIDERS: OpenAI gpt-5.5 + Seedance T2V + ffmpeg local + Vercel Blob");
  console.log("  COST CONTRACT: 1 direction + 2 segments + 1 stitch, 0 retry");
  console.log("═════════════════════════════════════════════════════\n");

  // ---- 1. Login ----
  console.log(">>> Step 1/8: Login");
  tic("login");
  const cookies = await loginAndGetCookie();
  console.log(`    OK (${toc("login")}ms)\n`);

  // ---- 2. Create project ----
  console.log(">>> Step 2/8: Create Cozy Home Living project (REAL mode)");
  tic("create");
  const createRes = await fetch(APP_URL + "/api/wizard/projects", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies },
    body: JSON.stringify({ brief: BRIEF }),
  });
  if (createRes.status !== 201) {
    throw new Error(`Project create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const createBody = (await createRes.json()) as { id: string; title: string };
  const orderId = createBody.id;
  console.log(`    orderId=${orderId} title="${createBody.title}" (${toc("create")}ms)\n`);

  // ---- 3. ensureSingleDirectionRound ----
  console.log(">>> Step 3/8: ensureSingleDirectionRound (1 Round + 1 ContentAngle)");
  tic("round");
  const ensure = await ensureSingleDirectionRound(orderId);
  const roundCount = await db.round.count({ where: { deliveryOrderId: orderId } });
  const angleCount = await db.contentAngle.count({
    where: { round: { deliveryOrderId: orderId } },
  });
  if (roundCount !== 1 || angleCount !== 1) {
    throw new Error(`Expected 1 Round + 1 Angle, got ${roundCount} + ${angleCount}`);
  }
  console.log(`    Round.count=${roundCount} ContentAngle.count=${angleCount} created=${ensure.created} (${toc("round")}ms)\n`);

  // ---- 4. wizard-script-service (REAL gpt-5.5 SCRIPT call) ----
  console.log(">>> Step 4/8: generateAndPersistWizardScript (REAL gpt-5.5 SCRIPT)");
  tic("script");
  const scriptResult = await generateAndPersistWizardScript({ deliveryOrderId: orderId });
  const scriptDt = toc("script");
  console.log(`    scriptId=${scriptResult.scriptId}`);
  console.log(`    briefId=${scriptResult.videoBriefId}`);
  console.log(`    fromMock=${scriptResult.fromMock}`);
  console.log(`    duration=${scriptDt}ms\n`);
  if (scriptResult.fromMock) {
    throw new Error("scriptResult.fromMock === true — script call did NOT hit real OpenAI; aborting REAL test");
  }

  /// 把 targetDurationSec 显式设为 30
  await db.videoBrief.update({
    where: { id: scriptResult.videoBriefId },
    data: { targetDurationSec: 30 },
  });

  // ---- 5. director-service (REAL gpt-5.5 DIRECTOR call) ----
  console.log(">>> Step 5/8: generateAndPersistDirectorPlan (REAL gpt-5.5 DIRECTOR)");
  tic("director");
  const dpResult = await generateAndPersistDirectorPlan({
    videoBriefId: scriptResult.videoBriefId,
  });
  const directorDt = toc("director");
  console.log(`    fromMock=${dpResult.fromMock}`);
  console.log(`    segments=${dpResult.plan.segmentPlan.length}`);
  console.log(`    duration=${directorDt}ms`);
  if (dpResult.fromMock) {
    throw new Error("dpResult.fromMock === true — director call did NOT hit real OpenAI; aborting");
  }
  if (dpResult.plan.segmentPlan.length !== 2) {
    throw new Error(`Expected 2 segments, got ${dpResult.plan.segmentPlan.length}`);
  }
  for (const [i, seg] of dpResult.plan.segmentPlan.entries()) {
    console.log(`    seg[${i}] dur=${seg.durationSec}s role=${seg.role} prompt=${seg.seedancePrompt.slice(0, 80)}...`);
  }
  console.log("");

  // ---- 6. dispatchVideoForBrief (REAL Seedance × 2) ----
  console.log(">>> Step 6/8: dispatchVideoForBrief (submit 2× Seedance T2V real jobs)");
  tic("dispatch");
  await dispatchVideoForBrief(scriptResult.videoBriefId);
  const jobs = await db.videoJob.findMany({
    where: { videoBriefId: scriptResult.videoBriefId },
    orderBy: { segmentIndex: "asc" },
  });
  console.log(`    submitted=${jobs.length} jobs in ${toc("dispatch")}ms`);
  for (const j of jobs) {
    console.log(`      VideoJob ${j.id} segIdx=${j.segmentIndex} ${j.segmentDurationSec}s status=${j.status} externalJobId=${j.externalJobId}`);
  }
  if (jobs.length !== 2) {
    throw new Error(`Expected exactly 2 VideoJobs, got ${jobs.length}`);
  }
  const allReal = jobs.every((j) => j.externalJobId && !j.externalJobId.startsWith("mock_"));
  if (!allReal) {
    throw new Error(`Some jobs have mock externalJobId: ${jobs.map((j) => j.externalJobId).join(", ")}`);
  }
  console.log("");

  // ---- 7. Poll until both segments SUCCEEDED ----
  console.log(">>> Step 7/8: Poll Seedance status (15-min timeout per segment)");
  console.log("    polling every 20s; expected ~3-8 min per 15s clip");
  const POLL_INTERVAL_MS = 20_000;
  const POLL_MAX_MS = 25 * 60_000;
  const pollStart = Date.now();
  let pollCount = 0;
  let lastStatusKey = "";

  while (Date.now() - pollStart < POLL_MAX_MS) {
    pollCount += 1;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    await reconcileBriefRenderStatus(scriptResult.videoBriefId);
    const cur = await db.videoJob.findMany({
      where: { videoBriefId: scriptResult.videoBriefId },
      orderBy: { segmentIndex: "asc" },
    });
    const statusKey = cur.map((j) => `${j.segmentIndex}:${j.status}`).join(",");
    const elapsedSec = Math.floor((Date.now() - pollStart) / 1000);
    if (statusKey !== lastStatusKey) {
      console.log(`    [${elapsedSec}s] poll#${pollCount} ${statusKey}`);
      lastStatusKey = statusKey;
    } else if (pollCount % 5 === 0) {
      console.log(`    [${elapsedSec}s] poll#${pollCount} (no status change)`);
    }

    if (cur.some((j) => j.status === VideoJobStatus.FAILED)) {
      const failed = cur.filter((j) => j.status === VideoJobStatus.FAILED);
      throw new Error(
        `❌ A segment FAILED — refusing to retry (cost contract).\n` +
          failed.map((j) => `  segIdx=${j.segmentIndex}: ${j.errorMessage}`).join("\n"),
      );
    }
    if (cur.every((j) => j.status === VideoJobStatus.SUCCEEDED)) {
      console.log(`    ✅ All 2 segments SUCCEEDED after ${elapsedSec}s\n`);
      break;
    }
  }

  /// final state check
  const finalJobs = await db.videoJob.findMany({
    where: { videoBriefId: scriptResult.videoBriefId },
    orderBy: { segmentIndex: "asc" },
  });
  if (!finalJobs.every((j) => j.status === VideoJobStatus.SUCCEEDED)) {
    throw new Error(
      `Polling timed out after 25 min; jobs not all SUCCEEDED:\n` +
        finalJobs.map((j) => `  segIdx=${j.segmentIndex} status=${j.status} url=${j.outputVideoUrl?.slice(0, 80)}`).join("\n"),
    );
  }
  for (const j of finalJobs) {
    console.log(`    seg[${j.segmentIndex}] outputVideoUrl=${j.outputVideoUrl?.slice(0, 100)}...`);
  }
  console.log("");

  // ---- 8. stitchFinalVideo (local ffmpeg + Vercel Blob upload) ----
  console.log(">>> Step 8/8: stitchFinalVideo (local ffmpeg + Vercel Blob upload)");
  const finalVideoIdRef = finalJobs[0]?.finalVideoId;
  if (!finalVideoIdRef) {
    throw new Error("No FinalVideo bound to brief; dispatchMultiSegmentGeneration didn't create one");
  }

  /// Note: reconcileVideoJob 在最后一段 SUCCEEDED 时会 inline 触发一次 stitch；
  /// 但为了 deterministic / 可观测，我们重置后再手动调一次 stitchFinalVideo
  const fvBefore = await db.finalVideo.findUnique({ where: { id: finalVideoIdRef } });
  console.log(`    finalVideoId=${finalVideoIdRef} status_before=${fvBefore?.status}`);
  if (fvBefore?.status !== FinalVideoStatus.READY) {
    /// 先 reset 防止有半成品 ffmpegError 留下
    await db.finalVideo.update({
      where: { id: finalVideoIdRef },
      data: {
        status: FinalVideoStatus.PENDING,
        ffmpegError: null,
        stitchedVideoUrl: null,
        thumbnailUrl: null,
        finishedAt: null,
      },
    });
    tic("stitch");
    const stitchResult = await stitchFinalVideo(finalVideoIdRef);
    console.log(`    stitch result: ${JSON.stringify(stitchResult)} (${toc("stitch")}ms)`);
  } else {
    console.log("    FinalVideo already READY (auto-stitched on last SUCCEEDED reconcile)");
  }

  const fvAfter = await db.finalVideo.findUnique({ where: { id: finalVideoIdRef } });
  if (!fvAfter || fvAfter.status !== FinalVideoStatus.READY || !fvAfter.stitchedVideoUrl) {
    throw new Error(
      `FinalVideo not READY: status=${fvAfter?.status} ffmpegError=${fvAfter?.ffmpegError}`,
    );
  }
  if (
    !fvAfter.stitchedVideoUrl.startsWith("https://") ||
    !(fvAfter.stitchedVideoUrl.includes(".vercel-storage.com") ||
      fvAfter.stitchedVideoUrl.includes("blob.vercel-storage"))
  ) {
    throw new Error(`stitchedVideoUrl is not a Vercel Blob https URL: ${fvAfter.stitchedVideoUrl}`);
  }

  // ---- Final report ----
  const totalMs = Math.floor((Date.now() - TIMINGS.__start) / 1000);
  console.log("\n═════════════════════════════════════════════════════");
  console.log("  ✅ REAL 30s BLANKET TEST — PASSED");
  console.log("═════════════════════════════════════════════════════");
  console.log(`  orderId          = ${orderId}`);
  console.log(`  briefId          = ${scriptResult.videoBriefId}`);
  console.log(`  finalVideoId     = ${finalVideoIdRef}`);
  console.log(`  status           = ${fvAfter.status}`);
  console.log(`  duration_target  = 30s`);
  console.log(`  segments         = 2 × 15s`);
  console.log(`  customer_url     = ${APP_URL}/projects/${orderId}`);
  console.log(`  raw_blob_url     = ${fvAfter.stitchedVideoUrl}`);
  if (fvAfter.thumbnailUrl) {
    console.log(`  thumbnail_url    = ${fvAfter.thumbnailUrl}`);
  }
  console.log("");
  console.log("  Provider calls actually made:");
  console.log(`    1 × OpenAI script    (${scriptDt}ms)`);
  console.log(`    1 × OpenAI director  (${directorDt}ms)`);
  console.log(`    2 × Seedance T2V     (~${Math.floor((Date.now() - pollStart) / 1000)}s wall, polling)`);
  console.log(`    1 × ffmpeg + Blob    (local + uploaded)`);
  console.log("");

  /// 写一份 summary 给 user 留底
  writeFileSync(
    join(OUT_DIR, "real-test-summary.json"),
    JSON.stringify(
      {
        orderId,
        briefId: scriptResult.videoBriefId,
        finalVideoId: finalVideoIdRef,
        stitchedVideoUrl: fvAfter.stitchedVideoUrl,
        thumbnailUrl: fvAfter.thumbnailUrl,
        customerUrl: `${APP_URL}/projects/${orderId}`,
        timings: { scriptMs: scriptDt, directorMs: directorDt, totalSec: totalMs },
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`  Summary saved: ${OUT_DIR}/real-test-summary.json\n`);
}

TIMINGS.__start = Date.now();
main().catch((err) => {
  console.error("\n❌ REAL TEST FAILED:");
  console.error(err);
  process.exit(1);
});
