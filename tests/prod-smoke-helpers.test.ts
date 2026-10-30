/**
 * 发布后冒烟（e2e/prod-smoke.spec.ts + .github/workflows/prod-smoke.yml）里不碰浏览器的部分：
 * 判定口径算错了，冒烟就会对着坏掉的生产报绿。另外守住两条公开仓库的底线：
 * 不上传 trace / 报告（会录下密码），交给下一次部署的登录态先加密再上传。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SESSION_IDLE_MAX_AGE_SECONDS,
  checkLiveRelease,
  classifyUploadOutcome,
  contrastRatio,
  optionColorProblem,
  parseSmokeSession,
  planStaleSessionCheck,
  type OptionColors,
  type Rgba,
  type SmokeSession,
} from "../e2e/prod-smoke-helpers";
import { deploymentRelease, healthResponseSchema, unavailableHealthResponse } from "../src/lib/contracts/health";

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
/// tokens.css：--popover #1b1e23，--popover-foreground = --text-primary #ffffff
const POPOVER: Rgba = { r: 0x1b, g: 0x1e, b: 0x23, a: 1 };
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

function option(color: Rgba, background: Rgba): OptionColors {
  return { label: "自动匹配（推荐）", cssColor: "test-color", cssBackground: "test-background", color, background };
}

const SHA_A = "12efd3221a10f7f227a02409cd3f3eaa42f209fc";
const SHA_B = "9cc6b2baa7f6c17e517f4f5aacba9ba7f826f541";
const BASE = "https://reelforge-delta.vercel.app";

function session(overrides: Partial<SmokeSession> = {}): SmokeSession {
  return {
    version: 1,
    baseURL: BASE,
    release: SHA_A,
    savedAt: "2026-10-30T10:00:00.000Z",
    cookies: [{
      name: "__Secure-next-auth.session-token",
      value: "jwe",
      domain: "reelforge-delta.vercel.app",
      path: "/",
      expires: 1_793_400_000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }],
    ...overrides,
  };
}

test("上传结论：10-30 的样子（文件 multipart 进函数、Vercel 413）判失败", () => {
  assert.equal(
    classifyUploadOutcome([{ method: "POST", path: "/api/upload/blob", status: 413 }], ["上传失败 (413)"]),
    "退回了旧的 multipart 中转",
  );
  /// 就算中转那一下成功了也不行：手机原图一大就会 413，客户端根本不该走它
  assert.equal(
    classifyUploadOutcome([{ method: "POST", path: "/api/upload/blob", status: 201 }], []),
    "退回了旧的 multipart 中转",
  );
});

test("上传结论：直传各步失败都有名字，没结论时是 pending", () => {
  const ticketOk = { method: "POST", path: "/api/upload/blob/ticket", status: 200 };
  assert.equal(classifyUploadOutcome([{ ...ticketOk, status: 404 }], []), "ticket 404");
  assert.equal(classifyUploadOutcome([ticketOk, { method: "POST", path: "/api/upload/blob/complete", status: 409 }], []), "complete 409");
  assert.equal(classifyUploadOutcome([ticketOk], ["上传失败，请检查网络后重试"]), "页面报错：上传失败，请检查网络后重试");
  assert.equal(classifyUploadOutcome([ticketOk], []), "pending");
  assert.equal(classifyUploadOutcome([], []), "pending");
  assert.equal(
    classifyUploadOutcome([ticketOk, { method: "POST", path: "/api/upload/blob/complete", status: 201 }], []),
    "registered",
  );
});

test("对比度：按 WCAG 口径，白对白 1:1、黑对白 21:1", () => {
  assert.equal(contrastRatio(WHITE, WHITE), 1);
  assert.ok(Math.abs(contrastRatio(BLACK, WHITE) - 21) < 1e-9);
  assert.equal(contrastRatio(WHITE, BLACK), contrastRatio(BLACK, WHITE));
});

test("对比度：半透明字色先叠到底色上再算", () => {
  assert.equal(contrastRatio({ ...WHITE, a: 0 }, POPOVER), 1);
  assert.ok(contrastRatio({ ...WHITE, a: 0.5 }, POPOVER) < contrastRatio(WHITE, POPOVER));
});

test("下拉选项：10-30 的样子（透明底、继承的白字）判失败", () => {
  assert.match(optionColorProblem(option(WHITE, TRANSPARENT)) ?? "", /底色透明/);
  assert.match(optionColorProblem(option(WHITE, { ...POPOVER, a: 0.5 })) ?? "", /底色透明/);
});

test("下拉选项：修好后的 popover 配色通过，灰字配深底判失败", () => {
  assert.equal(optionColorProblem(option(WHITE, POPOVER)), null);
  assert.ok(contrastRatio(WHITE, POPOVER) > 15);
  assert.match(optionColorProblem(option({ r: 70, g: 74, b: 80, a: 1 }, POPOVER)) ?? "", /对比度 .* 低于 4\.5:1/);
  assert.match(optionColorProblem(option(WHITE, WHITE)) ?? "", /对比度 1\.00:1/);
});

test("发布版本：health 报的 release 与部署 commit 比", () => {
  assert.deepEqual(checkLiveRelease({ release: SHA_A }, SHA_A.toUpperCase()), { kind: "match", live: SHA_A });
  assert.deepEqual(checkLiveRelease({ release: SHA_B }, SHA_A), { kind: "other", live: SHA_B });
  assert.deepEqual(checkLiveRelease({ release: null }, SHA_A), { kind: "unknown" });
  assert.deepEqual(checkLiveRelease({}, SHA_A), { kind: "unknown" });
  assert.deepEqual(checkLiveRelease({ release: "main" }, SHA_A), { kind: "unknown" });
  assert.deepEqual(checkLiveRelease(null, SHA_A), { kind: "unknown" });
});

test("health release：只回显十六进制 commit，别的值一律 null", () => {
  assert.equal(deploymentRelease({ VERCEL_GIT_COMMIT_SHA: ` ${SHA_A.toUpperCase()} ` }), SHA_A);
  assert.equal(deploymentRelease({ VERCEL_GIT_COMMIT_SHA: "postgres://user:pw@host/db" }), null);
  assert.equal(deploymentRelease({ VERCEL_GIT_COMMIT_SHA: "" }), null);
  assert.equal(deploymentRelease({}), null);

  const degraded = unavailableHealthResponse(new Date("2026-10-30T12:00:00.000Z"));
  assert.ok("release" in degraded, "降级响应也要带 release 字段");
  const accepted = healthResponseSchema.safeParse({ ...degraded, release: SHA_A });
  assert.equal(accepted.success, true);
  assert.equal(healthResponseSchema.safeParse({ ...degraded, release: "Bearer secret-token" }).success, false);
});

test("health release：路由把 deploymentRelease() 放进响应", async () => {
  const route = await readFile("src/app/api/health/route.ts", "utf8");
  assert.match(route, /release:\s*deploymentRelease\(\)/);
});

test("交接登录态：只认版本 1、只留 NextAuth 会话 cookie", () => {
  const withNoise = {
    ...session(),
    cookies: [
      ...session().cookies,
      { ...session().cookies[0], name: "__Host-next-auth.csrf-token" },
    ],
  };
  assert.deepEqual(parseSmokeSession(JSON.stringify(withNoise))?.cookies.map((c) => c.name), [
    "__Secure-next-auth.session-token",
  ]);
  assert.equal(parseSmokeSession("not json"), null);
  assert.equal(parseSmokeSession(JSON.stringify({ ...session(), version: 2 })), null);
  assert.equal(parseSmokeSession(JSON.stringify({ ...session(), release: "main" })), null);
  assert.equal(parseSmokeSession(JSON.stringify({ ...session(), savedAt: "yesterday" })), null);
  assert.equal(parseSmokeSession(JSON.stringify({ ...session(), cookies: [] })), null);
  assert.equal(parseSmokeSession(JSON.stringify({ ...session(), release: null }))?.release, null);
});

test("发布即失效：换了 commit 才要求旧登录被拒；12 小时内必须是会话策略拒的", () => {
  const savedAt = Date.parse("2026-10-30T10:00:00.000Z");
  const fresh = { baseURL: BASE, release: SHA_B, nowMs: savedAt + 60 * 60 * 1000 };
  assert.deepEqual(planStaleSessionCheck(session(), fresh), { kind: "expect-rejected", reasonExpired: true });
  assert.deepEqual(
    planStaleSessionCheck(session(), { ...fresh, nowMs: savedAt + (SESSION_IDLE_MAX_AGE_SECONDS + 60) * 1000 }),
    { kind: "expect-rejected", reasonExpired: false },
  );
  assert.equal(planStaleSessionCheck(session(), { ...fresh, release: SHA_A }).kind, "skip");
  assert.equal(planStaleSessionCheck(session(), { ...fresh, release: null }).kind, "skip");
  assert.equal(planStaleSessionCheck(session({ release: null }), fresh).kind, "skip");
  assert.equal(planStaleSessionCheck(session(), { ...fresh, baseURL: "https://other.vercel.app" }).kind, "skip");
});

test("工作流：只在生产部署成功后跑，按部署 commit 核对版本", async () => {
  const workflow = await readFile(".github/workflows/prod-smoke.yml", "utf8");
  assert.match(workflow, /^\s*deployment_status:/m);
  assert.match(workflow, /github\.event\.deployment_status\.state == 'success'/);
  assert.match(workflow, /github\.event\.deployment\.environment == 'Production'/);
  assert.match(workflow, /PROD_SMOKE_EXPECTED_RELEASE:\s*\$\{\{\s*github\.event\.deployment\.sha\s*\}\}/);
  assert.match(workflow, /secrets\.PROD_SMOKE_EMAIL/);
  assert.match(workflow, /secrets\.PROD_SMOKE_PASSWORD/);
  assert.match(workflow, /--config=playwright\.prod-smoke\.config\.ts/);
});

test("公开仓库：不上传 trace / 报告，登录态加密后才进 artifact", async () => {
  const [workflow, config] = await Promise.all([
    readFile(".github/workflows/prod-smoke.yml", "utf8"),
    readFile("playwright.prod-smoke.config.ts", "utf8"),
  ]);
  assert.match(config, /trace:\s*"off"/);
  assert.match(config, /video:\s*"off"/);
  assert.doesNotMatch(workflow, /playwright-report|test-results/);
  const uploads = [...workflow.matchAll(/^\s*path:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(uploads, ["tmp/prod-smoke/session.enc"]);
  const encrypt = workflow.indexOf('-in "$PROD_SMOKE_SAVE_SESSION" -out tmp/prod-smoke/session.enc');
  assert.ok(encrypt > 0, "登录态要先用 openssl 加密");
  assert.ok(workflow.lastIndexOf("openssl enc -aes-256-cbc -pbkdf2", encrypt) > 0);
  assert.ok(encrypt < workflow.indexOf("actions/upload-artifact"), "加密必须在上传之前");
});

test("冒烟绝不触发付费生成：不点「生成」、不调生成 / 派单接口", async () => {
  const spec = await readFile("e2e/prod-smoke.spec.ts", "utf8");
  assert.doesNotMatch(spec, /name:\s*["'`][^"'`]*生成/);
  assert.doesNotMatch(spec, /\/api\/(videos|video-generation|batch|product-images|storyboard)/);
});
