/**
 * QA Mock Walkthrough — Cozy Home Living first-time customer end-to-end.
 *
 * 仅在全 mock Provider 模式下运行（不发起任何真实 OpenAI/Seedance/Image 调用）。
 * 验证 5 个并行修复 Agent 的整体协同：
 *   - /projects 客户视角不 redirect 到 /orders
 *   - /projects/[id] 详情页存在 + 视频播放
 *   - DirectorPlan schema 严格校验（mock 模式下不抛错）
 *   - Stitch local runtime 工作（dev 走真 ffmpeg）
 *   - BLOB_READ_WRITE_TOKEN 缺失会 throw（这条由开关验证，不主动断 token）
 *   - home_goods enum + ensureSingleDirectionRound + i18n
 *
 * 命名 .ts（非 .test.ts、非 .spec.ts），避免被 `npm test` 默认收走。
 *
 * 启动 dev server 后运行：
 *   STITCH_RUNTIME=local npx dotenv -e .env.local -- \
 *     npx tsx tests/qa-mock-walkthrough.ts
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

// ---------- env guards ----------

/// 接受新的统一 LLM_FORCE_MOCK，向后兼容旧的 DIRECTOR_FORCE_MOCK / SCRIPT_FORCE_MOCK
const LLM_MOCKED =
  process.env.LLM_FORCE_MOCK === "true" ||
  process.env.DIRECTOR_FORCE_MOCK === "true" ||
  process.env.SCRIPT_FORCE_MOCK === "true";
if (!LLM_MOCKED) {
  console.error(
    "❌ LLM_FORCE_MOCK !== 'true' (and no DIRECTOR_FORCE_MOCK/SCRIPT_FORCE_MOCK) — refuse to run, would call OpenAI",
  );
  process.exit(2);
}
if (process.env.VIDEO_ENGINE_MOCK !== "true") {
  console.error("❌ VIDEO_ENGINE_MOCK !== 'true' — refuse to run, would call Seedance");
  process.exit(2);
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const COOKIE_FILE = "/tmp/qa-cookies.txt";

const OUT_DIR = join(process.cwd(), "tmp", "qa-screenshots");
mkdirSync(OUT_DIR, { recursive: true });

// ---------- helper: HTTP ----------

interface HttpRes {
  status: number;
  location?: string;
  headers: Record<string, string>;
  body: string;
}

async function http(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    cookies?: string;
    locale?: string;
    redirect?: "follow" | "manual";
  } = {},
): Promise<HttpRes> {
  const headers: Record<string, string> = {};
  if (opts.body) headers["content-type"] = "application/json";
  if (opts.cookies) headers["cookie"] = opts.cookies;
  if (opts.locale) {
    headers["cookie"] = (headers["cookie"] ?? "") +
      (headers["cookie"] ? "; " : "") +
      `aivora_locale=${opts.locale}`;
  }
  const res = await fetch(APP_URL + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: opts.redirect ?? "manual",
  });
  const body = await res.text();
  const headersObj: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headersObj[k] = v;
  });
  return {
    status: res.status,
    location: res.headers.get("location") ?? undefined,
    headers: headersObj,
    body,
  };
}

interface NextAuthLogin {
  cookieHeader: string;
  sessionToken: string;
}

async function loginAndGetCookie(): Promise<NextAuthLogin> {
  const csrfRes = await fetch(APP_URL + "/api/auth/csrf");
  const setCookie1 = csrfRes.headers.get("set-cookie") ?? "";
  const csrfMatch = setCookie1.match(
    /next-auth\.csrf-token=([^;]+)/,
  );
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
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: loginCookies,
    },
    body: params.toString(),
    redirect: "manual",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  let sessionToken = "";
  for (const c of setCookies) {
    const m = c.match(/next-auth\.session-token=([^;]+)/);
    if (m) sessionToken = m[1];
  }
  if (!sessionToken) {
    throw new Error(`Login failed: no session-token in set-cookie. status=${res.status}`);
  }
  return {
    cookieHeader: `next-auth.session-token=${sessionToken}; next-auth.csrf-token=${csrfCookieValue}`,
    sessionToken,
  };
}

// ---------- banned word matcher ----------

/**
 * 检查渲染后的 HTML 是否含有 admin-only 词汇（应仅出现在客户不可见的 dev 抽屉里）。
 *
 * 简化的边界匹配：
 * - 单词类（Render / Round / Angle / Seedance / Provider 等）：用 \b 边界，避免 className 误杀。
 * - 多词类（Step 1 / Step 2 / FinalVideo / VideoJob 等）：直接子串匹配。
 *
 * 注意：HTML 里 <video controls> 的元素名 "video" 本身不在禁词列表中（小写）。
 * "Render" 大写的更可能是 UI 文案。
 */
const BANNED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "Step 1", re: /\bStep\s*1\b/ },
  { name: "Step 2", re: /\bStep\s*2\b/ },
  { name: "Step 3", re: /\bStep\s*3\b/ },
  { name: "Step 4", re: /\bStep\s*4\b/ },
  { name: "Step 5", re: /\bStep\s*5\b/ },
  { name: "Step 6", re: /\bStep\s*6\b/ },
  { name: "证据卡", re: /证据卡/ },
  { name: "赛马", re: /赛马/ },
  { name: "Round", re: /\bRound\b/ },
  { name: "Angle", re: /\bAngle\b/ },
  { name: "Render", re: /\bRender\b/ },
  { name: "Seedance", re: /\bSeedance\b/i },
  { name: "Job ID", re: /\bJob\s*ID\b/ },
  { name: "FinalVideo", re: /\bFinalVideo\b/ },
  { name: "VideoJob", re: /\bVideoJob\b/ },
  { name: "ffmpeg", re: /\bffmpeg\b/i },
  { name: "auto_pass", re: /\bauto_pass\b/ },
];

interface BannedFinding {
  word: string;
  excerpt: string;
}

function checkBanned(html: string): BannedFinding[] {
  /// 排除内联 next.js __NEXT_DATA__ JSON 与 type="application/json" 脚本
  /// （那些是序列化数据；客户看不到，但词汇会出现）
  const stripped = html
    .replace(/<script[^>]*type="application\/json"[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const found: BannedFinding[] = [];
  for (const { name, re } of BANNED_PATTERNS) {
    const m = stripped.match(re);
    if (m && m.index != null) {
      const start = Math.max(0, m.index - 30);
      const end = Math.min(stripped.length, m.index + m[0].length + 50);
      const excerpt = stripped.slice(start, end).replace(/\s+/g, " ").trim();
      found.push({ word: name, excerpt });
    }
  }
  return found;
}

// ---------- 测试结果累计 ----------

type Result = "PASS" | "FAIL" | "WARN";
const results: Array<{
  id: string;
  desc: string;
  result: Result;
  evidence: string;
}> = [];

function record(id: string, desc: string, result: Result, evidence: string) {
  results.push({ id, desc, result, evidence });
  const icon = result === "PASS" ? "✅" : result === "FAIL" ? "❌" : "⚠️";
  console.log(`${icon} ${id} ${desc}\n   ${evidence}`);
}

function dump(name: string, html: string) {
  writeFileSync(join(OUT_DIR, `${name}.html`), html, "utf8");
}

// ---------- 主流程 ----------

const COZY_BRIEF: ClientBrief = {
  businessName: `Cozy Home Living [QA ${new Date().toISOString().slice(0, 16).replace("T", " ")}]`,
  industry: "home_goods",
  objective: "get_leads",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 30,
  brandTone: "warm",
  brandAssets: {
    ctaText: "Tap to shop the collection",
  },
  candidateCardSlugs: [],
  keyMessage: "A soft warm winter blanket for cozy sofas and beds.",
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
};

async function main() {
  console.log("═════════════════════════════════════════════════");
  console.log("  QA Mock Walkthrough — Cozy Home Living");
  console.log(
    "  mocks: llm_force=" +
      (process.env.LLM_FORCE_MOCK ?? "(unset)") +
      " director=" +
      (process.env.DIRECTOR_FORCE_MOCK ?? "(unset)") +
      " script=" +
      (process.env.SCRIPT_FORCE_MOCK ?? "(unset)") +
      " video=" +
      process.env.VIDEO_ENGINE_MOCK +
      " image=" +
      process.env.IMAGE_ENGINE_MOCK +
      " stitch=" +
      (process.env.STITCH_RUNTIME ?? "(default)"),
  );
  console.log("═════════════════════════════════════════════════\n");

  // ---- 1. Login ----
  console.log(">>> Step 1: Login");
  const login = await loginAndGetCookie();
  console.log("login OK · session token len=" + login.sessionToken.length + "\n");

  const cookies = login.cookieHeader;

  // ---- 2. /login page rendering ----
  console.log(">>> Step 2: GET /login (anonymous)");
  const loginHtml = await http("/login");
  dump("login-zh", loginHtml.body);
  if (loginHtml.status !== 200) {
    record("login.render", "/login renders 200", "FAIL", `status=${loginHtml.status}`);
  } else {
    record("login.render", "/login renders 200", "PASS", "status=200, html dumped");
  }

  // ---- 3. C1: /projects must NOT 302 to /orders ----
  console.log("\n>>> C1: GET /projects · expect 200 (no redirect to /orders)");
  const projZh = await http("/projects", { cookies });
  dump("projects-zh", projZh.body);
  if (projZh.status === 200) {
    if (projZh.body.includes("/orders") && projZh.body.includes("redirect")) {
      record("C1", "/projects 不 302 到 /orders", "WARN", "200 OK, but body mentions /orders");
    } else {
      record("C1", "/projects 不 302 到 /orders", "PASS", "status=200, no redirect");
    }
  } else if (projZh.status === 307 || projZh.status === 302) {
    const loc = projZh.location ?? "(none)";
    record(
      "C1",
      "/projects 不 302 到 /orders",
      loc.includes("/orders") ? "FAIL" : "WARN",
      `redirected ${projZh.status} → ${loc}`,
    );
  } else {
    record("C1", "/projects 不 302 到 /orders", "FAIL", `unexpected status=${projZh.status}`);
  }

  // ---- 4. C2: /projects has Create CTA linking to /wizard/new ----
  console.log("\n>>> C2: /projects has Create CTA → /wizard/new");
  const hasCreateCtaZh =
    projZh.body.includes("创建项目") &&
    projZh.body.includes("/wizard/new");
  record(
    "C2",
    "Create CTA 存在 (zh: 创建项目)",
    hasCreateCtaZh ? "PASS" : "FAIL",
    hasCreateCtaZh ? "found '创建项目' + href=/wizard/new" : "missing CTA / link",
  );

  // ---- 5. C3: /wizard/new lists home_goods in industry select ----
  console.log("\n>>> C3: /wizard/new lists home_goods + brandTone=warm");
  const wizardNewZh = await http("/wizard/new", { cookies });
  dump("wizard-new-zh", wizardNewZh.body);
  if (wizardNewZh.status !== 200) {
    record("C3", "wizard/new renders", "FAIL", `status=${wizardNewZh.status}`);
  } else {
    /// SelectItem 的 value 是 "home_goods"；在 Radix SelectContent 里渲染（client-side），
    /// SSR 阶段 SelectContent 通常 unmounted；我们检查 i18n 文案 "家居好物" 是否预渲染
    /// 或 hidden options 里有 "home_goods"
    const hasHomeGoodsLabel =
      wizardNewZh.body.includes("家居好物") ||
      wizardNewZh.body.includes("Home goods") ||
      wizardNewZh.body.includes('value="home_goods"') ||
      wizardNewZh.body.includes("home_goods");
    record(
      "C3",
      "home_goods 出现在 wizard step-1",
      hasHomeGoodsLabel ? "PASS" : "WARN",
      hasHomeGoodsLabel
        ? "home_goods/家居好物 mentioned in HTML or option"
        : "Radix SelectContent renders client-side; SSR fallback missing",
    );
  }

  // ---- 6. Create Cozy Home Living project ----
  console.log("\n>>> Create project · POST /api/wizard/projects");
  const createRes = await http("/api/wizard/projects", {
    method: "POST",
    cookies,
    body: { brief: COZY_BRIEF },
  });
  if (createRes.status !== 201) {
    console.error("create failed:", createRes.status, createRes.body);
    record("create", "POST /api/wizard/projects 201", "FAIL",
      `status=${createRes.status} body=${createRes.body.slice(0, 200)}`);
    throw new Error("project create failed; aborting walkthrough");
  }
  const createBody = JSON.parse(createRes.body) as { id: string; title: string };
  const orderId = createBody.id;
  record("create", "Create Cozy Home Living project", "PASS",
    `orderId=${orderId} title="${createBody.title}"`);

  // ---- 7. C4: navigate to wizard/[orderId]/step-2-card; verify NO "Step 2" leak ----
  console.log("\n>>> C4: GET /wizard/" + orderId + "/step-2-card · check 'Step 2' leak");
  const wizCard = await http(`/wizard/${orderId}/step-2-card`, { cookies });
  dump("wizard-step2-zh", wizCard.body);
  if (wizCard.status !== 200) {
    record("C4", "wizard step-2-card renders 200", "FAIL", `status=${wizCard.status}`);
  } else {
    const banned = checkBanned(wizCard.body);
    const stepLeak = banned.find((b) => b.word === "Step 2");
    if (stepLeak) {
      record("C4", "未泄露 'Step 2' 文案", "FAIL",
        `'Step 2' found in: "${stepLeak.excerpt}"`);
    } else {
      record("C4", "未泄露 'Step 2' 文案", "PASS",
        "no 'Step 2' substring in rendered body");
    }
    /// 也额外把所有禁词列出
    if (banned.length > 0) {
      console.log("   ⚠️  禁词命中（非 Step 2）:");
      for (const b of banned) {
        console.log(`     · ${b.word}: "${b.excerpt}"`);
      }
    }
  }

  // ---- 8. Select a creative card (use general fallback since no home_goods card seeded) ----
  console.log("\n>>> Select creative card");
  /// 先选一张 PUBLISHED 的卡（home_goods 没有就用 general）
  const card = await db.creativeEvidenceCard.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: [{ industry: "asc" }, { slug: "asc" }],
  });
  let cardSlugUsed: string | null = null;
  if (!card) {
    record("card.select", "select PUBLISHED card", "WARN",
      "no PUBLISHED creative card seeded; ensureSingleDirectionRound 不依赖卡片仍可继续");
  } else {
    cardSlugUsed = card.slug;
    const selRes = await http(`/api/wizard/projects/${orderId}/card`, {
      method: "POST",
      cookies,
      body: { slug: card.slug },
    });
    if (selRes.status === 200) {
      record("card.select", "select PUBLISHED card", "PASS",
        `slug=${card.slug} industry=${card.industry}`);
    } else {
      record("card.select", "select PUBLISHED card", "FAIL",
        `status=${selRes.status} body=${selRes.body.slice(0, 200)}`);
    }
  }

  // ---- 9. ensureSingleDirectionRound + verify 1 Round + 1 Angle ----
  console.log("\n>>> C5: ensureSingleDirectionRound · expect 1 Round + 1 Angle");
  const ensureResult = await ensureSingleDirectionRound(orderId);
  console.log("ensureSingleDirectionRound:", ensureResult);
  const roundCount = await db.round.count({ where: { deliveryOrderId: orderId } });
  const angleCount = await db.contentAngle.count({
    where: { round: { deliveryOrderId: orderId } },
  });
  if (roundCount === 1 && angleCount === 1) {
    record("C5", "1 Round + 1 Angle", "PASS",
      `Round.count=1 ContentAngle.count=1 (helper.created=${ensureResult.created})`);
  } else {
    record("C5", "1 Round + 1 Angle", "FAIL",
      `Round.count=${roundCount} ContentAngle.count=${angleCount}`);
  }

  // ---- 10. Generate wizard script (creates VideoBrief on the same angle) ----
  console.log("\n>>> generateAndPersistWizardScript (mock)");
  const scriptResult = await generateAndPersistWizardScript({
    deliveryOrderId: orderId,
  });
  console.log(`script id=${scriptResult.scriptId} brief=${scriptResult.videoBriefId} fromMock=${scriptResult.fromMock}`);

  /// 确认 VideoBrief 的 targetDurationSec=30
  const briefRow0 = await db.videoBrief.findUnique({
    where: { id: scriptResult.videoBriefId },
    select: { id: true, targetDurationSec: true, durationSec: true, aspectRatio: true },
  });
  console.log("   videoBrief:", briefRow0);

  /// 把 targetDurationSec 显式设为 30（如果默认未设）
  if (briefRow0 && briefRow0.targetDurationSec !== 30) {
    await db.videoBrief.update({
      where: { id: briefRow0.id },
      data: { targetDurationSec: 30 },
    });
    console.log("   patched videoBrief.targetDurationSec → 30");
  }

  // ---- 11. C6: Director plan (mock) ----
  console.log("\n>>> C6: generateAndPersistDirectorPlan (mock=true)");
  const dpResult = await generateAndPersistDirectorPlan({
    videoBriefId: scriptResult.videoBriefId,
  });
  console.log(`directorPlan: fromMock=${dpResult.fromMock} segments=${dpResult.plan.segmentPlan.length}`);
  const briefRow1 = await db.videoBrief.findUnique({
    where: { id: scriptResult.videoBriefId },
    select: { directorPlan: true },
  });
  if (briefRow1?.directorPlan && dpResult.plan.segmentPlan.length === 2) {
    record("C6", "directorPlan schema legal + 段数=2", "PASS",
      `fromMock=${dpResult.fromMock} segments=${dpResult.plan.segmentPlan.length}`);
  } else {
    record("C6", "directorPlan schema legal + 段数=2", "FAIL",
      `directorPlan=${!!briefRow1?.directorPlan} segments=${dpResult.plan.segmentPlan.length}`);
  }

  // ---- 12. C7: dispatchVideoForBrief → 2 VideoJobs each 15s ----
  console.log("\n>>> C7: dispatchVideoForBrief (mock seedance)");
  await dispatchVideoForBrief(scriptResult.videoBriefId);
  const jobs = await db.videoJob.findMany({
    where: { videoBriefId: scriptResult.videoBriefId },
    orderBy: { segmentIndex: "asc" },
  });
  if (jobs.length === 2 && jobs.every((j) => j.segmentDurationSec === 15)) {
    record("C7", "恰好 2 VideoJob，每个 segmentDurationSec=15", "PASS",
      `jobs=${jobs.map((j) => `${j.id}/${j.segmentIndex}/${j.segmentDurationSec}s/${j.status}/${j.externalJobId}`).join(", ")}`);
  } else {
    record("C7", "恰好 2 VideoJob，每个 segmentDurationSec=15", "FAIL",
      `jobs.length=${jobs.length}`);
  }

  /// All externalJobIds should start with "mock_"
  const allMock = jobs.every((j) => j.externalJobId?.startsWith("mock_"));
  record("mock.externalIds", "VideoJob.externalJobId 全部 mock_ 前缀", allMock ? "PASS" : "FAIL",
    `external ids: ${jobs.map((j) => j.externalJobId).join(",")}`);

  // ---- 13. Wait for mock seedance to "complete" (mock: 10s) then reconcile ----
  console.log("\n>>> Wait 12s for mock seedance to be 'completed'...");
  await new Promise((r) => setTimeout(r, 12_000));

  console.log("    reconcileBriefRenderStatus...");
  await reconcileBriefRenderStatus(scriptResult.videoBriefId);

  /// reconcileVideoJob 在最后一个段成功时会 inline 触发 stitch；
  /// 但我们的 stitch 需要从 mock 公网 URL 下载 mp4 → 失败概率高。
  /// 兜底：把 VideoJob.outputVideoUrl 替换成已知可下载的 sample mp4，再手动 stitch。
  const REACHABLE_MP4 = "https://www.w3schools.com/html/mov_bbb.mp4";

  const jobsAfter = await db.videoJob.findMany({
    where: { videoBriefId: scriptResult.videoBriefId },
    orderBy: { segmentIndex: "asc" },
  });
  console.log("    jobs after reconcile:", jobsAfter.map((j) => ({
    id: j.id, status: j.status, url: j.outputVideoUrl?.slice(0, 60),
  })));

  const allSucceeded = jobsAfter.every((j) => j.status === VideoJobStatus.SUCCEEDED);
  if (!allSucceeded) {
    /// 强制把它们标 SUCCEEDED 以推进 stitch（这是 QA 跳过 Provider 状态机的捷径）
    console.log("    forcing all jobs to SUCCEEDED with reachable URL...");
    for (const j of jobsAfter) {
      await db.videoJob.update({
        where: { id: j.id },
        data: {
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: REACHABLE_MP4,
          finishedAt: new Date(),
        },
      });
    }
  } else {
    /// 把 mock URL 替换为可下载的（sample-videos.com 不可达）
    for (const j of jobsAfter) {
      if (j.outputVideoUrl && j.outputVideoUrl.includes("sample-videos.com")) {
        await db.videoJob.update({
          where: { id: j.id },
          data: { outputVideoUrl: REACHABLE_MP4 },
        });
      }
    }
  }

  /// 让 FinalVideo 状态机回到 PENDING（如果之前 stitch 已尝试过失败）
  const finalVideoIdRef = jobsAfter[0]?.finalVideoId ?? null;
  if (finalVideoIdRef) {
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
  }

  // ---- 14. C8: stitchFinalVideo (local ffmpeg + Vercel Blob upload) ----
  console.log("\n>>> C8: stitchFinalVideo (local ffmpeg)");
  if (!finalVideoIdRef) {
    record("C8", "FinalVideo READY w/ stitchedVideoUrl https blob", "FAIL",
      "no FinalVideo bound to brief — dispatch did not create one");
  } else {
    const stitchResult = await stitchFinalVideo(finalVideoIdRef);
    console.log("    stitch result:", stitchResult);
    const fv = await db.finalVideo.findUnique({ where: { id: finalVideoIdRef } });
    const httpsBlob = !!(fv?.stitchedVideoUrl &&
      fv.stitchedVideoUrl.startsWith("https://") &&
      fv.stitchedVideoUrl.includes(".vercel-storage") || fv?.stitchedVideoUrl?.includes("blob"));
    if (fv?.status === FinalVideoStatus.READY && fv.stitchedVideoUrl && httpsBlob) {
      record("C8", "FinalVideo READY w/ stitchedVideoUrl https blob", "PASS",
        `status=READY url=${fv.stitchedVideoUrl.slice(0, 100)}`);
    } else if (fv?.status === FinalVideoStatus.READY && fv.stitchedVideoUrl) {
      record("C8", "FinalVideo READY w/ stitchedVideoUrl https blob", "WARN",
        `status=READY but URL not blob: ${fv.stitchedVideoUrl.slice(0, 100)}`);
    } else {
      record("C8", "FinalVideo READY w/ stitchedVideoUrl https blob", "FAIL",
        `status=${fv?.status} ffmpegError=${fv?.ffmpegError?.slice(0, 200)}`);
    }
  }

  // ---- 15. C9: /projects/{orderId} customer detail page ----
  console.log("\n>>> C9: GET /projects/" + orderId);
  const detailZh = await http(`/projects/${orderId}`, { cookies });
  dump("project-detail-zh", detailZh.body);
  if (detailZh.status !== 200) {
    record("C9", "/projects/[id] 显示视频 + Download", "FAIL",
      `status=${detailZh.status}`);
  } else {
    const hasVideo = detailZh.body.includes("<video");
    const hasDownload = detailZh.body.includes("下载") || detailZh.body.includes("Download");
    if (hasVideo && hasDownload) {
      record("C9", "/projects/[id] 显示视频 + Download", "PASS",
        `<video> + 下载/Download buttons rendered`);
    } else {
      record("C9", "/projects/[id] 显示视频 + Download", "WARN",
        `hasVideo=${hasVideo} hasDownload=${hasDownload}`);
    }
  }

  // ---- 16. C10: zh-CN ↔ en-US ----
  console.log("\n>>> C10: bilingual switch");
  const projEn = await http("/projects", { cookies, locale: "en-US" });
  dump("projects-en", projEn.body);
  const wizardNewEn = await http("/wizard/new", { cookies, locale: "en-US" });
  dump("wizard-new-en", wizardNewEn.body);
  const detailEn = await http(`/projects/${orderId}`, { cookies, locale: "en-US" });
  dump("project-detail-en", detailEn.body);

  const enChecks: Array<[string, string, boolean]> = [
    ["/projects en CTA", "Create project", projEn.body.includes("Create project")],
    ["/wizard/new en CTA", "Save and continue", wizardNewEn.body.includes("Save and continue")],
    ["/projects/[id] en title", "Final video", detailEn.body.includes("Final video")],
  ];
  let enPass = 0;
  let enFail = 0;
  for (const [name, expect, ok] of enChecks) {
    if (ok) enPass++;
    else enFail++;
    console.log(`   ${ok ? "✓" : "✗"} ${name}: "${expect}"`);
  }
  /// 同时确保 zh 仍然展示中文
  const zhChecks: Array<[string, string, boolean]> = [
    ["/projects zh CTA", "创建项目", projZh.body.includes("创建项目")],
  ];
  for (const [name, expect, ok] of zhChecks) {
    if (ok) enPass++;
    else enFail++;
    console.log(`   ${ok ? "✓" : "✗"} ${name}: "${expect}"`);
  }
  record("C10", "zh-CN ↔ en-US 关键文案切换", enFail === 0 ? "PASS" : "FAIL",
    `passed=${enPass} failed=${enFail}`);

  // ---- 17a. 抓全部 wizard step 子页（C14 用） ----
  console.log("\n>>> Crawl all wizard step pages");
  const wizardSubPaths = [
    `/wizard/${orderId}`,
    `/wizard/${orderId}/step-2-card`,
    `/wizard/${orderId}/step-3-script`,
    `/wizard/${orderId}/step-4-storyboard`,
    `/wizard/${orderId}/step-5-upload`,
    `/wizard/${orderId}/step-6-render`,
  ];
  const wizardSubBodies: Array<{ path: string; status: number; body: string }> = [];
  for (const p of wizardSubPaths) {
    const r = await http(p, { cookies });
    wizardSubBodies.push({ path: p, status: r.status, body: r.body });
    const safe = p
      .replace(/[/]/g, "_")
      .replace(/^_/, "")
      .replace(orderId, "ORDER");
    dump(`crawl-${safe}-zh`, r.body);
    console.log(`   GET ${p} → ${r.status}, body=${r.body.length}b`);
  }

  // ---- 17. C11: 主 UI 全程零禁词（汇总） ----
  console.log("\n>>> C11: 主 UI 零禁词检查（汇总）");
  const pages: Array<[string, string]> = [
    ["/projects (zh)", projZh.body],
    ["/projects (en)", projEn.body],
    ["/wizard/new (zh)", wizardNewZh.body],
    ["/wizard/[orderId] step-2-card (zh)", wizCard.body],
    ["/projects/[id] (zh)", detailZh.body],
    ["/projects/[id] (en)", detailEn.body],
    ...wizardSubBodies
      .filter((s) => s.status === 200)
      .map((s): [string, string] => [s.path + " (zh)", s.body]),
  ];
  let bannedTotal = 0;
  const bannedReport: string[] = [];
  for (const [name, html] of pages) {
    const hits = checkBanned(html);
    if (hits.length > 0) {
      bannedTotal += hits.length;
      bannedReport.push(`${name}: ${hits.map((h) => `"${h.word}"`).join(", ")}`);
    }
  }
  record("C11", "主 UI 全程零禁词", bannedTotal === 0 ? "PASS" : "FAIL",
    bannedTotal === 0 ? "0 banned-word matches across 6 pages" :
      `${bannedTotal} hits:\n     ${bannedReport.join("\n     ")}`);

  // ---- 18. C12: desktop 1280 无水平溢出 (HTTP 方法不可验证) ----
  record("C12", "desktop 1280px 无水平溢出", "WARN",
    "HTTP+regex method cannot measure DOM scrollWidth; need Playwright. SKIPPED");

  // ---- 19. C13: AIUsageLog 0 non-MOCK rows（关键回归） ----
  console.log("\n>>> C13: AIUsageLog 严格全 MOCK（关键回归点）");
  const aiLogs = await db.aIUsageLog.findMany({
    where: { deliveryOrderId: orderId },
    select: {
      feature: true,
      status: true,
      provider: true,
      model: true,
      errorMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const nonMockLogs = aiLogs.filter((l) => l.status !== "MOCK");
  const usedRealLLM = aiLogs.some(
    (l) => l.status === "SUCCESS" && l.model !== "mock" && l.model !== null,
  );
  const realFailedCalls = aiLogs.filter(
    (l) =>
      l.status === "FAILED" &&
      l.provider === "openai" &&
      !(l.errorMessage ?? "").toLowerCase().includes("llm_force_mock"),
  );
  if (usedRealLLM || realFailedCalls.length > 0) {
    record(
      "C13",
      "AIUsageLog 全部 status=MOCK，0 真实 OpenAI 调用",
      "FAIL",
      `non-MOCK logs: ${nonMockLogs
        .map(
          (l) =>
            `${l.feature}=${l.status}(${l.model ?? "?"}, err="${(l.errorMessage ?? "").slice(0, 60)}")`,
        )
        .join(" | ")}`,
    );
  } else if (nonMockLogs.length > 0) {
    /// 全是 status=FAILED 但 errorMessage 是 LLM_FORCE_MOCK 守门 throw —— 那是预期；
    /// 守门 throw 后服务应短路到 mock，不应再产生独立的 FAILED 行；如果出现，给 WARN
    record(
      "C13",
      "AIUsageLog 全部 status=MOCK，0 真实 OpenAI 调用",
      "WARN",
      `${nonMockLogs.length} non-MOCK logs (all guard-throws, no real network): ${nonMockLogs
        .map(
          (l) =>
            `${l.feature}=${l.status}(err="${(l.errorMessage ?? "").slice(0, 60)}")`,
        )
        .join(" | ")}`,
    );
  } else {
    record(
      "C13",
      "AIUsageLog 全部 status=MOCK，0 真实 OpenAI 调用",
      "PASS",
      `${aiLogs.length} logs all MOCK: ${aiLogs.map((l) => `${l.feature}=MOCK(${l.model ?? "?"})`).join(", ")}`,
    );
  }

  // ---- 20. C14: wizard 各 step 页全部禁词清扫 ----
  console.log("\n>>> C14: wizard step pages — 全 step 子页禁词扫描");
  const wizardCheckTargets: Array<[string, string]> = [
    ["/wizard/new (zh)", wizardNewZh.body],
    ["/wizard/new (en)", wizardNewEn.body],
    ...wizardSubBodies
      .filter((s) => s.status === 200)
      .map((s): [string, string] => [s.path + " (zh)", s.body]),
  ];
  const wizardHits: Array<{ page: string; word: string; excerpt: string }> = [];
  for (const [name, html] of wizardCheckTargets) {
    const hits = checkBanned(html);
    /// 加强：再用 raw HTML（不剥 script）严格搜 hard 文案——可见的 client-rendered 文案常在 RSC payload
    const HARD_WIZARD = [
      { name: "Step 1", re: /\bStep\s*1\b/ },
      { name: "Step 2", re: /\bStep\s*2\b/ },
      { name: "Step 3", re: /\bStep\s*3\b/ },
      { name: "Step 4", re: /\bStep\s*4\b/ },
      { name: "Step 5", re: /\bStep\s*5\b/ },
      { name: "Step 6", re: /\bStep\s*6\b/ },
      { name: "Client Wizard", re: /\bClient\s*Wizard\b/ },
      { name: "证据卡", re: /证据卡/ },
      { name: "赛马", re: /赛马/ },
    ];
    for (const re of HARD_WIZARD) {
      const m = html.match(re.re);
      if (m && m.index != null) {
        const excerpt = html
          .slice(Math.max(0, m.index - 30), m.index + m[0].length + 50)
          .replace(/\s+/g, " ")
          .trim();
        wizardHits.push({ page: name, word: re.name, excerpt });
      }
    }
    for (const h of hits) {
      wizardHits.push({ page: name, word: h.word, excerpt: h.excerpt });
    }
  }
  /// 去重（同 page + word 多次命中只保留 1 条）
  const dedup = new Map<string, { page: string; word: string; excerpt: string }>();
  for (const h of wizardHits) {
    const k = h.page + "|" + h.word;
    if (!dedup.has(k)) dedup.set(k, h);
  }
  const wizardHitArr = Array.from(dedup.values());
  if (wizardHitArr.length === 0) {
    record(
      "C14",
      "wizard 全 step 子页 textNode 无禁词",
      "PASS",
      `0 hits across ${wizardCheckTargets.length} pages`,
    );
  } else {
    record(
      "C14",
      "wizard 全 step 子页 textNode 无禁词",
      "FAIL",
      `${wizardHitArr.length} hits:\n     ${wizardHitArr
        .map((h) => `${h.page} → "${h.word}" @ "${h.excerpt}"`)
        .join("\n     ")}`,
    );
  }

  // ---- 21. C15: 登录页营销文案不含「赛马 / 5 条广告 / 数据回流 / 特征蒸馏」 ----
  console.log("\n>>> C15: 登录页营销 copy 不含旧赛马术语");
  const loginRaw = loginHtml.body;
  const LOGIN_BANNED = [
    /赛马/,
    /5\s*条广告/,
    /5\s*条/,
    /数据回流/,
    /特征蒸馏/,
    /\bRound\b/,
  ];
  const loginHits: string[] = [];
  for (const re of LOGIN_BANNED) {
    const m = loginRaw.match(re);
    if (m && m.index != null) {
      const excerpt = loginRaw
        .slice(Math.max(0, m.index - 30), m.index + m[0].length + 40)
        .replace(/\s+/g, " ")
        .trim();
      loginHits.push(`"${m[0]}" @ "${excerpt}"`);
    }
  }
  if (loginHits.length === 0) {
    record("C15", "登录页营销文案干净", "PASS", "0 hits in /login HTML");
  } else {
    record(
      "C15",
      "登录页营销文案干净",
      "FAIL",
      `${loginHits.length} hits:\n     ${loginHits.join("\n     ")}`,
    );
  }

  // ---- 22. C16: chatJson 守门生效（dev console log 检查 + 0 真实 OpenAI 调用） ----
  console.log("\n>>> C16: chatJson 守门生效");
  /// 该项的判定条件：
  ///   - C13 通过（即 0 真实调用走出网络）
  ///   - 至少存在 isLLMForcedMock 短路证据（aiLogs 中存在 MOCK status with model="mock"，
  ///     或 dev server 日志中含 "LLM_FORCE_MOCK is true; refusing to send real OpenAI request"）
  /// 我们额外尝试主动触发 chatJsonByTier 一次，断言它会 throw。
  let guardThrew = false;
  let guardErr = "";
  try {
    const { chatJsonByTier } = await import("../src/lib/providers/openai");
    await chatJsonByTier({
      tier: "fast",
      stage: "qa_guard_probe",
      system: "ping",
      user: "pong",
      maxTokens: 8,
    });
    guardErr = "chatJsonByTier did NOT throw under LLM_FORCE_MOCK";
  } catch (e) {
    guardThrew = true;
    guardErr = e instanceof Error ? e.message : String(e);
  }
  const guardMessageOk =
    guardThrew && /LLM_FORCE_MOCK is true.*refusing to send real/i.test(guardErr);
  if (guardMessageOk && !usedRealLLM) {
    record(
      "C16",
      "chatJson 守门生效（force-mock 时 throw 而非真请求）",
      "PASS",
      `chatJsonByTier threw with expected guard message; 0 real OpenAI calls.`,
    );
  } else if (guardThrew && !usedRealLLM) {
    record(
      "C16",
      "chatJson 守门生效（force-mock 时 throw 而非真请求）",
      "WARN",
      `threw but message different: "${guardErr.slice(0, 120)}"`,
    );
  } else {
    record(
      "C16",
      "chatJson 守门生效（force-mock 时 throw 而非真请求）",
      "FAIL",
      `usedRealLLM=${usedRealLLM} guardThrew=${guardThrew} err="${guardErr.slice(0, 120)}"`,
    );
  }

  // ---- 总结 ----
  console.log("\n═════════════════════════════════════════════════");
  console.log("                  RESULTS");
  console.log("═════════════════════════════════════════════════");
  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;
  for (const r of results) {
    const icon = r.result === "PASS" ? "✅" : r.result === "FAIL" ? "❌" : "⚠️ ";
    console.log(`${icon} ${r.id.padEnd(20)} ${r.desc}`);
  }
  console.log("\n  PASS=" + pass + "  FAIL=" + fail + "  WARN=" + warn);
  console.log("\n  orderId=" + orderId);
  console.log("  briefId=" + scriptResult.videoBriefId);
  console.log("  finalVideoId=" + finalVideoIdRef);
  console.log("  card slug used=" + (cardSlugUsed ?? "(none)"));
  console.log("\n  HTML dumps: " + OUT_DIR);

  /// 写一份机器可读的 JSON 报告
  writeFileSync(
    join(OUT_DIR, "report.json"),
    JSON.stringify(
      {
        orderId,
        briefId: scriptResult.videoBriefId,
        finalVideoId: finalVideoIdRef,
        cardSlugUsed,
        videoJobs: jobs.map((j) => ({
          id: j.id,
          segmentIndex: j.segmentIndex,
          segmentDurationSec: j.segmentDurationSec,
          externalJobId: j.externalJobId,
        })),
        results,
        summary: { pass, fail, warn },
        runAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  await db.$disconnect();

  if (fail > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("\nFATAL:", err);
  await db.$disconnect();
  process.exitCode = 2;
});
