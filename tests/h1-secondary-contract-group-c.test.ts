import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import Stripe from "stripe";

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

const qaRoute = require("../src/app/api/qa/route.ts") as MutableRecord;
const qaDecisionRoute = require("../src/app/api/qa/[id]/route.ts") as MutableRecord;
const briefQaRoute = require("../src/app/api/briefs/[id]/qa/route.ts") as MutableRecord;
const publishRoute = require("../src/app/api/publish/route.ts") as MutableRecord;
const publishItemRoute = require("../src/app/api/publish/[id]/route.ts") as MutableRecord;
const reportsRoute = require("../src/app/api/reports/route.ts") as MutableRecord;
const internalReportsRoute = require("../src/app/api/internal/reports/route.ts") as MutableRecord;
const internalReportRoute = require("../src/app/api/internal/reports/[id]/route.ts") as MutableRecord;
const waitlistRoute = require("../src/app/api/demo/real-footage-ads/waitlist/route.ts") as MutableRecord;
const personaRoute = require("../src/app/api/persona/route.ts") as MutableRecord;
const digitalHumanAvatarsRoute = require("../src/app/api/digital-human/avatars/route.ts") as MutableRecord;
const digitalHumanVoicesRoute = require("../src/app/api/digital-human/voices/route.ts") as MutableRecord;
const digitalHumanJobsRoute = require("../src/app/api/digital-human/jobs/route.ts") as MutableRecord;
const digitalHumanJobRoute = require("../src/app/api/digital-human/jobs/[id]/route.ts") as MutableRecord;
const digitalHumanClaimRoute = require("../src/app/api/internal/digital-human/claim/route.ts") as MutableRecord;
const digitalHumanCompleteRoute = require("../src/app/api/internal/digital-human/complete/route.ts") as MutableRecord;
const stripeWebhookRoute = require("../src/app/api/webhooks/stripe/route.ts") as MutableRecord;
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

const SEALED = {
  error: "该功能当前不可用",
  code: "FEATURE_SEALED",
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

  await t.test("QA GET/POST and brief QA lock auth, validation, and success shapes", async (st) => {
    const qaReview = db.qAReview as MutableRecord;
    const videoBrief = db.videoBrief as MutableRecord;
    const publishRecord = db.publishRecord as MutableRecord;
    let listArgs: unknown;

    patch(st, qaReview, {
      findMany: async (args: unknown) => {
        listArgs = args;
        return [{ id: "qa-list-1", status: "PENDING" }];
      },
      findUnique: async () => ({
        id: "qa-review-1",
        videoBriefId: "brief-1",
        reviewerComment: null,
        videoBrief: { id: "brief-1" },
      }),
      findFirst: async () => ({ id: "qa-ai-existing" }),
      update: async (args: { where: { id: string } }) =>
        args.where.id === "qa-ai-existing"
          ? { id: "qa-ai-existing", status: "PENDING", aiOverallScore: 7 }
          : { id: "qa-review-1", status: "APPROVED", reviewerId: sessions.reviewer.user.id },
    });
    patch(st, videoBrief, {
      findUnique: async () => ({
        id: "brief-ai-1",
        contentAngle: { title: "Title", hook: "Hook", narrative: "Narrative" },
        durationSec: 15,
        onCameraMode: "none",
        scripts: [],
        videoJobs: [],
      }),
      update: async () => ({ id: "brief-1", status: "QA_APPROVED" }),
    });
    patch(st, publishRecord, {
      findFirst: async () => ({ id: "publish-existing" }),
    });

    const decision = handler<
      (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>
    >(qaDecisionRoute, "POST");
    const briefQa = handler<
      (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>
    >(briefQaRoute, "POST");
    const validDecisionRequest = () =>
      jsonRequest("/api/qa/qa-review-1", "POST", { decision: "APPROVED" });
    const briefQaRequest = () => jsonRequest("/api/briefs/brief-ai-1/qa", "POST", {});

    activeSession = null;
    await assertJson(
      await handler<(request: NextRequest) => Promise<Response>>(qaRoute, "GET")(
        new NextRequest("http://localhost/api/qa"),
      ),
      401,
      AUTH_REQUIRED,
    );
    await assertJson(
      await decision(validDecisionRequest(), {
        params: Promise.resolve({ id: "qa-review-1" }),
      }),
      401,
      AUTH_REQUIRED,
    );
    await assertJson(
      await briefQa(briefQaRequest(), {
        params: Promise.resolve({ id: "brief-ai-1" }),
      }),
      401,
      AUTH_REQUIRED,
    );
    activeSession = sessions.customer;
    await assertJson(
      await handler<(request: NextRequest) => Promise<Response>>(qaRoute, "GET")(
        new NextRequest("http://localhost/api/qa"),
      ),
      403,
      FORBIDDEN,
    );
    await assertJson(
      await decision(validDecisionRequest(), {
        params: Promise.resolve({ id: "qa-review-1" }),
      }),
      403,
      FORBIDDEN,
    );
    await assertJson(
      await briefQa(briefQaRequest(), {
        params: Promise.resolve({ id: "brief-ai-1" }),
      }),
      403,
      FORBIDDEN,
    );

    activeSession = sessions.reviewer;
    await assertJson(
      await handler<(request: NextRequest) => Promise<Response>>(qaRoute, "GET")(
        new NextRequest("http://localhost/api/qa?status=all"),
      ),
      200,
      { items: [{ id: "qa-list-1", status: "PENDING" }] },
    );
    assert.deepEqual((listArgs as { where: unknown }).where, {});

    await assertJson(
      await decision(jsonRequest("/api/qa/qa-review-1", "POST", { decision: "INVALID" }), {
        params: Promise.resolve({ id: "qa-review-1" }),
      }),
      400,
      {
        error: "参数错误",
        details: {
          formErrors: [],
          fieldErrors: {
            decision: [
              "Invalid enum value. Expected 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', received 'INVALID'",
            ],
          },
        },
      },
    );
    await assertJson(
      await decision(
        jsonRequest("/api/qa/qa-review-1", "POST", {
          decision: "APPROVED",
          comment: "contract approved",
        }),
        { params: Promise.resolve({ id: "qa-review-1" }) },
      ),
      200,
      { id: "qa-review-1", status: "APPROVED", reviewerId: sessions.reviewer.user.id },
    );

    await assertJson(
      await briefQa(
        briefQaRequest(),
        { params: Promise.resolve({ id: "brief-ai-1" }) },
      ),
      200,
      { id: "qa-ai-existing", status: "PENDING", aiOverallScore: 7 },
    );
  });

  await t.test("publish GET/POST lock operator auth, validation, and success shapes", async (st) => {
    const publishRecord = db.publishRecord as MutableRecord;
    patch(st, publishRecord, {
      findMany: async () => [{ id: "publish-1", status: "PENDING" }],
      update: async () => ({ id: "publish-1", status: "DOWNLOADED" }),
    });

    const list = handler<() => Promise<Response>>(publishRoute, "GET");
    const mutate = handler<
      (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>
    >(publishItemRoute, "POST");
    const downloadRequest = () => jsonRequest("/api/publish/publish-1", "POST", { action: "download" });

    activeSession = null;
    await assertJson(await list(), 401, AUTH_REQUIRED);
    await assertJson(
      await mutate(downloadRequest(), { params: Promise.resolve({ id: "publish-1" }) }),
      401,
      AUTH_REQUIRED,
    );
    activeSession = sessions.customer;
    await assertJson(await list(), 403, FORBIDDEN);
    await assertJson(
      await mutate(downloadRequest(), { params: Promise.resolve({ id: "publish-1" }) }),
      403,
      FORBIDDEN,
    );

    activeSession = sessions.operator;
    await assertJson(await list(), 200, { items: [{ id: "publish-1", status: "PENDING" }] });
    await assertJson(
      await mutate(jsonRequest("/api/publish/publish-1", "POST", { action: "unknown" }), {
        params: Promise.resolve({ id: "publish-1" }),
      }),
      400,
      { error: "不支持的 action" },
    );
    await assertJson(
      await mutate(downloadRequest(), { params: Promise.resolve({ id: "publish-1" }) }),
      200,
      { id: "publish-1", status: "DOWNLOADED" },
    );
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

  await t.test("public demo waitlist locks validation and accepted response without external IO", async (st) => {
    const lead = db.realFootageDemoLead as MutableRecord;
    let created: unknown;
    patch(st, lead, {
      create: async (args: unknown) => {
        created = args;
        return { id: "lead-contract" };
      },
    });
    const post = handler<(request: NextRequest) => Promise<Response>>(waitlistRoute, "POST");

    const invalid = await post(
      jsonRequest("/api/demo/real-footage-ads/waitlist", "POST", {
        name: "",
        businessType: "ecommerce",
        monthlyVolume: "51-200",
        painPoint: "Need reliable batch ads",
        email: "contract-lead@example.com",
      }),
    );
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "请填写姓名。" });

    await assertJson(
      await post(
        jsonRequest("/api/demo/real-footage-ads/waitlist", "POST", {
          name: "Contract Lead",
          businessType: "ecommerce",
          monthlyVolume: "51-200",
          painPoint: "Need reliable batch ads",
          email: "contract-lead@example.com",
        }),
      ),
      200,
      { ok: true, message: "已收到，我们会联系你安排 demo。" },
    );
    assert.deepEqual(created, {
      data: {
        name: "Contract Lead",
        businessType: "ecommerce",
        monthlyVolume: "51-200",
        painPoint: "Need reliable batch ads",
        email: "contract-lead@example.com",
        source: "demo/real-footage-ads",
      },
    });
  });

  await t.test("persona POST locks anonymous, validation, and persisted success shapes", async (st) => {
    const adminUser = db.adminUser as MutableRecord;
    let updateArgs: unknown;
    patch(st, adminUser, {
      update: async (args: unknown) => {
        updateArgs = args;
        return { id: sessions.customer.user.id };
      },
    });
    const post = handler<(request: NextRequest) => Promise<Response>>(personaRoute, "POST");

    activeSession = null;
    await assertJson(
      await post(jsonRequest("/api/persona", "POST", { persona: "PERSONAL" })),
      401,
      AUTH_REQUIRED,
    );
    activeSession = sessions.customer;
    const invalid = await post(jsonRequest("/api/persona", "POST", { persona: "OPERATOR" }));
    assert.equal(invalid.status, 400);
    const invalidBody = (await invalid.json()) as Record<string, unknown>;
    assert.equal(invalidBody.ok, false);
    assert.equal(invalidBody.error, "Invalid persona");
    assert.ok(invalidBody.issues);

    await assertJson(
      await post(jsonRequest("/api/persona", "POST", { persona: "BUSINESS" })),
      200,
      { ok: true, persona: "BUSINESS" },
    );
    assert.deepEqual(updateArgs, {
      where: { id: sessions.customer.user.id },
      data: { userType: "BUSINESS" },
    });
  });

  await t.test("all digital-human HTTP methods remain sealed before user/service work", async (st) => {
    const previousSecret = process.env.CRON_SECRET;
    st.after(() => {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    });

    const sealedResponses: Array<Promise<Response>> = [
      handler<() => Promise<Response>>(digitalHumanAvatarsRoute, "GET")(),
      handler<() => Promise<Response>>(digitalHumanVoicesRoute, "GET")(),
      handler<() => Promise<Response>>(digitalHumanJobsRoute, "GET")(),
      handler<(request: NextRequest) => Promise<Response>>(digitalHumanJobsRoute, "POST")(
        jsonRequest("/api/digital-human/jobs", "POST", {}),
      ),
      handler<
        (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>
      >(digitalHumanJobRoute, "GET")(
        new NextRequest("http://localhost/api/digital-human/jobs/sealed"),
        { params: Promise.resolve({ id: "sealed" }) },
      ),
    ];
    for (const response of await Promise.all(sealedResponses)) {
      await assertJson(response, 404, SEALED);
    }

    const claimGet = handler<(request: NextRequest) => Promise<Response>>(digitalHumanClaimRoute, "GET");
    const claimPost = handler<(request: NextRequest) => Promise<Response>>(digitalHumanClaimRoute, "POST");
    const complete = handler<(request: NextRequest) => Promise<Response>>(digitalHumanCompleteRoute, "POST");

    delete process.env.CRON_SECRET;
    await assertJson(
      await claimGet(new NextRequest("http://localhost/api/internal/digital-human/claim")),
      503,
      { error: "service unavailable" },
    );

    process.env.CRON_SECRET = "contract-machine-secret";
    const wrongAuth = { authorization: "Bearer wrong" };
    await assertJson(
      await claimGet(
        new NextRequest("http://localhost/api/internal/digital-human/claim", { headers: wrongAuth }),
      ),
      401,
      { error: "unauthorized" },
    );
    await assertJson(
      await claimPost(
        new NextRequest("http://localhost/api/internal/digital-human/claim", {
          method: "POST",
          headers: wrongAuth,
        }),
      ),
      401,
      { error: "unauthorized" },
    );
    await assertJson(
      await complete(
        jsonRequest(
          "/api/internal/digital-human/complete",
          "POST",
          {},
          wrongAuth,
        ),
      ),
      401,
      { error: "unauthorized" },
    );

    const validAuth = { authorization: "Bearer contract-machine-secret" };
    await assertJson(
      await claimGet(
        new NextRequest("http://localhost/api/internal/digital-human/claim", { headers: validAuth }),
      ),
      404,
      SEALED,
    );
    await assertJson(
      await claimPost(
        new NextRequest("http://localhost/api/internal/digital-human/claim", {
          method: "POST",
          headers: validAuth,
        }),
      ),
      404,
      SEALED,
    );
    await assertJson(
      await complete(
        jsonRequest(
          "/api/internal/digital-human/complete",
          "POST",
          {},
          validAuth,
        ),
      ),
      404,
      SEALED,
    );
  });

  await t.test("Stripe webhook locks missing/invalid signatures and offline valid receipt", async (st) => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const originalConsoleError = console.error;
    const loggedErrors: unknown[][] = [];
    process.env.STRIPE_SECRET_KEY = "sk_test_contract";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_contract";
    console.error = (...args: unknown[]) => loggedErrors.push(args);
    st.after(() => {
      console.error = originalConsoleError;
      if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    });

    const post = handler<(request: NextRequest) => Promise<Response>>(stripeWebhookRoute, "POST");
    const payload = JSON.stringify({
      id: "evt_contract",
      object: "event",
      api_version: "2024-06-20",
      created: 1,
      data: { object: {} },
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type: "ping",
    });

    await assertJson(
      await post(
        new NextRequest("http://localhost/api/webhooks/stripe", {
          method: "POST",
          body: payload,
        }),
      ),
      400,
      { error: "缺少签名" },
    );

    const badSignature = await post(
      new NextRequest("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "invalid" },
        body: payload,
      }),
    );
    assert.equal(badSignature.status, 400);
    assert.match(
      String((await badSignature.json() as { error: string }).error),
      /timestamp|signature/i,
    );
    assert.equal(loggedErrors.length, 1);

    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_contract",
    });
    await assertJson(
      await post(
        new NextRequest("http://localhost/api/webhooks/stripe", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: payload,
        }),
      ),
      200,
      { received: true },
    );
  });

  await t.test("Stripe webhook is exactly reachable through middleware while sibling paths stay protected", async (st) => {
    const previousAuthSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "stripe-middleware-contract-secret";
    st.after(() => {
      if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousAuthSecret;
    });

    const webhook = await middleware(
      new NextRequest("https://app.aivora.example/api/webhooks/stripe", {
        method: "POST",
      }),
    );
    assert.equal(webhook.status, 200);
    assert.equal(webhook.headers.get("x-middleware-next"), "1");

    await assertJson(
      await middleware(
        new NextRequest("https://app.aivora.example/api/webhooks/stripe/extra", {
          method: "POST",
        }),
      ),
      401,
      AUTH_REQUIRED,
    );
  });

  await t.test("route-method matrix and NextAuth handler wiring are explicit", async () => {
    const matrix: Array<[string, MutableRecord, string[]]> = [
      ["/api/qa", qaRoute, ["GET"]],
      ["/api/qa/[id]", qaDecisionRoute, ["POST"]],
      ["/api/briefs/[id]/qa", briefQaRoute, ["POST"]],
      ["/api/publish", publishRoute, ["GET"]],
      ["/api/publish/[id]", publishItemRoute, ["POST"]],
      ["/api/reports", reportsRoute, ["POST"]],
      ["/api/internal/reports", internalReportsRoute, ["GET"]],
      ["/api/internal/reports/[id]", internalReportRoute, ["PATCH"]],
      ["/api/demo/real-footage-ads/waitlist", waitlistRoute, ["POST"]],
      ["/api/persona", personaRoute, ["POST"]],
      ["/api/digital-human/avatars", digitalHumanAvatarsRoute, ["GET"]],
      ["/api/digital-human/voices", digitalHumanVoicesRoute, ["GET"]],
      ["/api/digital-human/jobs", digitalHumanJobsRoute, ["GET", "POST"]],
      ["/api/digital-human/jobs/[id]", digitalHumanJobRoute, ["GET"]],
      ["/api/internal/digital-human/claim", digitalHumanClaimRoute, ["GET", "POST"]],
      ["/api/internal/digital-human/complete", digitalHumanCompleteRoute, ["POST"]],
      ["/api/webhooks/stripe", stripeWebhookRoute, ["POST"]],
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
