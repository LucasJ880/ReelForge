import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  PHONE_PHOTO_MIN_BYTES,
  PHONE_PHOTO_WIDTH,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MAX_AGE_SECONDS,
  classifyUploadOutcome,
  loadSmokeSession,
  optionColorProblem,
  planStaleSessionCheck,
  readRelease,
  saveSmokeSession,
  type UploadCall,
} from "./prod-smoke-helpers";
import { drawPhonePhoto, readOptionColors } from "./prod-smoke-page";

/**
 * 发布后冒烟：每次 Vercel 生产部署成功后对真生产跑（.github/workflows/prod-smoke.yml），
 * 也可以手动跑：PROD_SMOKE_BASE_URL=… PROD_SMOKE_EMAIL=… PROD_SMOKE_PASSWORD=… npm run test:prod-smoke
 *
 * 10-30 CEO 演示翻车的三件事，要在人碰到之前先被它碰到：
 *   1. 手机原图上传 413：文件穿过 Vercel 函数（请求体上限 4.5MB）就被平台拒，本地 next dev 没有
 *      这个上限，golden path 与单测（1×1 PNG）全绿也测不出来。这里在页面里现画一张 3024×4032、
 *      ≥6MB 的 JPEG，走真上传（ticket → 浏览器直传 Blob → complete），缩略图加载出来才算过。
 *   2. 创意模板原生下拉白底白字：弹层是浏览器自己画的、截不到图，只能逐个选项读计算样式。
 *   3. 两天前的登录没输密码就进了创作页：会话 cookie 最长 12 小时；上一次部署签发的登录在这一版必须被拒。
 *
 * 只用专用 QA 账号，绝不点「生成」：不花生成额度、不打视频供应商。
 * 每跑一次在生产留下 1 个约 6MB 的 Blob 对象 + 1 条 MediaAsset（QA 账号名下）。
 */

const EMAIL = process.env.PROD_SMOKE_EMAIL?.trim() ?? "";
const PASSWORD = process.env.PROD_SMOKE_PASSWORD ?? "";
/** 工作流传入的部署 commit（deployment_status 事件）；手动跑可以不给 */
const EXPECTED_RELEASE = process.env.PROD_SMOKE_EXPECTED_RELEASE?.trim().toLowerCase() || null;
/** 本轮登录态写到这里，工作流加密后留给下一次部署做「发布即失效」检查 */
const SAVE_SESSION_PATH = process.env.PROD_SMOKE_SAVE_SESSION?.trim() || null;
/** 上一次部署那轮留下的登录态（工作流解密好放在这里） */
const PREVIOUS_SESSION_PATH = process.env.PROD_SMOKE_PREVIOUS_SESSION?.trim() || null;

const UPLOAD_TIMEOUT_MS = 120_000;

/// 新账号第一次进创作页会弹上手引导；冒烟按老用户进，免得弹层盖住页面、把读屏树藏起来
const DISMISSED_CREATE_INTROS = ["aivora.create-onboarding.v1", "aivora.streamlined-video-guide.v1"];

test.describe("未登录", () => {
  test("健康检查 200，且就是这次部署", async ({ request }) => {
    const response = await request.get("/api/health", { failOnStatusCode: false });
    const health: unknown = await response.json().catch(() => null);
    expect(response.status(), "GET /api/health").toBe(200);
    expect(health, "健康检查报告不健康").toMatchObject({ ok: true, database: "connected" });
    const live = readRelease(health);
    if (EXPECTED_RELEASE && live) expect(live, "生产别名上跑的不是这次部署").toBe(EXPECTED_RELEASE);
  });

  test("打开 /app/create 307 到 /login", async ({ request }) => {
    const response = await request.get("/app/create", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location ?? "", response.url());
    expect(location.pathname).toBe("/login");
  });

  /// 中间件对未登录的任何 /api 路径都回这个 401（不存在的路由也一样），所以这里只证明鉴权闸与
  /// JSON 信封；接口有没有上线由「已登录」那条用空请求区分 400 / 404。
  test("调直传凭证接口回 401 JSON，不是 HTML", async ({ request }) => {
    const response = await request.post("/api/upload/blob/ticket", {
      data: { contentType: "image/jpeg", size: PHONE_PHOTO_MIN_BYTES, prefix: "unified-input" },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toMatchObject({ ok: false, code: "AUTH_REQUIRED", action: "sign_in" });
  });

  /// 反向对照：旧的 multipart 中转（POST /api/upload/blob）在 Vercel 上收不了 4.5MB 以上的请求体，
  /// 平台在调用函数之前就回 413——这正是客户端绝不能退回去走它的原因。哪天这条不再是 413，说明
  /// 平台上限变了，直传的前提要重新评估。请求体是 5MB 全零的 octet-stream：万一被放进函数，
  /// 也会先被鉴权（未登录）和类型校验挡掉，不会落成资产。
  test("旧 multipart 中转收不了 5MB：Vercel 回 413 FUNCTION_PAYLOAD_TOO_LARGE", async ({ request }) => {
    const response = await request.post("/api/upload/blob", {
      multipart: {
        file: {
          name: "prod-smoke-oversize.bin",
          mimeType: "application/octet-stream",
          buffer: Buffer.alloc(5 * 1024 * 1024),
        },
        prefix: "prod-smoke",
      },
    });
    expect(response.status()).toBe(413);
    expect(response.headers()["x-vercel-error"]).toBe("FUNCTION_PAYLOAD_TOO_LARGE");
  });
});

test.describe("已登录（专用 QA 账号）", () => {
  test.skip(!EMAIL || !PASSWORD, "没给 PROD_SMOKE_EMAIL / PROD_SMOKE_PASSWORD，只跑未登录检查");

  let context: BrowserContext;
  let origin: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    origin = new URL(baseURLOf(testInfo)).origin;
    context = await newSmokeContext(browser, testInfo);
    await context.addInitScript((keys) => {
      try {
        for (const key of keys) localStorage.setItem(key, "dismissed");
      } catch {
        // 存储不可用时引导会弹出来，用例仍按测试 id 定位
      }
    }, DISMISSED_CREATE_INTROS);

    const page = await context.newPage();
    await signIn(page);
    await page.close();

    if (SAVE_SESSION_PATH) {
      saveSmokeSession(SAVE_SESSION_PATH, {
        version: 1,
        baseURL: baseURLOf(testInfo),
        release: (await liveRelease(context.request)) ?? EXPECTED_RELEASE,
        savedAt: new Date().toISOString(),
        cookies: (await context.cookies()).filter((cookie) => SESSION_COOKIE_NAME.test(cookie.name)),
      });
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("会话 cookie 最长 12 小时（闲置超时），不是旧的 7 天", async () => {
    const session = (await context.cookies()).find((cookie) => SESSION_COOKIE_NAME.test(cookie.name));
    expect(session, "登录后没有 NextAuth 会话 cookie").toBeTruthy();
    const lifetimeSeconds = session!.expires - Date.now() / 1000;
    expect(lifetimeSeconds, "会话 cookie 是关掉浏览器就没的临时 cookie").toBeGreaterThan(0);
    expect(
      lifetimeSeconds,
      `会话 cookie 还能活 ${(lifetimeSeconds / 3600).toFixed(1)} 小时，超过闲置上限 12 小时`,
    ).toBeLessThanOrEqual(SESSION_IDLE_MAX_AGE_SECONDS + 300);
  });

  test("直传两个接口已上线：空请求回 400 校验错误，不是 404", async () => {
    for (const path of ["/api/upload/blob/ticket", "/api/upload/blob/complete"]) {
      const response = await context.request.post(path, { data: {} });
      expect(response.status(), `POST ${path}（404 = 直传修复没上线）`).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
  });

  test("手机原图（3024×4032、≥6MB）直传 Blob，缩略图加载出来；不点生成", async () => {
    const page = await context.newPage();
    const calls: UploadCall[] = [];
    const blobPuts: string[] = [];
    let ticketMode: Promise<unknown> = Promise.resolve(null);
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith("/api/upload/")) {
        calls.push({ method: response.request().method(), path: url.pathname, status: response.status() });
        /// ticket 回包里有 Blob 写入凭证：只取 mode，别的不碰、不打印
        if (url.pathname === "/api/upload/blob/ticket") {
          ticketMode = response.json().then((body: { mode?: unknown }) => body?.mode ?? null, () => null);
        }
      }
      if (response.request().method() === "PUT" && url.hostname === "vercel.com" && url.pathname.startsWith("/api/blob")) {
        blobPuts.push(String(response.status()));
      }
    });
    page.on("requestfailed", (request) => {
      if (request.method() === "PUT" && new URL(request.url()).hostname === "vercel.com") {
        blobPuts.push(`失败：${request.failure()?.errorText ?? "unknown"}`);
      }
    });

    await page.goto("/app/create");
    const assets = page.getByTestId("streamlined-product-assets");
    const input = assets.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]');
    await expect(input, "创作页上找不到「商品图」文件框").toHaveCount(1);
    await expect(input).toBeEnabled();

    const alerts = page.locator("main").getByRole("alert").filter({ hasText: /\S/ });
    const alertsBefore = new Set(await alerts.allInnerTexts());
    const newAlerts = async () => (await alerts.allInnerTexts()).filter((text) => !alertsBefore.has(text));

    const photo = await drawPhonePhoto(page);
    expect(photo.length, "测试图没画到 6MB").toBeGreaterThanOrEqual(PHONE_PHOTO_MIN_BYTES);
    await input.setInputFiles({ name: "IMG_0430.JPG", mimeType: "image/jpeg", buffer: photo });

    const outcome = async () => classifyUploadOutcome(calls, await newAlerts());
    await expect
      .poll(outcome, { message: "上传既没完成也没报错", timeout: UPLOAD_TIMEOUT_MS, intervals: [500, 1_000] })
      .not.toBe("pending");

    const diagnosis = [
      `上传调用：${calls.map((call) => `${call.method} ${call.path} → ${call.status}`).join("；") || "无"}`,
      `Blob 直传 PUT：${blobPuts.join("；") || "无"}`,
      `ticket mode：${String(await ticketMode)}`,
      `页面报错：${(await newAlerts()).join(" / ") || "无"}`,
    ].join("\n");
    expect(
      calls.filter((call) => call.path === "/api/upload/blob"),
      `客户端走了旧的 multipart 中转：Vercel 函数请求体上限 4.5MB，手机原图必 413（10-30 演示翻车）\n${diagnosis}`,
    ).toEqual([]);
    expect(await outcome(), diagnosis).toBe("registered");
    expect(await ticketMode, `生产存储应支持浏览器直传（mode=direct）\n${diagnosis}`).toBe("direct");

    const thumbnail = assets.getByRole("listitem").locator("img").first();
    await expect(thumbnail, "资产登记成功了，但缩略图没出现").toBeVisible();
    await expect
      .poll(() => thumbnail.evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0)), {
        message: "缩略图没加载出来（Blob 对象读不到？）",
        timeout: 60_000,
      })
      .toBe(PHONE_PHOTO_WIDTH);
    expect(await newAlerts(), "上传成功了，页面却还挂着错误").toEqual([]);
    await page.close();
  });

  test("创意模板等原生下拉：每个选项底色不透明、字底对比度 ≥ 4.5:1", async () => {
    const page = await context.newPage();
    await page.goto("/app/create");
    const template = page.locator("label").filter({ hasText: "创意模板" }).locator("select");
    await expect(template, "创作页上找不到「创意模板」下拉").toHaveCount(1);
    expect((await readOptionColors(template)).length, "创意模板下拉没有可选项").toBeGreaterThan(1);

    /// 全站原生下拉共用一套颜色规则，页面上别的下拉一起查，零成本
    const problems: string[] = [];
    for (const select of await page.locator("main select").all()) {
      const name = await select.evaluate((element) =>
        element.closest("label")?.querySelector("span")?.textContent?.trim()
          || element.getAttribute("aria-label")
          || "未命名下拉");
      for (const option of await readOptionColors(select)) {
        const problem = optionColorProblem(option);
        if (problem) problems.push(`「${name}」的「${option.label}」：${problem}`);
      }
    }
    expect(problems, "原生下拉弹层会看不清（10-30：创意模板白底白字）").toEqual([]);
    await page.close();
  });
});

test.describe("上一次部署签发的登录", () => {
  test("在这一版被拒（发布即失效）", async ({ playwright, request }, testInfo) => {
    const previous = PREVIOUS_SESSION_PATH ? loadSmokeSession(PREVIOUS_SESSION_PATH) : null;
    if (!previous) {
      test.skip(true, "没有上一轮留下的登录态（首轮、上一轮失败、或改过 QA 账号密码）");
      return;
    }
    const plan = planStaleSessionCheck(previous, {
      baseURL: baseURLOf(testInfo),
      release: (await liveRelease(request)) ?? EXPECTED_RELEASE,
      nowMs: Date.now(),
    });
    if (plan.kind === "skip") {
      test.skip(true, plan.reason);
      return;
    }

    /// 页面与接口各用一份：中间件拒掉旧会话时会顺手清 cookie，同一份上下文的第二个请求就成了「没登录」
    const replay = () => playwright.request.newContext({
      baseURL: baseURLOf(testInfo),
      storageState: { cookies: previous.cookies, origins: [] },
    });
    const [pageReplay, apiReplay] = await Promise.all([replay(), replay()]);
    try {
      const entry = await pageReplay.get("/app/create", { maxRedirects: 0 });
      expect(entry.status(), "上一版签发的登录还能直接进 /app/create（10-30：两天前的登录没输密码就进了创作页）").toBe(307);
      const location = new URL(entry.headers().location ?? "", entry.url());
      expect(location.pathname).toBe("/login");
      if (plan.reasonExpired) {
        expect(location.searchParams.get("reason"), "被拒了，但不是会话策略拒的").toBe("expired");
      }
      /// 空请求：万一旧会话还有效，接口只会回 400 校验错误，不会签出写入凭证
      const api = await apiReplay.post("/api/upload/blob/ticket", { data: {} });
      expect(api.status(), "上一版签发的登录还能调接口").toBe(401);
    } finally {
      await Promise.all([pageReplay.dispose(), apiReplay.dispose()]);
    }
  });
});

async function newSmokeContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const { baseURL, locale, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
  return browser.newContext({ baseURL, locale, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
}

function baseURLOf(testInfo: TestInfo): string {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error("playwright.prod-smoke.config.ts 没配 baseURL");
  return baseURL;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login?from=/app/create");
  await page.getByLabel("邮箱", { exact: true }).fill(EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const refused = page.locator("form").getByRole("alert");
  await expect
    .poll(
      async () => {
        if (new URL(page.url()).pathname === "/app/create") return "signed-in";
        if ((await refused.count()) > 0) return `登录被拒：${await refused.first().innerText()}`;
        return "pending";
      },
      {
        /// *.test / .example / .invalid / .localhost 的邮箱在生产一律登录不了（isReservedTestEmail）
        message: "QA 账号登录失败（密码不对、账号停用，或用了保留测试域名的邮箱）",
        timeout: 45_000,
      },
    )
    .toBe("signed-in");
}

async function liveRelease(request: APIRequestContext): Promise<string | null> {
  const response = await request.get("/api/health", { failOnStatusCode: false });
  return readRelease(await response.json().catch(() => null));
}
