/**
 * 广交会展位线索 → PilotApplication（计划 D9，由主线程在 10/27 前跑）。
 *
 * 数据来源：展位中继 designs/aivora-v2-exchange/booth/relay.mjs 写在本机的
 *   ~/.aivora-booth/leads.jsonl     每行 {ts, lang, sid?, email?, whatsapp?, wechat?,
 *                                    consentEmail, consentWhatsApp, consentWeChat, note?, sessionKnown}
 *   ~/.aivora-booth/sessions.jsonl  每行 {id, ts, data:{v, sid, c(行业), ci(城市), q, ul, rl, …}}
 * 中继只存「勾了同意」的联系方式；线索里的 sid 是中继会话 id 或店主台 sid，两者都能对上 session。
 *
 * 写入：按 externalRef 幂等 upsert（`canton-fair:<sid>`；没有 sid 的用内容哈希）。
 *   - source = "canton-fair"；consentJson 记逐渠道同意与中继同意文本版本；createdAt 用线索时间。
 *   - 重复导入只补空字段，不覆盖已有联系方式，不动 status / archivedAt（跟进进度不被冲掉）。
 *
 * 用法（默认 dry-run，只读，打印脱敏摘要；--apply 才写库）：
 *   node --env-file-if-exists=.env.local --import tsx scripts/import-booth-leads.ts
 *   CONFIRM_PRODUCTION_DB=import-booth-leads node --env-file-if-exists=.env.local --import tsx scripts/import-booth-leads.ts --apply
 *   可选 --dir <path>（默认 $AIVORA_BOOTH_DATA 或 ~/.aivora-booth）
 * .env.local 直连生产库：--apply 必须带 CONFIRM_PRODUCTION_DB=import-booth-leads（与 db:* 脚本同一道闸）。
 * 终端只打脱敏后的联系方式，不打全文。
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";

export const BOOTH_SOURCE = "canton-fair";
/// 展位结果页的同意文案版本（relay.mjs 的逐渠道勾选；文案在 result.html）
export const BOOTH_CONSENT_VERSION = "booth-relay-v1";

export type BoothLead = {
  ts: string;
  lang: string | null;
  sid: string | null;
  email: string | null;
  whatsapp: string | null;
  wechat: string | null;
  consentEmail: boolean;
  consentWhatsApp: boolean;
  consentWeChat: boolean;
  note: string | null;
  sessionKnown: boolean;
};

export type BoothSession = { id: string; sid: string | null; industry: string | null; city: string | null; day: string | null };

export type PilotApplicationImport = {
  externalRef: string;
  createdAt: Date;
  email: string | null;
  whatsapp: string | null;
  wechat: string | null;
  locale: string | null;
  industry: string | null;
  city: string | null;
  message: string | null;
  consentJson: Prisma.InputJsonValue;
};

function str(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** 逐行解析 jsonl：坏行跳过并计数，不让一行坏数据拖垮整次导入。 */
function parseJsonl(text: string): { rows: Record<string, unknown>[]; skipped: number } {
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) rows.push(value as Record<string, unknown>);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { rows, skipped };
}

export function parseBoothLeads(text: string): { leads: BoothLead[]; skipped: number } {
  const { rows, skipped } = parseJsonl(text);
  let invalid = 0;
  const leads: BoothLead[] = [];
  for (const row of rows) {
    const ts = str(row.ts, 40);
    if (!ts || Number.isNaN(Date.parse(ts))) {
      invalid += 1;
      continue;
    }
    /// 中继本来就只存勾了同意的联系方式；这里再按同意位过滤一次（防止旧版本中继或手改文件）
    const email = row.consentEmail === true ? str(row.email, 254) : null;
    const whatsapp = row.consentWhatsApp === true ? str(row.whatsapp, 32) : null;
    const wechat = row.consentWeChat === true ? str(row.wechat, 40) : null;
    if (!email && !whatsapp && !wechat) {
      invalid += 1;
      continue;
    }
    leads.push({
      ts,
      lang: str(row.lang, 16),
      sid: str(row.sid, 32),
      email,
      whatsapp,
      wechat,
      consentEmail: row.consentEmail === true,
      consentWhatsApp: row.consentWhatsApp === true,
      consentWeChat: row.consentWeChat === true,
      note: str(row.note, 1000),
      sessionKnown: row.sessionKnown === true,
    });
  }
  return { leads, skipped: skipped + invalid };
}

export function parseBoothSessions(text: string): Map<string, BoothSession> {
  const { rows } = parseJsonl(text);
  const byKey = new Map<string, BoothSession>();
  for (const row of rows) {
    const id = str(row.id, 32);
    const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
    const session: BoothSession = {
      id: id ?? "",
      sid: str(data.sid, 32),
      industry: str(data.c, 80),
      city: str(data.ci, 80),
      day: str(data.day, 16),
    };
    /// 线索的 sid 可能是中继会话 id（?id=）或店主台的 sid，两个键都登记
    if (id) byKey.set(id.toLowerCase(), session);
    if (session.sid) byKey.set(session.sid.toLowerCase(), session);
  }
  return byKey;
}

export function boothExternalRef(lead: BoothLead): string {
  if (lead.sid) return `${BOOTH_SOURCE}:${lead.sid}`;
  const digest = createHash("sha256")
    .update([lead.ts, lead.email ?? "", lead.whatsapp ?? "", lead.wechat ?? ""].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `${BOOTH_SOURCE}:nosid:${digest}`;
}

function boothLocale(lang: string | null): string | null {
  if (!lang) return null;
  if (/^zh/i.test(lang)) return "zh-CN";
  if (/^en/i.test(lang)) return "en-US";
  return lang;
}

/**
 * 同一 externalRef 的多条线索（访客改了联系方式再提交）合并成一条：时间取最早，
 * 联系方式取最新的非空值，留言拼接。
 */
export function buildPilotImports(leads: BoothLead[], sessions: Map<string, BoothSession>): PilotApplicationImport[] {
  const merged = new Map<string, PilotApplicationImport>();
  const sorted = [...leads].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const lead of sorted) {
    const externalRef = boothExternalRef(lead);
    const session = lead.sid ? sessions.get(lead.sid.toLowerCase()) : undefined;
    const existing = merged.get(externalRef);
    const consent = {
      version: BOOTH_CONSENT_VERSION,
      source: "canton-fair booth result page",
      acceptedAt: lead.ts,
      channels: { email: lead.consentEmail, whatsapp: lead.consentWhatsApp, wechat: lead.consentWeChat },
      sessionKnown: lead.sessionKnown,
    };
    if (!existing) {
      merged.set(externalRef, {
        externalRef,
        createdAt: new Date(lead.ts),
        email: lead.email,
        whatsapp: lead.whatsapp,
        wechat: lead.wechat,
        locale: boothLocale(lead.lang),
        industry: session?.industry ?? null,
        city: session?.city ?? null,
        message: lead.note,
        consentJson: consent,
      });
      continue;
    }
    existing.email = lead.email ?? existing.email;
    existing.whatsapp = lead.whatsapp ?? existing.whatsapp;
    existing.wechat = lead.wechat ?? existing.wechat;
    existing.locale = boothLocale(lead.lang) ?? existing.locale;
    existing.industry = existing.industry ?? session?.industry ?? null;
    existing.city = existing.city ?? session?.city ?? null;
    if (lead.note && lead.note !== existing.message) {
      existing.message = existing.message ? `${existing.message}\n${lead.note}`.slice(0, 1000) : lead.note;
    }
    existing.consentJson = consent;
  }
  return [...merged.values()];
}

/** 终端摘要只给脱敏后的联系方式。 */
export function redact(value: string | null): string {
  if (!value) return "-";
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}***@${value.slice(at + 1).replace(/^[^.]+/, (domain) => `${domain[0]}***`)}`;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) return `***${digits.slice(-4)}`;
  return `${value[0]}***`;
}

export function parseImportArgs(args: string[]): { apply: boolean; dir: string; help: boolean } {
  let apply = false;
  let help = false;
  let dir = process.env.AIVORA_BOOTH_DATA || path.join(os.homedir(), ".aivora-booth");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--dir") dir = args[++index] ?? dir;
    else if (arg.startsWith("--dir=")) dir = arg.slice("--dir=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (dir === "~" || dir.startsWith("~/")) dir = path.join(os.homedir(), dir.slice(2));
  return { apply, dir: path.resolve(dir), help };
}

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function main() {
  const options = parseImportArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: import-booth-leads.ts [--dir ~/.aivora-booth] [--apply]");
    return;
  }
  if (options.apply && process.env.CONFIRM_PRODUCTION_DB !== "import-booth-leads") {
    console.error("--apply 会写入 DATABASE_URL 指向的库（.env.local = 生产）。确认后：CONFIRM_PRODUCTION_DB=import-booth-leads … --apply");
    process.exitCode = 1;
    return;
  }

  const [leadsText, sessionsText] = await Promise.all([
    readOptional(path.join(options.dir, "leads.jsonl")),
    readOptional(path.join(options.dir, "sessions.jsonl")),
  ]);
  const { leads, skipped } = parseBoothLeads(leadsText);
  const imports = buildPilotImports(leads, parseBoothSessions(sessionsText));
  console.log(`[booth-import] dir=${options.dir} · 线索 ${leads.length} 条 · 跳过 ${skipped} 行 · 合并后 ${imports.length} 条`);

  const { db } = await import("../src/lib/db");
  try {
    const existing = new Set(
      (
        await db.pilotApplication.findMany({
          where: { externalRef: { in: imports.map((item) => item.externalRef) } },
          select: { externalRef: true },
        })
      ).flatMap((row) => (row.externalRef ? [row.externalRef] : [])),
    );
    for (const item of imports) {
      console.log(
        `  ${existing.has(item.externalRef) ? "update" : "create"}  ${item.externalRef}  ${item.createdAt.toISOString()}  ` +
          `email=${redact(item.email)} wa=${redact(item.whatsapp)} wx=${redact(item.wechat)}  ` +
          `${item.industry ?? "-"} / ${item.city ?? "-"}`,
      );
    }
    if (!options.apply) {
      console.log("[booth-import] dry-run：未写库。确认无误后加 --apply（并带 CONFIRM_PRODUCTION_DB=import-booth-leads）。");
      return;
    }
    let created = 0;
    let updated = 0;
    for (const item of imports) {
      const current = await db.pilotApplication.findUnique({ where: { externalRef: item.externalRef } });
      if (!current) {
        await db.pilotApplication.create({
          data: {
            externalRef: item.externalRef,
            source: BOOTH_SOURCE,
            createdAt: item.createdAt,
            email: item.email,
            whatsapp: item.whatsapp,
            wechat: item.wechat,
            locale: item.locale,
            industry: item.industry,
            city: item.city,
            message: item.message,
            consentJson: item.consentJson,
          },
        });
        created += 1;
        continue;
      }
      /// 只补空字段：人工跟进时改过的联系方式、状态、归档都不动
      await db.pilotApplication.update({
        where: { externalRef: item.externalRef },
        data: {
          email: current.email ?? item.email,
          whatsapp: current.whatsapp ?? item.whatsapp,
          wechat: current.wechat ?? item.wechat,
          locale: current.locale ?? item.locale,
          industry: current.industry ?? item.industry,
          city: current.city ?? item.city,
          message: current.message ?? item.message,
          ...(current.consentJson ? {} : { consentJson: item.consentJson }),
        },
      });
      updated += 1;
    }
    console.log(`[booth-import] 已写入：新建 ${created} 条 · 更新 ${updated} 条`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[booth-import] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
