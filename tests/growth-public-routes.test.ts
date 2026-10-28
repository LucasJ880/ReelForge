import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";

import { db } from "../src/lib/db";
import { hashVisitorNetwork, visitorNetworkKey } from "../src/lib/services/rate-limit-service";
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
      owner: { disabledAt: null },
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

/**
 * 1025 安全复核 LENS-2：访客限流按网段（IPv4 /24、IPv6 /48）聚合后再哈希——
 * 在一个 IPv6 /64（2^64 个地址）或同一 /24 里换地址刷不出新额度。
 */
test("访客网段：IPv4 取 /24、IPv6 取 /48；映射地址、端口、方括号、zone 都归一；认不出的原样返回", () => {
  assert.equal(visitorNetworkKey("203.0.113.9"), "203.0.113.0/24");
  assert.equal(visitorNetworkKey(" 203.0.113.250:51234 "), "203.0.113.0/24");
  assert.equal(visitorNetworkKey("::ffff:203.0.113.77"), "203.0.113.0/24");
  assert.equal(visitorNetworkKey("2001:DB8:abcd:12::1"), "2001:db8:abcd::/48");
  assert.equal(visitorNetworkKey("[2001:db8:abcd:ffff:1:2:3:4]:443"), "2001:db8:abcd::/48");
  assert.equal(visitorNetworkKey("fe80::1%en0"), "fe80:0:0::/48");
  assert.equal(visitorNetworkKey("2001:0db8:0000:0042::"), "2001:db8:0::/48");
  assert.equal(visitorNetworkKey("::1"), "0:0:0::/48");
  assert.equal(visitorNetworkKey("64:ff9b::198.51.100.7"), "64:ff9b:0::/48");
  for (const raw of ["999.1.1.1", "2001:db8::1::2", "1:2:3:4:5:6:7:8:9", "not-an-ip"]) {
    assert.equal(visitorNetworkKey(raw), raw, raw);
  }
  assert.equal(visitorNetworkKey(null), "unknown");
  assert.equal(visitorNetworkKey("  "), "unknown");

  assert.equal(hashVisitorNetwork("2001:db8:abcd:1::1"), hashVisitorNetwork("2001:db8:abcd:9999:aaaa::2"));
  assert.notEqual(hashVisitorNetwork("2001:db8:abcd::1"), hashVisitorNetwork("2001:db8:abce::1"));
  assert.equal(hashVisitorNetwork("198.51.100.7"), hashVisitorNetwork("198.51.100.200"));
  assert.notEqual(hashVisitorNetwork("198.51.100.7"), hashVisitorNetwork("198.51.101.7"));
  assert.match(hashVisitorNetwork("198.51.100.7"), /^[0-9a-f]{32}$/);
});

test("🔴 公开端点按网段限流：同一 /48、同一 /24 里换地址落到同一个访客桶", async (t) => {
  patch(t, db.workspace, {
    findUnique: async () => ({
      id: "ws-1",
      name: "Sunny",
      leadPageEnabled: true,
      leadPageConfig: { phone: "+1 905 555 0100" },
      owner: { disabledAt: null },
    }),
  });
  const keys: string[] = [];
  patch(t, db.rateLimitBucket, {
    upsert: async (args: { where: { bucketKey_windowKey: { bucketKey: string } } }) => {
      keys.push(args.where.bucketKey_windowKey.bucketKey);
      return { count: 6 };
    },
  });
  patch(t, db.pilotApplication, {
    create: async () => {
      throw new Error("rate-limited submissions must not be stored");
    },
  });
  for (const ip of ["2001:db8:abcd:1::1", "2001:db8:abcd:ffff::2", "2001:db8:abce::1"]) {
    assert.equal((await postLead(jsonRequest(LEAD_URL, leadBody, { "x-forwarded-for": ip }))).status, 429);
  }
  assert.equal(keys[0], keys[1], "two addresses inside one /48 share a visitor bucket");
  assert.notEqual(keys[0], keys[2], "a different /48 gets its own bucket");
  assert.match(keys[0], /^public-lead:ws-1:[0-9a-f]{32}$/);

  keys.length = 0;
  for (const ip of ["198.51.100.7", "198.51.100.200, 10.0.0.1"]) {
    assert.equal((await postPilot(jsonRequest(PILOT_URL, pilotBody, { "x-forwarded-for": ip }))).status, 429);
  }
  assert.equal(keys[0], keys[1], "two addresses inside one /24 share a visitor bucket");
  assert.doesNotMatch(keys.join(","), /198\.51\.100/, "raw IPs never reach the database");
});

test("试点申请路由：过了全局繁忙线照收，但不排通知（service 返回 notify=false）", () => {
  const route = readFileSync("src/app/api/public/pilot-applications/route.ts", "utf8");
  assert.match(route, /const \{ id, notify \} = await submitPilotApplication/);
  assert.match(route, /if \(notify\) runAfterResponse\(\(\) => notifyPilotApplication\(id\)\)/);
  for (const path of ["src/app/api/public/leads/route.ts", "src/app/api/public/pilot-applications/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /hashVisitorNetwork\(clientIpFromHeaders\(req\.headers\)\)/, path);
    assert.doesNotMatch(source, /hashVisitorKey\(/, `${path} must aggregate the IP to a network before hashing`);
  }
});

test("首页：未登录渲染展厅首页、已登录仍按身份直达工作台；首屏不放读数", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  /// 2026-10-28：首页换成「展厅」（学 Seedance 2.5 官网）——首屏只有视频、一句标题、一句话和三个胶囊，
  /// 不再读模板库计数（Taste DNA：The hero speaks once, at the bottom），也就不再查库。
  assert.match(page, /<ShowroomLanding locale=\{locale\} fallbackEmail=\{contactEmail\(\)\} \/>/);
  assert.doesNotMatch(page, /listActiveStyleTemplates|PilotLanding/);
  for (const target of ['redirect("/business")', 'redirect("/personal")', 'redirect("/internal/frame-qa")', 'redirect("/app")']) {
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
