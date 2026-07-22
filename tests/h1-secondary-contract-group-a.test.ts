import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { customerApiErrorSchema } from "../src/lib/contracts/customer-api";
import { middleware } from "../src/middleware";

type Boundary =
  | "public"
  | "session"
  | "generation-session"
  | "operator"
  | "reviewer"
  | "owner-session";

interface RouteMethodContract {
  method: "GET" | "POST" | "PATCH";
  route: string;
  file: string;
  boundary: Boundary;
  successMarker: RegExp;
}

/**
 * H1 second-tier group A is deliberately a light contract suite.
 *
 * `successMarker` is STATIC route-wiring evidence. It locks the public DTO or
 * response constructor without executing database writes, LLM/provider calls,
 * Stripe, storage, or other network work. Authentication below is exercised
 * DYNAMICALLY through the real middleware for every protected HTTP method.
 */
const contracts: RouteMethodContract[] = [
  {
    method: "GET",
    route: "/api/auth/session",
    file: "src/app/api/auth/[...nextauth]/route.ts",
    boundary: "public",
    successMarker: /export \{ handler as GET, handler as POST \}/,
  },
  {
    method: "POST",
    route: "/api/auth/callback/credentials",
    file: "src/app/api/auth/[...nextauth]/route.ts",
    boundary: "public",
    successMarker: /const handler = NextAuth\(authOptions\)/,
  },
  {
    method: "POST",
    route: "/api/auth/register",
    file: "src/app/api/auth/register/route.ts",
    boundary: "public",
    successMarker:
      /NextResponse\.json\(\{ ok: true, persona: "PERSONAL" \}\)/,
  },
  {
    method: "GET",
    route: "/api/me/usage",
    file: "src/app/api/me/usage/route.ts",
    boundary: "session",
    successMarker:
      /loadUsagePayloadForSession[\s\S]*return NextResponse\.json\(payload\)/,
  },
  {
    method: "POST",
    route: "/api/billing/checkout",
    file: "src/app/api/billing/checkout/route.ts",
    boundary: "session",
    successMarker: /NextResponse\.json\(\{ url: result\.url \}\)/,
  },
  {
    method: "POST",
    route: "/api/personal/agent-chat",
    file: "src/app/api/personal/agent-chat/route.ts",
    boundary: "generation-session",
    successMarker:
      /NextResponse\.json\(\{ ok: true, \.\.\.fallbackReply\([\s\S]*\}\)/,
  },
  {
    method: "POST",
    route: "/api/video-generation/plan",
    file: "src/app/api/video-generation/plan/route.ts",
    boundary: "generation-session",
    successMarker: /NextResponse\.json\(\{ ok: true, plan \}\)/,
  },
  {
    method: "POST",
    route: "/api/video-generation/classify-asset",
    file: "src/app/api/video-generation/classify-asset/route.ts",
    boundary: "generation-session",
    successMarker:
      /NextResponse\.json\(\{ ok: true, classification \}\)/,
  },
  {
    method: "GET",
    route: "/api/briefs/contract-brief",
    file: "src/app/api/briefs/[id]/route.ts",
    boundary: "operator",
    successMarker: /return NextResponse\.json\(brief\)/,
  },
  {
    method: "PATCH",
    route: "/api/briefs/contract-brief",
    file: "src/app/api/briefs/[id]/route.ts",
    boundary: "operator",
    successMarker: /data: parsed\.data[\s\S]*NextResponse\.json\(brief\)/,
  },
  {
    method: "POST",
    route: "/api/briefs/contract-brief/ad-plan",
    file: "src/app/api/briefs/[id]/ad-plan/route.ts",
    boundary: "operator",
    successMarker:
      /generateAdEditPlanForBrief\(id\)[\s\S]*NextResponse\.json\(plan\)/,
  },
  {
    method: "POST",
    route: "/api/briefs/contract-brief/scenes",
    file: "src/app/api/briefs/[id]/scenes/route.ts",
    boundary: "operator",
    successMarker: /NextResponse\.json\(\{ scenes \}\)/,
  },
  {
    method: "POST",
    route: "/api/briefs/contract-brief/script",
    file: "src/app/api/briefs/[id]/script/route.ts",
    boundary: "operator",
    successMarker:
      /generateScriptForBrief\(id\)[\s\S]*NextResponse\.json\(script\)/,
  },
  {
    method: "POST",
    route: "/api/briefs/contract-brief/render",
    file: "src/app/api/briefs/[id]/render/route.ts",
    boundary: "operator",
    successMarker:
      /NextResponse\.json\(\{ plan \}\)[\s\S]*NextResponse\.json\(\{ jobs \}\)/,
  },
  {
    method: "GET",
    route: "/api/briefs/contract-brief/render-status",
    file: "src/app/api/briefs/[id]/render-status/route.ts",
    boundary: "owner-session",
    successMarker:
      /summarizeBriefRender\(id\)[\s\S]*presentSummary\(summary, guard\.session\.user\.userType\)/,
  },
  {
    method: "POST",
    route: "/api/briefs/contract-brief/render-status",
    file: "src/app/api/briefs/[id]/render-status/route.ts",
    boundary: "owner-session",
    successMarker:
      /reconcileBriefRenderStatus\(id\)[\s\S]*presentSummary\(summary, guard\.session\.user\.userType\)/,
  },
  {
    method: "POST",
    route: "/api/briefs/contract-brief/render-retry",
    file: "src/app/api/briefs/[id]/render-retry/route.ts",
    boundary: "owner-session",
    successMarker:
      /reconcileBriefRenderStatus\(briefId\)[\s\S]*toCustomerBriefRenderSummary\(summary\)/,
  },
  {
    method: "POST",
    route: "/api/briefs/contract-brief/qa",
    file: "src/app/api/briefs/[id]/qa/route.ts",
    boundary: "reviewer",
    successMarker: /runAIQA\(id\)[\s\S]*NextResponse\.json\(review\)/,
  },
  {
    method: "POST",
    route: "/api/ad-plans/contract-plan/render",
    file: "src/app/api/ad-plans/[id]/render/route.ts",
    boundary: "operator",
    successMarker: /renderAdEditPlan\(id\)[\s\S]*NextResponse\.json\(plan\)/,
  },
  {
    method: "GET",
    route: "/api/product-images",
    file: "src/app/api/product-images/route.ts",
    boundary: "session",
    successMarker: /NextResponse\.json\(\{ ok: true, jobs \}\)/,
  },
  {
    method: "POST",
    route: "/api/product-images",
    file: "src/app/api/product-images/route.ts",
    boundary: "session",
    successMarker:
      /duplicate: false,[\s\S]*asset: sourceAsset[\s\S]*\{ status: 201 \}/,
  },
  {
    method: "POST",
    route: "/api/raw-assets/contract-asset/preprocess",
    file: "src/app/api/raw-assets/[id]/preprocess/route.ts",
    boundary: "operator",
    successMarker:
      /preprocessRawAsset\(id, parsed\.data\)[\s\S]*NextResponse\.json\(asset\)/,
  },
  {
    method: "POST",
    route: "/api/projects/contract-project/logo/generate",
    file: "src/app/api/projects/[id]/logo/generate/route.ts",
    boundary: "operator",
    successMarker:
      /generateLogoCandidates\(\{[\s\S]*deliveryOrderId: id[\s\S]*NextResponse\.json\(result\)/,
  },
  {
    method: "POST",
    route: "/api/projects/contract-project/logo/select",
    file: "src/app/api/projects/[id]/logo/select/route.ts",
    boundary: "operator",
    successMarker:
      /selectLogo\(\{[\s\S]*deliveryOrderId: id[\s\S]*NextResponse\.json\(result\)/,
  },
];

const guardMarkers: Record<Exclude<Boundary, "public">, RegExp> = {
  session: /const guard = await requireAuth\(\)/,
  "generation-session":
    /const guard = await requireUserOfTypeForGeneration\(\)/,
  operator: /const guard = await requireOperator\(\)/,
  reviewer: /const guard = await requireReviewer\(\)/,
  "owner-session": /const guard = await requireAuth\(\)/,
};

function routeSource(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

test("H1 group A STATIC: all 24 route methods lock a success shape and handler boundary", () => {
  assert.equal(contracts.length, 24);
  assert.equal(
    new Set(contracts.map(({ method, route }) => `${method} ${route}`)).size,
    contracts.length,
    "each HTTP method must have exactly one light-contract row",
  );

  for (const contract of contracts) {
    const source = routeSource(contract.file);
    const exported =
      new RegExp(`export async function ${contract.method}\\b`).test(source) ||
      new RegExp(`handler as ${contract.method}\\b`).test(source);
    assert.equal(
      exported,
      true,
      `${contract.method} ${contract.route} must remain exported`,
    );
    assert.match(
      source,
      contract.successMarker,
      `${contract.method} ${contract.route} success DTO/response wiring drifted`,
    );

    if (contract.boundary !== "public") {
      assert.match(
        source,
        guardMarkers[contract.boundary],
        `${contract.method} ${contract.route} must retain its in-handler guard`,
      );
      assert.match(
        source,
        /if \(!guard\.ok\) return guard\.response/,
        `${contract.method} ${contract.route} must stop before side effects when denied`,
      );
    }
  }
});

test("H1 group A DYNAMIC EDGE: every protected method returns the shared unauthenticated contract", async () => {
  const previousSecret = process.env.AUTH_SECRET;
  const previousUrl = process.env.NEXTAUTH_URL;
  process.env.AUTH_SECRET = "h1-secondary-group-a-secret";
  process.env.NEXTAUTH_URL = "https://contract.reelforge.example";

  try {
    for (const contract of contracts.filter(
      ({ boundary }) => boundary !== "public",
    )) {
      const response = await middleware(
        new NextRequest(
          `https://contract.reelforge.example${contract.route}`,
          { method: contract.method },
        ),
      );
      assert.equal(
        response.status,
        401,
        `${contract.method} ${contract.route} must reject an anonymous request`,
      );
      assert.deepEqual(customerApiErrorSchema.parse(await response.json()), {
        ok: false,
        code: "AUTH_REQUIRED",
        error: "未登录",
        retryable: false,
        action: "sign_in",
      });
    }
  } finally {
    restoreEnvironment("AUTH_SECRET", previousSecret);
    restoreEnvironment("NEXTAUTH_URL", previousUrl);
  }
});

test("H1 group A DYNAMIC EDGE: auth handlers stay public and registration validation runs without a session", async () => {
  const previousSecret = process.env.AUTH_SECRET;
  const previousUrl = process.env.NEXTAUTH_URL;
  process.env.AUTH_SECRET = "h1-secondary-group-a-public-secret";
  process.env.NEXTAUTH_URL = "https://contract.reelforge.example";

  try {
    for (const contract of contracts.filter(
      ({ boundary }) => boundary === "public",
    )) {
      const response = await middleware(
        new NextRequest(
          `https://contract.reelforge.example${contract.route}`,
          { method: contract.method },
        ),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    }

    // Invalid JSON exits before rate-limit, database, or password hashing. This
    // safely proves that the public registration handler itself is reachable.
    const imported = (await import("../src/app/api/auth/register/route")) as {
      default?: { POST?: (request: NextRequest) => Promise<Response> };
      POST?: (request: NextRequest) => Promise<Response>;
    };
    const registerPost = imported.POST ?? imported.default?.POST;
    assert.ok(registerPost);
    const invalid = await registerPost(
      new NextRequest("https://contract.reelforge.example/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      ok: false,
      error: "请求格式错误",
    });
  } finally {
    restoreEnvironment("AUTH_SECRET", previousSecret);
    restoreEnvironment("NEXTAUTH_URL", previousUrl);
  }
});

test("H1 group A STATIC: staff and owner-scoped routes cannot silently lose authorization", () => {
  const operatorFiles = new Set(
    contracts
      .filter(({ boundary }) => boundary === "operator")
      .map(({ file }) => file),
  );
  for (const file of operatorFiles) {
    assert.match(routeSource(file), /requireOperator\(\)/, file);
  }

  assert.match(
    routeSource("src/app/api/briefs/[id]/qa/route.ts"),
    /requireReviewer\(\)/,
  );

  for (const file of [
    "src/app/api/briefs/[id]/render-status/route.ts",
    "src/app/api/briefs/[id]/render-retry/route.ts",
  ]) {
    const source = routeSource(file);
    assert.match(source, /checkBriefAccess\(/, file);
    assert.match(source, /status:[\s\S]*404[\s\S]*403|404 : 403/, file);
  }

  const productImages = routeSource("src/app/api/product-images/route.ts");
  assert.match(productImages, /guard\.session\.user\.id/);
  assert.match(productImages, /listProductImageJobsForUser\(guard\.session\.user\.id\)/);
  assert.match(productImages, /userId_idempotencyKey: \{ userId, idempotencyKey \}/);
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
