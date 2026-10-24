import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BOOTH_SOURCE,
  boothExternalRef,
  buildPilotImports,
  parseBoothLeads,
  parseBoothSessions,
  parseImportArgs,
  redact,
} from "../scripts/import-booth-leads";

/**
 * D9 展位线索导入：只解析与合并（纯函数），不碰库、不读本机真实文件。
 * 文件格式以 designs/aivora-v2-exchange/booth/relay.mjs 的 validateLead / handleLead 为准。
 */

const LEADS = [
  JSON.stringify({ ts: "2026-10-24T03:00:00.000Z", lang: "zh", sid: "ABCD2345", consentEmail: false, consentWhatsApp: false, consentWeChat: true, wechat: "factory_wx", sessionKnown: true }),
  "{broken json",
  JSON.stringify({ ts: "2026-10-24T05:00:00.000Z", lang: "zh", sid: "ABCD2345", consentEmail: true, consentWhatsApp: false, consentWeChat: false, email: "Buyer@Factory.cn", note: "要报价", sessionKnown: true }),
  JSON.stringify({ ts: "2026-10-24T06:00:00.000Z", lang: "en", sid: null, consentEmail: true, consentWhatsApp: true, consentWeChat: false, email: "owner@blinds.ca", whatsapp: "+1 905 555 0100", sessionKnown: false }),
  /// 填了联系方式却没勾同意：不导入
  JSON.stringify({ ts: "2026-10-24T07:00:00.000Z", lang: "en", sid: "zzzz7777", consentEmail: false, consentWhatsApp: false, email: "nope@x.com", sessionKnown: false }),
  JSON.stringify({ ts: "not-a-date", lang: "en", consentEmail: true, consentWhatsApp: false, email: "a@b.co" }),
].join("\n");

const SESSIONS = [
  JSON.stringify({ id: "abcd2345", ts: "2026-10-24T02:59:00.000Z", data: { v: 2, sid: "owner-sid-1", c: "blinds", ci: "佛山", q: "…" } }),
  JSON.stringify({ id: "efgh6789", ts: "2026-10-24T04:00:00.000Z", data: { v: 2, sid: "OWNER-SID-2", c: "curtains", ci: "Vaughan" } }),
].join("\n");

test("解析：坏行与无效时间跳过；只保留勾了同意的联系方式；一个同意都没有的线索不导入", () => {
  const { leads, skipped } = parseBoothLeads(LEADS);
  assert.equal(leads.length, 3);
  assert.equal(skipped, 3);
  assert.equal(leads[0].wechat, "factory_wx");
  assert.equal(leads[0].email, null);
  assert.ok(leads.every((lead) => lead.email !== "nope@x.com"));
});

test("合并：同一 sid 多次提交合成一条（最早时间、最新联系方式、留言保留）；行业与城市来自中继会话", () => {
  const imports = buildPilotImports(parseBoothLeads(LEADS).leads, parseBoothSessions(SESSIONS));
  assert.equal(imports.length, 2);
  const factory = imports.find((item) => item.externalRef === `${BOOTH_SOURCE}:ABCD2345`);
  assert.ok(factory);
  assert.equal(factory.createdAt.toISOString(), "2026-10-24T03:00:00.000Z");
  assert.equal(factory.wechat, "factory_wx");
  assert.equal(factory.email, "Buyer@Factory.cn");
  assert.equal(factory.industry, "blinds");
  assert.equal(factory.city, "佛山");
  assert.equal(factory.locale, "zh-CN");
  assert.equal(factory.message, "要报价");
  const consent = factory.consentJson as Record<string, unknown>;
  assert.equal(consent.version, "booth-relay-v1");
  assert.deepEqual(consent.channels, { email: true, whatsapp: false, wechat: false });

  const noSid = imports.find((item) => item.externalRef.startsWith(`${BOOTH_SOURCE}:nosid:`));
  assert.ok(noSid, "leads without a session id still get a stable external ref");
  assert.equal(noSid.whatsapp, "+1 905 555 0100");
  assert.equal(noSid.industry, null);
});

test("externalRef 幂等：同一条无 sid 线索每次导入算出同一个键", () => {
  const [, , lead] = parseBoothLeads(LEADS).leads;
  assert.equal(boothExternalRef(lead), boothExternalRef({ ...lead }));
  assert.notEqual(boothExternalRef(lead), boothExternalRef({ ...lead, email: "other@blinds.ca" }));
});

test("店主台 sid（data.sid）也能对上会话，大小写不敏感", () => {
  const sessions = parseBoothSessions(SESSIONS);
  assert.equal(sessions.get("owner-sid-2")?.city, "Vaughan");
  assert.equal(sessions.get("efgh6789")?.industry, "curtains");
});

test("终端摘要只打脱敏联系方式", () => {
  assert.equal(redact("buyer@factory.cn"), "b***@f***.cn");
  assert.equal(redact("+1 905 555 0100"), "***0100");
  assert.equal(redact(null), "-");
  assert.doesNotMatch(redact("factory_wx"), /factory_wx/);
});

test("参数：默认 dry-run 读 ~/.aivora-booth；--apply 才写；未知参数报错", () => {
  const previous = process.env.AIVORA_BOOTH_DATA;
  delete process.env.AIVORA_BOOTH_DATA;
  try {
    assert.deepEqual(parseImportArgs([]), { apply: false, dir: path.join(os.homedir(), ".aivora-booth"), help: false });
    assert.equal(parseImportArgs(["--apply"]).apply, true);
    assert.equal(parseImportArgs(["--dir", "~/elsewhere"]).dir, path.join(os.homedir(), "elsewhere"));
    assert.throws(() => parseImportArgs(["--commit"]), /Unknown argument/);
  } finally {
    if (previous !== undefined) process.env.AIVORA_BOOTH_DATA = previous;
  }
});
