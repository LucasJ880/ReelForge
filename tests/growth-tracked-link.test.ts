import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import { db } from "../src/lib/db";
import {
  CLICK_LOG_NETWORK_HOURLY_MAX,
  TRACKED_LINK_CODE_RE,
  claimClickSlot,
  classifyUserAgent,
  generateTrackedLinkCode,
  handleTrackedLinkVisit,
  normalizeAllowedHost,
  resolveSafeDestination,
} from "../src/lib/services/tracked-link-service";
import { GET as trackedGet, HEAD as trackedHead } from "../src/app/t/[code]/route";

/**
 * 追踪链接 /t/[code]（1025 · A5 / D4）回归：爬虫与 HEAD 只记录不计数、30 分钟按访客去重、
 * 跳转只到询盘页或超管登记的 https 域名（不做开放跳转）、未开通的工作区一律 404。
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

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("爬虫识别：链接预览与非浏览器客户端都是 bot；HEAD 与空 UA 也不算人", () => {
  const bots: Array<[string, string]> = [
    ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "facebookexternalhit"],
    ["WhatsApp/2.23.20.0 A", "whatsapp"],
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "slackbot"],
    ["Twitterbot/1.0", "twitterbot"],
    ["Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "discordbot"],
    ["TelegramBot (like TwitterBot)", "telegrambot"],
    ["LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)", "linkedinbot"],
    ["Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15 (Applebot/0.1)", "applebot"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "googlebot"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "bingbot"],
    ["curl/8.4.0", "curl"],
  ];
  for (const [ua, family] of bots) {
    assert.deepEqual(classifyUserAgent(ua, "GET"), { isBot: true, uaFamily: family }, ua);
  }
  assert.deepEqual(classifyUserAgent(CHROME, "HEAD"), { isBot: true, uaFamily: "head" });
  assert.deepEqual(classifyUserAgent("", "GET"), { isBot: true, uaFamily: "empty" });
  assert.deepEqual(classifyUserAgent(null, "GET"), { isBot: true, uaFamily: "empty" });
});

test("真人：IG / Facebook 内置浏览器与普通浏览器都计数", () => {
  assert.deepEqual(classifyUserAgent(`${IPHONE} Instagram 312.0.0.32.112`, "GET"), { isBot: false, uaFamily: "instagram" });
  assert.deepEqual(classifyUserAgent(`${IPHONE} [FBAN/FBIOS;FBAV/450.0]`, "GET"), { isBot: false, uaFamily: "facebook" });
  assert.deepEqual(classifyUserAgent(CHROME, "GET"), { isBot: false, uaFamily: "chrome" });
  assert.deepEqual(classifyUserAgent(IPHONE, "GET"), { isBot: false, uaFamily: "safari" });
  assert.equal(classifyUserAgent("Mozilla/5.0 (Linux; Android 9; CUBOT X20 PRO) Chrome/120 Mobile Safari/537.36").isBot, false);
});

test("跳转白名单：只放行 https + 登记域名精确命中；其余回落询盘页（不做开放跳转）", () => {
  const hosts = ["www.sunnyshutter.ca"];
  assert.equal(resolveSafeDestination("https://www.sunnyshutter.ca/quote?x=1", hosts), "https://www.sunnyshutter.ca/quote?x=1");
  assert.equal(resolveSafeDestination("https://WWW.SunnyShutter.ca/", hosts), "https://www.sunnyshutter.ca/");
  for (const url of [
    "http://www.sunnyshutter.ca/",
    "https://sunnyshutter.ca/",
    "https://evil.com/",
    "https://www.sunnyshutter.ca.evil.com/",
    "https://user:pass@www.sunnyshutter.ca/",
    "https://www.sunnyshutter.ca:8443/",
    "javascript:alert(1)",
    "//www.sunnyshutter.ca/",
    "not a url",
  ]) {
    assert.equal(resolveSafeDestination(url, hosts), null, url);
  }
  assert.equal(resolveSafeDestination("https://www.sunnyshutter.ca/", []), null);
  assert.equal(normalizeAllowedHost(" WWW.Example.com. "), "www.example.com");
  assert.equal(normalizeAllowedHost("https://example.com"), null);
  assert.equal(normalizeAllowedHost("example.com/path"), null);
  assert.equal(normalizeAllowedHost("localhost"), null);
});

test("生成的码落在 middleware 放行的 /t/<code> 段里", () => {
  const middleware = readFileSync("src/middleware.ts", "utf8");
  assert.match(middleware, /\/\^\\\/t\\\/\[A-Za-z0-9_-\]\{4,32\}\$\//);
  for (let index = 0; index < 50; index += 1) {
    const code = generateTrackedLinkCode();
    assert.match(code, TRACKED_LINK_CODE_RE);
    assert.doesNotMatch(code, /[01lIO]/, "ambiguous characters are excluded");
  }
  assert.equal(generateTrackedLinkCode(() => Buffer.alloc(8, 0)), "22222222");
});

test("middleware 只放行两个精确公开端点与单段 /l、/t；工作台管理接口仍要会话", () => {
  const middleware = readFileSync("src/middleware.ts", "utf8");
  assert.match(middleware, /"\/api\/public\/leads",/);
  assert.match(middleware, /"\/api\/public\/pilot-applications",/);
  assert.doesNotMatch(middleware, /"\/api\/leads"/);
  assert.doesNotMatch(middleware, /"\/api\/public"[,\]]/, "no prefix allowance for /api/public");
});

test("点击去重：首次插入算一次；30 分钟内重复不算；超过 30 分钟的旧记录被条件更新抢到才算", async (t) => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  let mode: "fresh" | "duplicate" | "stale" = "fresh";
  const updateWheres: Array<Record<string, unknown>> = [];
  patch(t, db.rateLimitBucket, {
    updateMany: async (args: { where: Record<string, unknown> }) => {
      updateWheres.push(args.where);
      return { count: mode === "stale" ? 1 : 0 };
    },
    create: async () => {
      if (mode === "duplicate") {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      }
      return {};
    },
  });
  assert.equal(await claimClickSlot("link-1", "visitor-1", now), true);
  mode = "duplicate";
  assert.equal(await claimClickSlot("link-1", "visitor-1", now), false);
  mode = "stale";
  assert.equal(await claimClickSlot("link-1", "visitor-1", now), true);
  const cutoff = (updateWheres[0].updatedAt as { lt: Date }).lt;
  assert.equal(now.getTime() - cutoff.getTime(), 30 * 60 * 1000);
  assert.equal(updateWheres[0].bucketKey, "click:link-1:human:visitor-1");
});

test("预取不吞真人点击：同一 IP + UA 先 HEAD 再 GET，GET 照样计数", async (t) => {
  const { clicks, increments } = patchVisit(t, {}, { realDedupe: true });
  const iphone = `${IPHONE} Instagram 312.0.0.32.112`;
  await visit({ method: "HEAD", userAgent: iphone });
  const result = await visit({ userAgent: iphone });
  assert.equal(result.status === "redirect" && result.counted, true);
  assert.deepEqual(increments, ["link-1"]);
  assert.deepEqual(clicks.map((click) => click.isBot), [true, false]);
  const again = await visit({ userAgent: iphone });
  assert.equal(again.status === "redirect" && again.counted, false, "the second human click inside 30 min is a duplicate");
  assert.deepEqual(increments, ["link-1"]);
});

type LinkFixture = {
  archivedAt?: Date | null;
  destinationUrl?: string | null;
  leadPageEnabled?: boolean;
  publicSlug?: string | null;
  allowedHosts?: string[];
  ownerDisabledAt?: Date | null;
};

function patchVisit(
  t: TestContext,
  fixture: LinkFixture | null,
  options: { duplicate?: boolean; failLog?: boolean; realDedupe?: boolean } = {},
) {
  const clicks: Array<Record<string, unknown>> = [];
  const increments: string[] = [];
  /// realDedupe：用内存里的唯一键模拟 RateLimitBucket 的 (bucketKey, windowKey) 唯一约束
  const slots = new Set<string>();
  /// 小时计数桶（网段记点击闸）：按 bucketKey|windowKey 在内存里累加
  const counters = new Map<string, number>();
  patch(t, db.trackedLink, {
    findUnique: async () =>
      fixture
        ? {
            id: "link-1",
            archivedAt: fixture.archivedAt ?? null,
            destinationUrl: fixture.destinationUrl ?? null,
            workspace: {
              publicSlug: fixture.publicSlug === undefined ? "sunny-shutter" : fixture.publicSlug,
              leadPageEnabled: fixture.leadPageEnabled ?? true,
              leadPageConfig: { allowedHosts: fixture.allowedHosts ?? [] },
              owner: { disabledAt: fixture.ownerDisabledAt ?? null },
            },
          }
        : null,
    update: async (args: { where: { id: string } }) => {
      increments.push(args.where.id);
      return {};
    },
  });
  patch(t, db.rateLimitBucket, {
    updateMany: async () => ({ count: 0 }),
    create: async (args: { data: { bucketKey: string } }) => {
      const taken = options.realDedupe ? slots.has(args.data.bucketKey) : options.duplicate;
      if (taken) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      }
      slots.add(args.data.bucketKey);
      return {};
    },
    upsert: async (args: { where: { bucketKey_windowKey: { bucketKey: string; windowKey: string } } }) => {
      const { bucketKey, windowKey } = args.where.bucketKey_windowKey;
      const key = `${bucketKey}|${windowKey}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { bucketKey, windowKey, count };
    },
  });
  patch(t, db.linkClick, {
    create: async (args: { data: Record<string, unknown> }) => {
      if (options.failLog) throw new Error("db down");
      clicks.push(args.data);
      return {};
    },
  });
  return { clicks, increments, slots, counters };
}

const visit = (overrides: Partial<Parameters<typeof handleTrackedLinkVisit>[0]> = {}) =>
  handleTrackedLinkVisit({
    code: "Ab3dEf7h",
    method: "GET",
    userAgent: CHROME,
    referer: "https://l.instagram.com/?u=x",
    ip: "203.0.113.9",
    ...overrides,
  });

test("真人点击：记一条点击（来源域名、UA 家族）、计数 +1，跳到询盘页并带 ?t= 归因", async (t) => {
  const { clicks, increments } = patchVisit(t, {});
  const result = await visit();
  assert.deepEqual(result, { status: "redirect", location: "/l/sunny-shutter?t=Ab3dEf7h", counted: true, isBot: false });
  assert.deepEqual(clicks, [{ trackedLinkId: "link-1", referrerHost: "l.instagram.com", isBot: false, uaFamily: "chrome" }]);
  assert.deepEqual(increments, ["link-1"]);
});

test("预览爬虫：照样跳转，但只记录不计数", async (t) => {
  const { clicks, increments } = patchVisit(t, {});
  const result = await visit({ userAgent: "WhatsApp/2.23.20.0 A" });
  assert.equal(result.status, "redirect");
  assert.equal(clicks[0].isBot, true);
  assert.equal(clicks[0].uaFamily, "whatsapp");
  assert.deepEqual(increments, []);
});

test("同一访客 30 分钟内重复点：不记、不计，照样跳转", async (t) => {
  const { clicks, increments } = patchVisit(t, {}, { duplicate: true });
  const result = await visit();
  assert.equal(result.status, "redirect");
  assert.deepEqual(clicks, []);
  assert.deepEqual(increments, []);
});

test("点击记录失败不挡跳转", async (t) => {
  patchVisit(t, {}, { failLog: true });
  const result = await visit();
  assert.equal(result.status, "redirect");
  assert.equal(result.status === "redirect" && result.counted, false);
});

test("目标网址：命中登记域名才去，否则回落询盘页", async (t) => {
  patchVisit(t, { destinationUrl: "https://www.sunnyshutter.ca/quote", allowedHosts: ["www.sunnyshutter.ca"] });
  const result = await visit();
  assert.equal(result.status === "redirect" && result.location, "https://www.sunnyshutter.ca/quote");
});

test("目标网址被撤出登记名单后，链接回落到询盘页而不是继续跳外站", async (t) => {
  patchVisit(t, { destinationUrl: "https://www.sunnyshutter.ca/quote", allowedHosts: [] });
  const result = await visit();
  assert.equal(result.status === "redirect" && result.location, "/l/sunny-shutter?t=Ab3dEf7h");
});

test("停用的链接、未开通询盘页的工作区、不合规的码：一律 404，不写点击", async (t) => {
  const { clicks } = patchVisit(t, { archivedAt: new Date() });
  assert.deepEqual(await visit(), { status: "not_found" });
  assert.deepEqual(clicks, []);
});

test("工作区询盘页被关闭后，它的追踪链接同样 404", async (t) => {
  patchVisit(t, { leadPageEnabled: false });
  assert.deepEqual(await visit(), { status: "not_found" });
});

test("不合规的码不查库", async (t) => {
  patch(t, db.trackedLink, {
    findUnique: async () => {
      throw new Error("invalid codes must not reach the database");
    },
  });
  assert.deepEqual(await visit({ code: "../x" }), { status: "not_found" });
  assert.deepEqual(await visit({ code: "abc" }), { status: "not_found" });
});

test("/t/[code] 路由：GET 302 + no-store；HEAD 跳转但不计数；找不到回 404", async (t) => {
  const { increments } = patchVisit(t, {});
  const params = Promise.resolve({ code: "Ab3dEf7h" });
  const get = await trackedGet(
    new NextRequest("https://aivora.test/t/Ab3dEf7h", { headers: { "user-agent": CHROME, "x-forwarded-for": "203.0.113.9" } }),
    { params },
  );
  assert.equal(get.status, 302);
  assert.equal(get.headers.get("location"), "https://aivora.test/l/sunny-shutter?t=Ab3dEf7h");
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.deepEqual(increments, ["link-1"]);

  const head = await trackedHead(
    new NextRequest("https://aivora.test/t/Ab3dEf7h", { method: "HEAD", headers: { "user-agent": CHROME } }),
    { params: Promise.resolve({ code: "Ab3dEf7h" }) },
  );
  assert.equal(head.status, 302);
  assert.deepEqual(increments, ["link-1"], "HEAD never increments the click count");
});

test("/t/[code] 路由：链接不存在回 404 文本，不跳转", async (t) => {
  patchVisit(t, null);
  const response = await trackedGet(new NextRequest("https://aivora.test/t/Zz9yXw8v"), {
    params: Promise.resolve({ code: "Zz9yXw8v" }),
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("location"), null);
});

/**
 * 1025 安全复核 LENS-1：去重键带访客自报的 UA，换 UA 就是「新访客」。网段记点击闸把单一来源
 * 能写进库的点击、去重行与计数封顶；超了照样跳转。
 */
test("🔴 换 UA 刷点击：同一 /24 每条链接每小时最多记 20 次；超了照样跳转，但不记、不计、不再新建去重行", async (t) => {
  const { clicks, increments, slots, counters } = patchVisit(t, {}, { realDedupe: true });
  const now = new Date("2026-10-25T12:00:00.000Z");
  for (let n = 0; n < 60; n += 1) {
    const result = await visit({
      userAgent: CHROME.replace("Chrome/130.0", `Chrome/130.0.${n}`),
      ip: `203.0.113.${n % 250}`,
      now,
    });
    assert.equal(result.status, "redirect", "the visitor always gets the redirect");
  }
  assert.equal(CLICK_LOG_NETWORK_HOURLY_MAX, 20);
  assert.equal(clicks.length, CLICK_LOG_NETWORK_HOURLY_MAX);
  assert.equal(increments.length, CLICK_LOG_NETWORK_HOURLY_MAX, "clickCount stops at the cap");
  assert.equal(slots.size, CLICK_LOG_NETWORK_HOURLY_MAX, "dedupe rows stop growing once the network is capped");
  assert.equal(counters.size, 1, "the whole /24 shares one hourly bucket per link");
  const [bucket] = [...counters.keys()];
  assert.match(bucket, /^click-net:link-1:[0-9a-f]{32}\|2026-10-25T12$/);
  assert.doesNotMatch(bucket, /203\.0\.113/, "raw IPs never reach the database");
});

test("🔴 换爬虫 UA 刷日志：同一 IPv6 /48 也封顶（爬虫只记录不计数，但行数同样有上限）", async (t) => {
  const { clicks, increments } = patchVisit(t, {});
  const now = new Date("2026-10-25T12:00:00.000Z");
  for (let n = 0; n < 40; n += 1) {
    await visit({ userAgent: `WhatsApp/2.23.20.${n} A`, ip: `2001:db8:abcd:${n.toString(16)}::${n + 1}`, now });
  }
  assert.equal(clicks.length, CLICK_LOG_NETWORK_HOURLY_MAX);
  assert.ok(clicks.every((click) => click.isBot === true));
  assert.deepEqual(increments, [], "bots are logged, never counted");
});

test("网段封顶不误伤别人：另一个网段照常计数；下一个小时同一网段重新计", async (t) => {
  const { increments } = patchVisit(t, {}, { realDedupe: true });
  const hour = new Date("2026-10-25T12:00:00.000Z");
  for (let n = 0; n < CLICK_LOG_NETWORK_HOURLY_MAX + 5; n += 1) {
    await visit({ userAgent: CHROME.replace("Chrome/130.0", `Chrome/130.0.${n}`), ip: "203.0.113.9", now: hour });
  }
  assert.equal(increments.length, CLICK_LOG_NETWORK_HOURLY_MAX);

  const other = await visit({ ip: "198.51.100.7", now: hour });
  assert.equal(other.status === "redirect" && other.counted, true, "a different /24 is unaffected");

  const nextHour = new Date("2026-10-25T13:05:00.000Z");
  const later = await visit({ userAgent: `${IPHONE} Instagram 312.0.0.32.112`, ip: "203.0.113.50", now: nextHour });
  assert.equal(later.status === "redirect" && later.counted, true, "the cap is hourly");
});

/** 1025 安全复核 LENS-4：账号停用后，它的追踪链接与询盘页一起下线。 */
test("🔴 owner 账号已停用：追踪链接 404，不跳转、不写点击", async (t) => {
  const { clicks, increments } = patchVisit(t, { ownerDisabledAt: new Date("2026-10-25T00:00:00.000Z") });
  assert.deepEqual(await visit(), { status: "not_found" });
  assert.deepEqual(clicks, []);
  assert.deepEqual(increments, []);
});
