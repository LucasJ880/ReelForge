import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";

const require = createRequire(import.meta.url);

type MutableRecord = Record<string, unknown>;
type ContractSession = {
  user: {
    id: string;
    email: string;
    name: string;
    role: "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";
    userType: "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN" | null;
  };
  expires: string;
};

const nextAuthRuntime = require("next-auth/next") as MutableRecord;
const { db } = require("../src/lib/db.ts") as { db: Record<string, unknown> };

const reportsRoute = require("../src/app/api/reports/route.ts") as MutableRecord;
const internalReportsRoute = require("../src/app/api/internal/reports/route.ts") as MutableRecord;
const internalReportRoute = require("../src/app/api/internal/reports/[id]/route.ts") as MutableRecord;
const nextAuthRoute = require("../src/app/api/auth/[...nextauth]/route.ts") as MutableRecord;
const { middleware } = require("../src/middleware.ts") as {
  middleware: (request: NextRequest) => Promise<Response>;
};

const AUTH_REQUIRED = {
  ok: false,
  code: "AUTH_REQUIRED",
  error: "未登录",
  retryable: false,
  action: "sign_in",
};

const FORBIDDEN = {
  ok: false,
  code: "FORBIDDEN",
  error: "权限不足",
  retryable: false,
  action: "contact_support",
};


const sessions = {
  customer: {
    user: {
      id: "customer-contract",
      email: "customer-contract@example.com",
      name: "Contract Customer",
      role: "CUSTOMER",
      userType: "PERSONAL",
    },
    expires: "2099-01-01T00:00:00.000Z",
  },
  reviewer: {
    user: {
      id: "reviewer-contract",
      email: "reviewer-contract@example.com",
      name: "Contract Reviewer",
      role: "REVIEWER",
      userType: null,
    },
    expires: "2099-01-01T00:00:00.000Z",
  },
  operator: {
    user: {
      id: "operator-contract",
      email: "operator-contract@example.com",
      name: "Contract Operator",
      role: "OPERATOR",
      userType: "OPERATOR",
    },
    expires: "2099-01-01T00:00:00.000Z",
  },
} satisfies Record<string, ContractSession>;

let activeSession: ContractSession | null = null;

function patch(
  t: TestContext,
  target: MutableRecord,
  values: MutableRecord,
): void {
  const originals: MutableRecord = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

function jsonRequest(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function assertJson(
  response: Response,
  status: number,
  body: unknown,
): Promise<void> {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), body);
}

function handler<T extends (...args: never[]) => Promise<Response>>(
  route: MutableRecord,
  method: string,
): T {
  const value = route[method];
  assert.equal(typeof value, "function", `${method} handler must be exported`);
  return value as T;
}

test("H1 secondary contracts group C", async (t) => {
  patch(t, nextAuthRuntime, {
    getServerSession: async () => activeSession,
  });

  await t.test("customer and internal reports lock ownership, staff auth, validation, and success", async (st) => {
    const videoBrief = db.videoBrief as MutableRecord;
    const contentReport = db.contentReport as MutableRecord;
    let ownerId = sessions.customer.user.id;

    patch(st, videoBrief, {
      findUnique: async () => ({
        id: "brief-report-1",
        persona: "PERSONAL",
        contentAngle: {
          round: { deliveryOrder: { createdById: ownerId } },
        },
      }),
    });
    patch(st, contentReport, {
      create: async () => ({ id: "report-1", status: "OPEN" }),
      findMany: async () => [{ id: "report-1", status: "OPEN" }],
      findUnique: async () => ({
        id: "report-1",
        status: "OPEN",
        targetBriefId: "brief-report-1",
      }),
      update: async () => ({ id: "report-1", status: "REVIEWING", resolutionNote: "checked" }),
    });

    const createReport = handler<(request: Request) => Promise<Response>>(reportsRoute, "POST");
    const listReports = handler<() => Promise<Response>>(internalReportsRoute, "GET");
    const updateReport = handler<
      (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>
    >(internalReportRoute, "PATCH");

    activeSession = null;
    await assertJson(
      await createReport(jsonRequest("/api/reports", "POST", {})),
      401,
      AUTH_REQUIRED,
    );
    await assertJson(await listReports(), 401, AUTH_REQUIRED);
    await assertJson(
      await updateReport(jsonRequest("/api/internal/reports/report-1", "PATCH", {}), {
        params: Promise.resolve({ id: "report-1" }),
      }),
      401,
      AUTH_REQUIRED,
    );

    activeSession = sessions.customer;
    await assertJson(
      await createReport(jsonRequest("/api/reports", "POST", {})),
      400,
      { error: "举报信息不完整" },
    );
    ownerId = "another-customer";
    await assertJson(
      await createReport(
        jsonRequest("/api/reports", "POST", {
          briefId: "brief-report-1",
          reason: "MISLEADING",
          details: "ownership contract",
        }),
      ),
      404,
      { error: "找不到该视频" },
    );
    ownerId = sessions.customer.user.id;
    await assertJson(
      await createReport(
        jsonRequest("/api/reports", "POST", {
          briefId: "brief-report-1",
          reason: "MISLEADING",
          details: "ownership contract",
        }),
      ),
      201,
      { report: { id: "report-1", status: "OPEN" } },
    );
    await assertJson(await listReports(), 403, FORBIDDEN);
    await assertJson(
      await updateReport(
        jsonRequest("/api/internal/reports/report-1", "PATCH", {
          action: "review",
          resolutionNote: "checked",
        }),
        { params: Promise.resolve({ id: "report-1" }) },
      ),
      403,
      FORBIDDEN,
    );

    activeSession = sessions.operator;
    await assertJson(await listReports(), 200, {
      reports: [{ id: "report-1", status: "OPEN" }],
    });
    await assertJson(
      await updateReport(jsonRequest("/api/internal/reports/report-1", "PATCH", {}), {
        params: Promise.resolve({ id: "report-1" }),
      }),
      400,
      { error: "处理说明不能为空" },
    );
    await assertJson(
      await updateReport(
        jsonRequest("/api/internal/reports/report-1", "PATCH", {
          action: "review",
          resolutionNote: "checked",
        }),
        { params: Promise.resolve({ id: "report-1" }) },
      ),
      200,
      { report: { id: "report-1", status: "REVIEWING", resolutionNote: "checked" } },
    );
  });

  await t.test("removed Stripe webhook path is no longer let through middleware", async (st) => {
    /// 2026-11-16 线上收款定了不做，webhook 路由已删；放行名单里也不能留着这一条。
    const previousAuthSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "removed-webhook-middleware-contract-secret";
    st.after(() => {
      if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousAuthSecret;
    });

    /// 同一天删的还有旧 demo 的候补登记接口（/api/demo/real-footage-ads/waitlist，没有任何页面在调）：
    /// 放行名单里的 `/api/demo` 一并拿掉，匿名请求和别的接口一样回 401。
    for (const path of ["/api/webhooks/stripe", "/api/webhooks/stripe/extra", "/api/demo/real-footage-ads/waitlist"]) {
      await assertJson(
        await middleware(
          new NextRequest(`https://app.aivora.example${path}`, {
            method: "POST",
          }),
        ),
        401,
        AUTH_REQUIRED,
      );
    }
  });

  await t.test("route-method matrix and NextAuth handler wiring are explicit", async () => {
    const matrix: Array<[string, MutableRecord, string[]]> = [
      ["/api/reports", reportsRoute, ["POST"]],
      ["/api/internal/reports", internalReportsRoute, ["GET"]],
      ["/api/internal/reports/[id]", internalReportRoute, ["PATCH"]],
      ["/api/auth/[...nextauth]", nextAuthRoute, ["GET", "POST"]],
    ];
    const httpMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
    for (const [path, route, expectedMethods] of matrix) {
      const actual = Object.keys(route).filter((key) => httpMethods.has(key)).sort();
      assert.deepEqual(actual, [...expectedMethods].sort(), `${path} method inventory changed`);
    }

    assert.equal(nextAuthRoute.GET, nextAuthRoute.POST, "NextAuth GET and POST must share one handler");
    const source = await readFile("src/app/api/auth/[...nextauth]/route.ts", "utf8");
    assert.match(source, /const handler = NextAuth\(authOptions\)/);
    assert.match(source, /export \{ handler as GET, handler as POST \}/);
    // NextAuth's handler reads Next request async-storage. Calling it from this
    // node:test process would not be dynamic HTTP, so this test deliberately
    // locks module inventory and wiring instead of claiming a runtime response.
  });
});
