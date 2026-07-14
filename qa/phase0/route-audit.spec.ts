import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { db } from "../../src/lib/db";

const EMAIL = "final-acceptance@aivora.app";
const PASSWORD = "aivora-final-acceptance-2026";
const screenshotDir = path.join(process.cwd(), "qa/screenshots/baseline/routes");
const reportPath = path.join(process.cwd(), "qa/evidence/phase0-route-scan.json");

type RouteTarget = {
  template: string;
  path: string;
  surface: "public" | "auth" | "customer" | "operator";
  representativeData: boolean;
};

type RouteScan = RouteTarget & {
  finalUrl: string;
  documentStatus: number | null;
  title: string;
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: Array<{ method: string; url: string; failure: string | null }>;
  errorResponses: Array<{ status: number; method: string; url: string }>;
  overflow: {
    viewportWidth: number;
    documentWidth: number;
    overflowingElements: Array<{
      tag: string;
      id: string | null;
      className: string | null;
      left: number;
      right: number;
      width: number;
    }>;
  };
  bodyExcerpt: string;
  screenshot: string;
  networkIdle: boolean;
};

function slugForRoute(route: string): string {
  if (route === "/") return "root";
  return route
    .replace(/^\//, "")
    .replace(/\[|\]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-");
}

async function resolveTargets(): Promise<RouteTarget[]> {
  const auditUser = await db.adminUser.findUnique({
    where: { email: EMAIL },
    select: { id: true },
  });
  const [brief, order, round, customerBatch, customerLibraryItem] = await Promise.all([
    db.videoBrief.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
    db.deliveryOrder.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
    db.round.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
    auditUser
      ? db.batchJob.findFirst({
          where: { userId: auditUser.id },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : null,
    auditUser
      ? db.deliveryOrder.findFirst({
          where: { createdById: auditUser.id, productCategory: "unified_input" },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        })
      : null,
  ]);

  const targets: RouteTarget[] = [
    { template: "/", path: "/", surface: "public", representativeData: true },
    { template: "/login", path: "/login", surface: "auth", representativeData: true },
    { template: "/register", path: "/register", surface: "auth", representativeData: true },
    { template: "/persona", path: "/persona", surface: "public", representativeData: true },
    { template: "/privacy", path: "/privacy", surface: "public", representativeData: true },
    { template: "/showcase", path: "/showcase", surface: "public", representativeData: true },
    { template: "/terms", path: "/terms", surface: "public", representativeData: true },
    { template: "/app", path: "/app", surface: "customer", representativeData: true },
    { template: "/app/create", path: "/app/create", surface: "customer", representativeData: true },
    { template: "/app/create/images", path: "/app/create/images", surface: "customer", representativeData: true },
    { template: "/app/batches", path: "/app/batches", surface: "customer", representativeData: true },
    { template: "/app/batches/new", path: "/app/batches/new", surface: "customer", representativeData: true },
    { template: "/app/batches/[id]", path: `/app/batches/${customerBatch?.id ?? "__phase0_missing__"}`, surface: "customer", representativeData: Boolean(customerBatch) },
    { template: "/app/library", path: "/app/library", surface: "customer", representativeData: true },
    { template: "/app/library/[id]", path: `/app/library/${customerLibraryItem?.id ?? "__phase0_missing__"}`, surface: "customer", representativeData: Boolean(customerLibraryItem) },
    { template: "/app/racing", path: "/app/racing", surface: "customer", representativeData: true },
    { template: "/app/templates", path: "/app/templates", surface: "customer", representativeData: true },
    { template: "/internal", path: "/internal", surface: "operator", representativeData: true },
    { template: "/internal/ai-usage", path: "/internal/ai-usage", surface: "operator", representativeData: true },
    { template: "/internal/briefs/[id]", path: `/internal/briefs/${brief?.id ?? "__phase0_missing__"}`, surface: "operator", representativeData: Boolean(brief) },
    { template: "/internal/demo-leads", path: "/internal/demo-leads", surface: "operator", representativeData: true },
    { template: "/internal/distillation", path: "/internal/distillation", surface: "operator", representativeData: true },
    { template: "/internal/metrics", path: "/internal/metrics", surface: "operator", representativeData: true },
    { template: "/internal/orders", path: "/internal/orders", surface: "operator", representativeData: true },
    { template: "/internal/orders/new", path: "/internal/orders/new", surface: "operator", representativeData: true },
    { template: "/internal/orders/[id]", path: `/internal/orders/${order?.id ?? "__phase0_missing__"}`, surface: "operator", representativeData: Boolean(order) },
    { template: "/internal/publish", path: "/internal/publish", surface: "operator", representativeData: true },
    { template: "/internal/qa", path: "/internal/qa", surface: "operator", representativeData: true },
    { template: "/internal/reports", path: "/internal/reports", surface: "operator", representativeData: true },
    { template: "/internal/rounds", path: "/internal/rounds", surface: "operator", representativeData: true },
    { template: "/internal/rounds/[id]", path: `/internal/rounds/${round?.id ?? "__phase0_missing__"}`, surface: "operator", representativeData: Boolean(round) },
    { template: "/internal/settings", path: "/internal/settings", surface: "operator", representativeData: true },
    { template: "/internal/videos", path: "/internal/videos", surface: "operator", representativeData: true },
  ];
  return targets;
}

test("Phase 0 cold-load inventory captures all page routes", async ({ browser, baseURL }) => {
  expect(baseURL).toBeTruthy();
  await mkdir(screenshotDir, { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });

  const publicContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    colorScheme: "light",
  });
  const authContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    colorScheme: "light",
  });
  const loginPage = await authContext.newPage();
  await loginPage.goto("/login?from=/app");
  await loginPage.getByLabel("邮箱").fill(EMAIL);
  await loginPage.getByLabel("密码").fill(PASSWORD);
  await loginPage.getByRole("button", { name: "登录", exact: true }).click();
  await expect
    .poll(async () => (await authContext.cookies()).some((cookie) => cookie.name === "next-auth.session-token"), { timeout: 20_000 })
    .toBe(true);
  const localCookie = (await authContext.cookies()).find((cookie) => cookie.name === "next-auth.session-token")!;
  await authContext.addCookies([
    {
      name: "__Secure-next-auth.session-token",
      value: localCookie.value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  await loginPage.close();

  const internalUser = await db.adminUser.findFirst({
    where: {
      role: { in: ["SUPER_ADMIN", "OPERATOR"] },
      userType: { in: ["SUPER_ADMIN", "OPERATOR"] },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, email: true, name: true, role: true, userType: true },
  });
  expect(internalUser, "Phase 0 operator audit requires an existing internal account").toBeTruthy();
  expect(process.env.AUTH_SECRET, "Phase 0 operator audit requires AUTH_SECRET").toBeTruthy();
  const operatorToken = await encode({
    secret: process.env.AUTH_SECRET!,
    maxAge: 12 * 60 * 60,
    token: {
      id: internalUser!.id,
      email: internalUser!.email,
      name: internalUser!.name,
      role: internalUser!.role,
      userType: internalUser!.userType as "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN" | null,
    },
  });
  const operatorContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    colorScheme: "light",
  });
  await operatorContext.addCookies([
    {
      name: "next-auth.session-token",
      value: operatorToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "__Secure-next-auth.session-token",
      value: operatorToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  const scans: RouteScan[] = [];
  for (const target of await resolveTargets()) {
    const context =
      target.surface === "public" || target.surface === "auth"
        ? publicContext
        : target.surface === "operator"
          ? operatorContext
          : authContext;
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: RouteScan["failedRequests"] = [];
    const errorResponses: RouteScan["errorResponses"] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
      if (message.type() === "warning") consoleWarnings.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText ?? null });
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        errorResponses.push({ status: response.status(), method: response.request().method(), url: response.url() });
      }
    });

    const response = await page.goto(target.path, { waitUntil: "domcontentloaded" });
    let networkIdle = true;
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {
      networkIdle = false;
    });
    await expect(page.locator("body")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const documentWidth = document.documentElement.scrollWidth;
      const overflowingElements = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            className: typeof element.className === "string" ? element.className.slice(0, 160) || null : null,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1,
          };
        })
        .filter((entry) => entry.visible && (entry.left < -1 || entry.right > viewportWidth + 1))
        .slice(0, 20)
        .map((entry) => ({
          tag: entry.tag,
          id: entry.id,
          className: entry.className,
          left: entry.left,
          right: entry.right,
          width: entry.width,
        }));
      return { viewportWidth, documentWidth, overflowingElements };
    });

    const screenshot = path.join(screenshotDir, `${slugForRoute(target.template)}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    const bodyExcerpt = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700);
    scans.push({
      ...target,
      finalUrl: page.url(),
      documentStatus: response?.status() ?? null,
      title: await page.title(),
      consoleErrors,
      consoleWarnings,
      pageErrors,
      failedRequests,
      errorResponses,
      overflow,
      bodyExcerpt,
      screenshot: path.relative(process.cwd(), screenshot),
      networkIdle,
    });
    await page.close();
  }

  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseURL,
        viewport: { width: 1440, height: 1000 },
        routeCount: scans.length,
        scans,
      },
      null,
      2,
    ),
  );
  expect(scans).toHaveLength(33);
  await publicContext.close();
  await authContext.close();
  await operatorContext.close();
});
