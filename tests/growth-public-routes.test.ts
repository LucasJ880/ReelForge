import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";

import { db } from "../src/lib/db";
import { POST as postLead } from "../src/app/api/public/leads/route";
import { POST as postPilot } from "../src/app/api/public/pilot-applications/route";
import { LEAD_CONSENT_VERSION, PILOT_CONSENT_VERSION, getGrowthCopy } from "../src/i18n/growth-copy";

/**
 * 两个公开提交端点（D4）：蜜罐命中假装成功且不落库、校验失败给可本地化的 reason、
 * 限流回 429 并附备用联系方式、未开通的询盘页 404。全部 patch Prisma，不触真实库。
 */

function patch(t: TestContext, model: unknown, patches: Record<string, unknown>) {
  const target = model as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = target[key];
    target[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) target[key] = originals[key];
  });
}

function forbidDb(t: TestContext) {
  const boom = async () => {
    throw new Error("this request must not touch the database");
  };
  patch(t, db.workspace, { findUnique: boom });
  patch(t, db.rateLimitBucket, { upsert: boom });
  patch(t, db.lead, { findFirst: boom, create: boom, update: boom });
  patch(t, db.pilotApplication, { create: boom });
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const PILOT_URL = "https://aivora.test/api/public/pilot-applications";
const LEAD_URL = "https://aivora.test/api/public/leads";

const pilotBody = { company: "Sunny Shutter", email: "owner@sunnyshutter.test", consent: true, consentVersion: PILOT_CONSENT_VERSION };
const leadBody = { slug: "sunny-shutter", name: "Lee", phone: "416-555-0100", consent: true, consentVersion: LEAD_CONSENT_VERSION };

test("蜜罐命中：回成功，但一行都不写", async (t) => {
  forbidDb(t);
  const pilot = await postPilot(jsonRequest(PILOT_URL, { ...pilotBody, faxNumber: "spam" }));
  assert.equal(pilot.status, 201);
  assert.deepEqual(await pilot.json(), { ok: true });
  const lead = await postLead(jsonRequest(LEAD_URL, { ...leadBody, faxNumber: "spam" }));
  assert.equal(lead.status, 201);
});

test("试点申请校验：没有联系方式 / 没勾同意 → 400 + 可本地化 reason，不查库", async (t) => {
  forbidDb(t);
  const noContact = await postPilot(jsonRequest(PILOT_URL, { company: "X", consent: true, consentVersion: PILOT_CONSENT_VERSION }));
  assert.equal(noContact.status, 400);
  assert.equal((await noContact.json()).reason, "contact_required");
  const noConsent = await postPilot(jsonRequest(PILOT_URL, { email: "a@b.co" }));
  assert.equal(noConsent.status, 400);
  assert.equal((await noConsent.json()).reason, "consent_required");
  const garbage = await postPilot(jsonRequest(PILOT_URL, "{not json"));
  assert.equal(garbage.status, 400);
  const huge = await postPilot(jsonRequest(PILOT_URL, { ...pilotBody, message: "x".repeat(9000) }));
  assert.equal(huge.status, 400, "bodies over 8 KB are rejected before parsing");
});

test("试点申请限流：429 + 人话 reason + 备用邮箱", async (t) => {
  const previous = process.env.AIVORA_CONTACT_EMAIL;
  process.env.AIVORA_CONTACT_EMAIL = "hello@aivora.test";
  t.after(() => {
    if (previous === undefined) delete process.env.AIVORA_CONTACT_EMAIL;
    else process.env.AIVORA_CONTACT_EMAIL = previous;
  });
  patch(t, db.rateLimitBucket, { upsert: async () => ({ count: 6 }) });
  patch(t, db.pilotApplication, {
    create: async () => {
      throw new Error("rate-limited submissions must not be stored");
    },
  });
  const response = await postPilot(jsonRequest(PILOT_URL, pilotBody));
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.reason, "rate_limited");
  assert.equal(body.code, "RATE_LIMITED");
  assert.equal(body.fallbackEmail, "hello@aivora.test");
});

test("试点申请成功：201，只回 ok（不回行 id）", async (t) => {
  patch(t, db.rateLimitBucket, { upsert: async () => ({ count: 1 }) });
  patch(t, db.pilotApplication, { create: async () => ({ id: "pilot-1" }) });
  const response = await postPilot(jsonRequest(PILOT_URL, pilotBody));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
});

test("询盘提交：未开通的询盘页 404；限流 429 并附商家电话", async (t) => {
  let enabled = false;
  patch(t, db.workspace, {
    findUnique: async () => ({
      id: "ws-1",
      name: "Sunny",
      leadPageEnabled: enabled,
      leadPageConfig: { phone: "+1 905 555 0100" },
    }),
  });
  patch(t, db.rateLimitBucket, { upsert: async () => ({ count: 6 }) });
  const missing = await postLead(jsonRequest(LEAD_URL, leadBody));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).reason, "not_found");

  enabled = true;
  const limited = await postLead(jsonRequest(LEAD_URL, leadBody));
  assert.equal(limited.status, 429);
  const body = await limited.json();
  assert.equal(body.reason, "rate_limited");
  assert.equal(body.fallbackPhone, "+1 905 555 0100");
});

test("询盘提交：电话不像电话 → 400 phone_invalid", async (t) => {
  forbidDb(t);
  const response = await postLead(jsonRequest(LEAD_URL, { ...leadBody, phone: "tomorrow" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, "phone_invalid");
});

test("首页：未登录渲染试点页、已登录仍按身份直达工作台；样片只取公开面零瑕疵名单", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /SHOWCASE_SAFE_SLUGS\.flatMap/);
  assert.match(page, /verifiedTemplateVideo\(slug/);
  assert.match(page, /<PilotLanding /);
  for (const target of ['redirect("/business")', 'redirect("/personal")', 'redirect("/internal/orders")', 'redirect("/persona")']) {
    assert.ok(page.includes(target), target);
  }
  assert.doesNotMatch(page, /redirect\("\/login"\)/, "anonymous visitors get the landing page, not the login gate");
});

/** 公开首页不写价格与效果主张（计划 6.1：数字待拍板，按试点单独约定）。 */
test("首页文案：不出现价格与效果数字", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const landing = JSON.stringify(getGrowthCopy(locale).landing);
    assert.doesNotMatch(landing, /\$|CAD|加元|US\$|\d+\s*%|\d{3,}/, `${locale} landing copy must not state prices or outcome numbers`);
  }
});

function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`, ...value.flatMap((item, index) => keyPaths(item, `${prefix}[${index}]`))];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => keyPaths(item, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

test("growth-copy：中英结构一致；英文界面不出现中文（切换语言按钮除外）", () => {
  const zh = getGrowthCopy("zh-CN");
  const en = getGrowthCopy("en-US");
  assert.deepEqual(keyPaths(en), keyPaths(zh));
  const english = JSON.stringify({ ...en, leadPage: { ...en.leadPage, switchLocale: "" } });
  assert.doesNotMatch(english, /[㐀-鿿]/);
  assert.doesNotMatch(JSON.stringify(en), /workspace|青砚|Image 2/i, "no internal terms in customer copy");
});

test("询盘页 /l/[slug] 不放在带 loading.tsx 的路由组里：notFound() 才是真正的 HTTP 404", () => {
  assert.ok(existsSync("src/app/l/[slug]/page.tsx"));
  assert.equal(existsSync("src/app/(public)/l"), false);
  for (const boundary of ["src/app/loading.tsx", "src/app/l/loading.tsx", "src/app/l/[slug]/loading.tsx"]) {
    assert.equal(existsSync(boundary), false, `${boundary} would stream a 200 before notFound()`);
  }
  assert.match(readFileSync("src/app/l/[slug]/page.tsx", "utf8"), /if \(!page\) notFound\(\);/);
});
