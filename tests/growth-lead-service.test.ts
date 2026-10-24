import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Prisma } from "@prisma/client";

import { db } from "../src/lib/db";
import { RateLimitExceededError } from "../src/lib/services/rate-limit-service";
import {
  LEAD_DEDUPE_WINDOW_DAYS,
  LeadConflictError,
  LeadPageNotFoundError,
  LeadRateLimitedError,
  LeadSlugError,
  PUBLIC_LEAD_PAGE_HOURLY_HARD_MAX,
  PUBLIC_LEAD_PAGE_HOURLY_NOTIFY_MAX,
  PUBLIC_PILOT_GLOBAL_HOURLY_HARD_MAX,
  PUBLIC_PILOT_GLOBAL_HOURLY_NOTIFY_MAX,
  buildLeadDedupeKey,
  checkLeadSlug,
  createManualLead,
  displayBusinessName,
  getPublicLeadPage,
  leadPageDisplayInputSchema,
  manualLeadInputSchema,
  leadStatusTransitionData,
  normalizePhoneForDedupe,
  parseLeadPageConfig,
  pickTopSource,
  pilotApplicationInputSchema,
  publicLeadInputSchema,
  publicValidationReason,
  submitPilotApplication,
  submitPublicLead,
  transitionLeadStatus,
  updateLeadPageDisplay,
  updateWorkspaceLeadPageAdmin,
} from "../src/lib/services/lead-service";
import { LEAD_CONSENT_VERSION, PILOT_CONSENT_VERSION } from "../src/i18n/growth-copy";

/**
 * 获客闭环（1025 · A5）lead-service 回归：去重、保留词、状态时间戳、限流人话、
 * 超管开通校验。全部 monkey-patch Prisma，不触真实库。
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

const NOW = new Date("2026-10-25T15:00:00.000Z");

function enabledWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    name: "Sunny Workspace",
    leadPageEnabled: true,
    leadPageConfig: { businessName: "Sunny Shutter", phone: "+1 905 555 0100", allowedHosts: ["sunnyshutter.ca"] },
    owner: { disabledAt: null },
    ...overrides,
  };
}

function rateLimitOk(t: TestContext, counts: number[] = []) {
  const calls: Array<{ bucketKey: string; windowKey: string }> = [];
  patch(t, db.rateLimitBucket, {
    upsert: async (args: { where: { bucketKey_windowKey: { bucketKey: string; windowKey: string } } }) => {
      calls.push(args.where.bucketKey_windowKey);
      return { count: counts[calls.length - 1] ?? 1 };
    },
  });
  return calls;
}

const validPublicLead = {
  slug: "sunny-shutter",
  name: "王女士",
  phone: "+1 (416) 555-0100",
  consent: true,
  consentVersion: LEAD_CONSENT_VERSION,
};

test("slug：格式与保留词——与 middleware 的 /l/<slug> 段一致，站内路由词不给商家用", () => {
  assert.equal(checkLeadSlug("sunny-shutter"), null);
  assert.equal(checkLeadSlug("ab"), null);
  for (const bad of ["a", "-ab", "ab-", "ab--cd", "AB", "a_b", "x".repeat(65)]) {
    assert.equal(checkLeadSlug(bad), "invalid", bad);
  }
  for (const reserved of ["app", "api", "admin", "aivora", "login", "register", "wall", "leads", "privacy"]) {
    assert.equal(checkLeadSlug(reserved), "reserved", reserved);
  }
});

test("去重键：北美与中国号码带不带国家码都落到同一个键；没有电话才用邮箱", () => {
  assert.equal(normalizePhoneForDedupe("+1 (416) 555-0100"), normalizePhoneForDedupe("416-555-0100"));
  assert.equal(normalizePhoneForDedupe("+86 138 1234 5678"), normalizePhoneForDedupe("13812345678"));
  assert.equal(normalizePhoneForDedupe("12345"), null);
  assert.equal(buildLeadDedupeKey("416 555 0100", "A@B.com"), "p:4165550100");
  assert.equal(buildLeadDedupeKey(null, "  A@B.com "), "e:a@b.com");
  assert.equal(buildLeadDedupeKey(null, null), null);
});

test("询盘页配置：坏字段只丢那一项，跳转域名规范化且丢掉非法值", () => {
  const config = parseLeadPageConfig({
    businessName: "Sunny Shutter",
    services: "not-an-array",
    locale: "fr-FR",
    phone: "905-555-0100",
    allowedHosts: ["WWW.SunnyShutter.ca.", "https://evil.com", "bad host", 42],
  });
  assert.equal(config.businessName, "Sunny Shutter");
  assert.equal(config.services, undefined);
  assert.equal(config.locale, undefined);
  assert.equal(config.phone, "905-555-0100");
  assert.deepEqual(config.allowedHosts, ["www.sunnyshutter.ca"]);
  assert.deepEqual(parseLeadPageConfig(null), { allowedHosts: [] });
});

test("店名：工作区默认名（My Workspace）不拿出去当店名", () => {
  assert.equal(displayBusinessName({ allowedHosts: [] }, "My Workspace"), null);
  assert.equal(displayBusinessName({ allowedHosts: [] }, "Sunny Workspace"), "Sunny");
  assert.equal(displayBusinessName({ allowedHosts: [], businessName: "Sunny Shutter" }, "My Workspace"), "Sunny Shutter");
});

test("状态时间戳：只补空的、不覆盖；已成交补 wonAt 但不伪造 bookedAt；未成交不写时间", () => {
  const empty = { contactedAt: null, bookedAt: null, wonAt: null };
  assert.deepEqual(leadStatusTransitionData(empty, "CONTACTED", NOW), { status: "CONTACTED", contactedAt: NOW });
  assert.deepEqual(leadStatusTransitionData(empty, "BOOKED", NOW), { status: "BOOKED", contactedAt: NOW, bookedAt: NOW });
  assert.deepEqual(leadStatusTransitionData(empty, "WON", NOW), { status: "WON", contactedAt: NOW, wonAt: NOW });
  assert.deepEqual(leadStatusTransitionData(empty, "LOST", NOW), { status: "LOST" });
  const earlier = new Date("2026-10-20T00:00:00.000Z");
  assert.deepEqual(
    leadStatusTransitionData({ contactedAt: earlier, bookedAt: earlier, wonAt: null }, "BOOKED", NOW),
    { status: "BOOKED" },
    "already-stamped timestamps are history and are never overwritten",
  );
});

test("状态流转是 CAS：读到的状态被别人改掉时报冲突，不覆盖", async (t) => {
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patch(t, db.lead, {
    findFirst: async () => ({ status: "NEW", contactedAt: null, bookedAt: null, wonAt: null }),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      writes.push(args);
      return { count: 0 };
    },
  });
  await assert.rejects(transitionLeadStatus("ws-1", "lead-1", "BOOKED", NOW), LeadConflictError);
  assert.equal(writes[0].where.status, "NEW");
  assert.equal(writes[0].where.workspaceId, "ws-1");
  assert.equal(writes[0].where.archivedAt, null);
});

test("来源第一：追踪链接按渠道归并（含已停用链接），同票稳定", () => {
  const channels = new Map<string, string | null>([
    ["link-ig", "ig_bio"],
    ["link-ig-old", "ig_bio"],
    ["link-qr", "qr"],
  ]);
  const top = pickTopSource(
    [
      { source: "tracked_link", trackedLinkId: "link-ig", count: 2 },
      { source: "tracked_link", trackedLinkId: "link-ig-old", count: 2 },
      { source: "lead_page", trackedLinkId: null, count: 3 },
      { source: "tracked_link", trackedLinkId: "link-qr", count: 1 },
    ],
    channels,
  );
  assert.deepEqual(top, { key: "channel:ig_bio", count: 4, total: 8 });
  assert.equal(pickTopSource([], channels), null);
  const tie = pickTopSource(
    [
      { source: "manual", trackedLinkId: null, count: 1 },
      { source: "lead_page", trackedLinkId: null, count: 1 },
    ],
    channels,
  );
  assert.equal(tie?.key, "lead_page");
});

test("公开询盘输入：必须同意且版本对；电话要像电话；非法追踪码当没有", () => {
  assert.equal(publicLeadInputSchema.safeParse(validPublicLead).success, true);
  const noConsent = publicLeadInputSchema.safeParse({ ...validPublicLead, consent: false });
  assert.equal(noConsent.success, false);
  if (!noConsent.success) assert.equal(publicValidationReason(noConsent.error), "consent_required");
  const staleVersion = publicLeadInputSchema.safeParse({ ...validPublicLead, consentVersion: "lead-2020-01-01" });
  assert.equal(staleVersion.success, false);
  if (!staleVersion.success) assert.equal(publicValidationReason(staleVersion.error), "consent_required");
  const badPhone = publicLeadInputSchema.safeParse({ ...validPublicLead, phone: "call me" });
  assert.equal(badPhone.success, false);
  if (!badPhone.success) assert.equal(publicValidationReason(badPhone.error), "phone_invalid");
  for (const phone of ["(416) 555-0199", "+1 416.555.0199", "138 1234 5678", "+86 13812345678"]) {
    assert.equal(publicLeadInputSchema.safeParse({ ...validPublicLead, phone }).success, true, phone);
  }
  for (const phone of ["12345", "+1 (416) 555-0199 ext. 12", "416-555-0199; drop table", "(((((())))))"]) {
    assert.equal(publicLeadInputSchema.safeParse({ ...validPublicLead, phone }).success, false, phone);
  }
  const badCode = publicLeadInputSchema.parse({ ...validPublicLead, trackedCode: "../../etc" });
  assert.equal(badCode.trackedCode, null);
});

test("试点申请输入：至少一种联系方式（只留微信也行），同意带版本", () => {
  const base = { consent: true, consentVersion: PILOT_CONSENT_VERSION };
  const none = pilotApplicationInputSchema.safeParse({ ...base, name: "Lee" });
  assert.equal(none.success, false);
  if (!none.success) assert.equal(publicValidationReason(none.error), "contact_required");
  assert.equal(pilotApplicationInputSchema.safeParse({ ...base, wechat: "sunny_shutter" }).success, true);
  assert.equal(pilotApplicationInputSchema.safeParse({ ...base, email: "Owner@Example.com" }).success, true);
  assert.equal(pilotApplicationInputSchema.safeParse({ ...base, email: "not-an-email" }).success, false);
  assert.equal(pilotApplicationInputSchema.safeParse({ email: "a@b.co" }).success, false, "consent is mandatory");
});

test("公开询盘：未开通的询盘页一律当不存在（D4）", async (t) => {
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace({ leadPageEnabled: false }) });
  await assert.rejects(submitPublicLead(publicLeadInputSchema.parse(validPublicLead), { visitorHash: "v", now: NOW }), LeadPageNotFoundError);
});

test("公开询盘：新访客落一条 Lead；本工作区追踪码归因为 tracked_link；同意时间与版本落库", async (t) => {
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace() });
  const buckets = rateLimitOk(t);
  const linkLookups: Array<Record<string, unknown>> = [];
  patch(t, db.trackedLink, {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      linkLookups.push(args.where);
      return { id: "link-ig" };
    },
  });
  const created: Array<Record<string, unknown>> = [];
  patch(t, db.lead, {
    findFirst: async () => null,
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: "lead-new" };
    },
  });
  const result = await submitPublicLead(
    publicLeadInputSchema.parse({ ...validPublicLead, trackedCode: "Ab3dEf7h", utmSource: "ig" }),
    { visitorHash: "visitor-1", now: NOW },
  );
  assert.deepEqual(result, { leadId: "lead-new", deduped: false, needsNotify: true });
  assert.equal(linkLookups[0].workspaceId, "ws-1", "a code from another workspace never attributes");
  assert.equal(linkLookups[0].archivedAt, null);
  assert.equal(created[0].source, "tracked_link");
  assert.equal(created[0].trackedLinkId, "link-ig");
  assert.equal(created[0].dedupeKey, "p:4165550100");
  assert.equal(created[0].consentVersion, LEAD_CONSENT_VERSION);
  assert.equal((created[0].consentAt as Date).toISOString(), NOW.toISOString());
  assert.equal(created[0].utmSource, "ig");
  assert.match(String((created[0].meta as Record<string, unknown>).consentText), /Sunny Shutter/);
  assert.deepEqual(
    buckets.map((bucket) => bucket.bucketKey),
    ["public-lead:ws-1:visitor-1", "public-lead-page:ws-1"],
  );
});

test("公开询盘：7 天内同一电话重复提交 → 更新原询盘，不新建；已通知过的不再通知", async (t) => {
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace() });
  rateLimitOk(t);
  const finds: Array<{ where: Record<string, unknown> }> = [];
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patch(t, db.lead, {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      finds.push(args);
      return { id: "lead-old", meta: { submissions: 1, locale: "zh-CN" }, notifiedAt: new Date("2026-10-24T00:00:00Z") };
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      updates.push(args);
      return { id: "lead-old" };
    },
    create: async () => {
      throw new Error("must not create a duplicate lead inside the dedupe window");
    },
  });
  const result = await submitPublicLead(
    publicLeadInputSchema.parse({ ...validPublicLead, phone: "416.555.0100", serviceInterest: "电动卷帘" }),
    { visitorHash: "v", now: NOW },
  );
  assert.deepEqual(result, { leadId: "lead-old", deduped: true, needsNotify: false });
  const since = (finds[0].where.createdAt as { gte: Date }).gte;
  assert.equal(NOW.getTime() - since.getTime(), LEAD_DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(finds[0].where.dedupeKey, "p:4165550100");
  assert.equal(updates[0].data.serviceInterest, "电动卷帘");
  assert.equal((updates[0].data.meta as Record<string, unknown>).submissions, 2);
  assert.equal("source" in updates[0].data, false, "first-touch attribution is kept");
});

test("公开询盘：限流时抛出带商家电话的错误（路由据此给人话与备用电话）", async (t) => {
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace() });
  rateLimitOk(t, [6]);
  patch(t, db.lead, {
    findFirst: async () => {
      throw new Error("rate-limited submissions must not reach the lead table");
    },
  });
  await assert.rejects(
    submitPublicLead(publicLeadInputSchema.parse(validPublicLead), { visitorHash: "v", now: NOW }),
    (error: unknown) => error instanceof LeadRateLimitedError && error.fallbackPhone === "+1 905 555 0100",
  );
});

test("试点申请：consentJson 存当时的同意文本、版本与逐渠道同意；超限抛限流错误", async (t) => {
  let bucketCount = 1;
  patch(t, db.rateLimitBucket, { upsert: async () => ({ count: bucketCount }) });
  const created: Array<Record<string, unknown>> = [];
  patch(t, db.pilotApplication, {
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: "pilot-1" };
    },
  });
  const input = pilotApplicationInputSchema.parse({
    company: "Sunny Shutter",
    whatsapp: "+1 905 555 0100",
    monthlyLeadSpend: "under_300",
    locale: "en-US",
    consent: true,
    consentVersion: PILOT_CONSENT_VERSION,
  });
  assert.deepEqual(await submitPilotApplication(input, { visitorHash: "v", now: NOW }), { id: "pilot-1", notify: true });
  const consent = created[0].consentJson as Record<string, unknown>;
  assert.equal(consent.version, PILOT_CONSENT_VERSION);
  assert.equal(consent.acceptedAt, NOW.toISOString());
  assert.match(String(consent.text), /Aivora may contact me/);
  assert.deepEqual(consent.channels, { email: false, phone: false, whatsapp: true, wechat: false });
  assert.equal(created[0].source, "website");

  bucketCount = 99;
  await assert.rejects(submitPilotApplication(input, { visitorHash: "v", now: NOW }), RateLimitExceededError);
});

test("超管开通：保留词、缺地址、非法域名、地址被占用都被拒；成功时规范化域名并保留展示配置", async (t) => {
  await assert.rejects(updateWorkspaceLeadPageAdmin("ws-1", { enabled: true, slug: "admin", allowedHosts: [] }), (error: unknown) =>
    error instanceof LeadSlugError && error.reason === "reserved");
  await assert.rejects(updateWorkspaceLeadPageAdmin("ws-1", { enabled: true, slug: null, allowedHosts: [] }), (error: unknown) =>
    error instanceof LeadSlugError && error.reason === "required");
  await assert.rejects(
    updateWorkspaceLeadPageAdmin("ws-1", { enabled: false, slug: "sunny", allowedHosts: ["https://x.com/path"] }),
    (error: unknown) => error instanceof LeadSlugError && error.reason === "hosts_invalid",
  );

  const writes: Array<Record<string, unknown>> = [];
  let slugTaken = false;
  patch(t, db.workspace, {
    findUnique: async () => ({ leadPageConfig: { businessName: "Sunny Shutter", phone: "905-555-0100" } }),
    update: async (args: { data: Record<string, unknown> }) => {
      if (slugTaken) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      }
      writes.push(args.data);
      return { id: "ws-1", name: "Sunny", publicSlug: "sunny-shutter", leadPageEnabled: true };
    },
  });
  await updateWorkspaceLeadPageAdmin("ws-1", {
    enabled: true,
    slug: "sunny-shutter",
    allowedHosts: ["WWW.SunnyShutter.ca", "www.sunnyshutter.ca", ""],
  });
  assert.equal(writes[0].publicSlug, "sunny-shutter");
  assert.equal(writes[0].leadPageEnabled, true);
  assert.deepEqual(writes[0].leadPageConfig, {
    businessName: "Sunny Shutter",
    phone: "905-555-0100",
    allowedHosts: ["www.sunnyshutter.ca"],
  });

  slugTaken = true;
  await assert.rejects(updateWorkspaceLeadPageAdmin("ws-2", { enabled: true, slug: "sunny-shutter", allowedHosts: [] }), (error: unknown) =>
    error instanceof LeadSlugError && error.reason === "taken");
});

test("商家改展示内容不会动到超管登记的跳转域名", async (t) => {
  const writes: Array<Record<string, unknown>> = [];
  patch(t, db.workspace, {
    findUnique: async () => ({ leadPageConfig: { businessName: "Old", allowedHosts: ["sunnyshutter.ca"] } }),
    update: async (args: { data: Record<string, unknown> }) => {
      writes.push(args.data);
      return {};
    },
  });
  await updateLeadPageDisplay("ws-1", {
    businessName: "Sunny Shutter",
    headline: null,
    intro: null,
    services: leadPageDisplayInputSchema.parse({ services: ["电动卷帘", "斑马帘", "电动卷帘", ""] }).services,
    phone: null,
    region: "Vaughan",
    locale: "en-US",
  });
  assert.deepEqual(writes[0].leadPageConfig, {
    allowedHosts: ["sunnyshutter.ca"],
    businessName: "Sunny Shutter",
    services: ["电动卷帘", "斑马帘"],
    region: "Vaughan",
    locale: "en-US",
  });
});

// ─────────────────────────────────────────────────────────────
// 1025 安全复核回归（LENS-2 / LENS-3 / LENS-4）
// ─────────────────────────────────────────────────────────────

/** 已成交的手录询盘：电话 416-555-0100，商家记过姓名、邮箱、项目与通话备注。 */
function wonManualLead() {
  return {
    id: "lead-won",
    meta: { submissions: 1, lastManualAt: "2026-10-23T10:00:00.000Z" },
    notifiedAt: null,
    name: "王女士",
    phone: "416-555-0100",
    email: "wang@example.com",
    serviceInterest: "电动卷帘",
    preferredTime: null,
    selfReportedSource: null,
    message: "电话里说要 3 扇窗，周六上门量尺寸",
  };
}

test("🔴 匿名公开提交撞上已有询盘（手录 / 已成交）：只补空字段，姓名电话邮箱留言一律不改；这次提交记进 meta.lastSubmission", async (t) => {
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace() });
  rateLimitOk(t);
  const finds: Array<{ where: Record<string, unknown>; select: Record<string, unknown> }> = [];
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patch(t, db.lead, {
    findFirst: async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
      finds.push(args);
      return wonManualLead();
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      updates.push(args);
      return { id: "lead-won" };
    },
    create: async () => {
      throw new Error("must not create a duplicate lead inside the dedupe window");
    },
  });
  const result = await submitPublicLead(
    publicLeadInputSchema.parse({
      ...validPublicLead,
      phone: "+1 416 555 0100",
      name: "X",
      email: "attacker@evil.test",
      serviceInterest: "退款",
      preferredTime: "weekday_evening",
      message: "订单取消，别再联系我",
    }),
    { visitorHash: "v", now: NOW },
  );
  assert.equal(result.deduped, true);
  assert.equal(finds[0].where.dedupeKey, "p:4165550100");
  for (const field of ["name", "phone", "email", "serviceInterest", "message"]) {
    assert.equal(finds[0].select[field], true, `${field} is read so it can be protected`);
  }
  const data = updates[0].data;
  for (const field of ["name", "phone", "email", "serviceInterest", "message"]) {
    assert.equal(field in data, false, `an anonymous submission never overwrites ${field}`);
  }
  assert.equal(data.preferredTime, "weekday_evening", "empty fields can still be filled in");
  const meta = data.meta as Record<string, unknown>;
  assert.equal(meta.submissions, 2);
  assert.equal(meta.lastManualAt, "2026-10-23T10:00:00.000Z", "existing meta is kept");
  assert.deepEqual(meta.lastSubmission, {
    name: "X",
    phone: "+1 416 555 0100",
    email: "attacker@evil.test",
    serviceInterest: "退款",
    preferredTime: "weekday_evening",
    selfReportedSource: null,
    message: "订单取消，别再联系我",
    at: NOW.toISOString(),
  });
  assert.equal("status" in data, false, "the lead's status is never touched by a public submission");
});

test("商家手工录入撞上同一电话：仍按最新录入覆盖（商家本人写，可信）", async (t) => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  patch(t, db.lead, {
    findFirst: async () => wonManualLead(),
    update: async (args: { data: Record<string, unknown> }) => {
      updates.push(args);
      return { id: "lead-won" };
    },
  });
  const result = await createManualLead(
    "ws-1",
    manualLeadInputSchema.parse({ name: "王女士（已回电）", phone: "416-555-0100", email: "wang.new@example.com" }),
    NOW,
  );
  assert.deepEqual(result, { leadId: "lead-won", deduped: true });
  assert.equal(updates[0].data.name, "王女士（已回电）");
  assert.equal(updates[0].data.email, "wang.new@example.com");
  assert.equal("lastSubmission" in (updates[0].data.meta as Record<string, unknown>), false);
});

test("🔴 页级繁忙线：几个网段刷满共享桶后，真客户照样提交成功；新询盘打 page_burst 标记、这一单不发邮件", async (t) => {
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace() });
  const buckets = rateLimitOk(t, [1, PUBLIC_LEAD_PAGE_HOURLY_NOTIFY_MAX + 1]);
  patch(t, db.trackedLink, { findFirst: async () => null });
  const created: Array<Record<string, unknown>> = [];
  patch(t, db.lead, {
    findFirst: async () => null,
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: "lead-burst" };
    },
  });
  const result = await submitPublicLead(publicLeadInputSchema.parse(validPublicLead), { visitorHash: "visitor-real", now: NOW });
  assert.deepEqual(result, { leadId: "lead-burst", deduped: false, needsNotify: false });
  assert.equal((created[0].meta as Record<string, unknown>).flagged, "page_burst");
  assert.deepEqual(
    buckets.map((bucket) => bucket.bucketKey),
    ["public-lead:ws-1:visitor-real", "public-lead-page:ws-1"],
  );
});

test("页级安全阀：只有远超正常流量（> 600 次/小时）才拒收，并附商家电话；繁忙线以下照常通知", async (t) => {
  assert.ok(PUBLIC_LEAD_PAGE_HOURLY_HARD_MAX >= PUBLIC_LEAD_PAGE_HOURLY_NOTIFY_MAX * 10);
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace() });
  rateLimitOk(t, [1, PUBLIC_LEAD_PAGE_HOURLY_HARD_MAX + 1]);
  patch(t, db.lead, {
    findFirst: async () => {
      throw new Error("rejected submissions must not reach the lead table");
    },
  });
  await assert.rejects(
    submitPublicLead(publicLeadInputSchema.parse(validPublicLead), { visitorHash: "v", now: NOW }),
    (error: unknown) => error instanceof LeadRateLimitedError && error.fallbackPhone === "+1 905 555 0100",
  );
});

test("访客闸先于页级桶：被访客闸拦下的请求不占页级额度", async (t) => {
  patch(t, db.workspace, { findUnique: async () => enabledWorkspace() });
  const buckets = rateLimitOk(t, [6]);
  await assert.rejects(
    submitPublicLead(publicLeadInputSchema.parse(validPublicLead), { visitorHash: "v", now: NOW }),
    LeadRateLimitedError,
  );
  assert.deepEqual(buckets.map((bucket) => bucket.bucketKey), ["public-lead:ws-1:v"]);
});

test("🔴 试点全局繁忙线：过了 200 次照收、不发邮件；过了 2000 次的安全阀才拒收", async (t) => {
  let globalCount = PUBLIC_PILOT_GLOBAL_HOURLY_NOTIFY_MAX + 1;
  patch(t, db.rateLimitBucket, {
    upsert: async (args: { where: { bucketKey_windowKey: { bucketKey: string } } }) => ({
      count: args.where.bucketKey_windowKey.bucketKey === "public-pilot-global" ? globalCount : 1,
    }),
  });
  let stored = 0;
  patch(t, db.pilotApplication, {
    create: async () => {
      stored += 1;
      return { id: `pilot-${stored}` };
    },
  });
  const input = pilotApplicationInputSchema.parse({
    email: "owner@shop.test",
    consent: true,
    consentVersion: PILOT_CONSENT_VERSION,
  });
  assert.deepEqual(await submitPilotApplication(input, { visitorHash: "v", now: NOW }), { id: "pilot-1", notify: false });

  globalCount = PUBLIC_PILOT_GLOBAL_HOURLY_HARD_MAX + 1;
  await assert.rejects(submitPilotApplication(input, { visitorHash: "v", now: NOW }), RateLimitExceededError);
  assert.equal(stored, 1, "only the safety valve refuses to store");
});

test("🔴 owner 账号已停用：询盘页当不存在；公开提交 404，不计限流、不落库", async (t) => {
  let disabledAt: Date | null = null;
  const selects: Array<Record<string, unknown>> = [];
  patch(t, db.workspace, {
    findUnique: async (args: { select: Record<string, unknown> }) => {
      selects.push(args.select);
      return enabledWorkspace({ owner: { disabledAt } });
    },
  });
  assert.equal((await getPublicLeadPage("sunny-shutter"))?.workspaceId, "ws-1");
  assert.deepEqual(selects[0].owner, { select: { disabledAt: true } });

  disabledAt = new Date("2026-10-25T00:00:00.000Z");
  assert.equal(await getPublicLeadPage("sunny-shutter"), null);
  const boom = async () => {
    throw new Error("a disabled owner's page must not rate-limit or store anything");
  };
  patch(t, db.rateLimitBucket, { upsert: boom });
  patch(t, db.lead, { findFirst: boom, create: boom, update: boom });
  await assert.rejects(
    submitPublicLead(publicLeadInputSchema.parse(validPublicLead), { visitorHash: "v", now: NOW }),
    LeadPageNotFoundError,
  );
});
