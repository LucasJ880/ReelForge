/**
 * 线路真值表（1025 验收）：逐条探测每个外部依赖「通 / 不通 / 阻塞」。
 *
 * 只做免费或近乎免费的探测（余额、模型列表、一次极小的文本 / 语音 / 抓取），
 * 不提交任何视频生成——真实出片由试点商家全旅程覆盖。
 *
 * 2026-10-26（X-SCAF-4）补齐本轮实验探针：
 *   - Sync Labs / TTS 试用 / 抠图 key 只报「配没配」，不触网、绝不打印值；
 *   - Shuyu 原始 /prices 里是否出现 Seedance 2.5 档（E7′ 触发器）：2.5 候选、30s、音频/视频参考字段，
 *     以及严格 schema 是否仍能解析（解析失败 = 生产 getShuyuPrices 整体报错）。
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/e2e-1025/route-truth-table.ts [--base=https://reelforge-delta.vercel.app] [--json=out.json]
 *   npx tsx scripts/e2e-1025/route-truth-table.ts --keys-only   # 只看实验 key 配置，不发任何请求
 *   npx tsx scripts/e2e-1025/route-truth-table.ts --help
 */
import { writeFileSync } from "node:fs";
import {
  SHUYU_API_BASE_URL,
  getShuyuBalance,
  shuyuPricesResponseSchema,
} from "../../src/lib/providers/shuyu";
import {
  describeSeedance25Signal,
  detectShuyuSeedance25,
} from "../../src/lib/providers/shuyu-seedance25-probe";
import { experimentKeyPresence } from "../lib/experiment-key-presence";

type Verdict = "通" | "不通" | "阻塞" | "未配置" | "已配置" | "配置有误";
type Row = { line: string; verdict: Verdict; detail: string; ms: number };

const HELP = `route-truth-table —— 外部依赖真值表（只做免费/近乎免费的探测，不提交任何视频生成）

  --base=<url>   线上环境（默认 NEXT_PUBLIC_APP_URL 或 reelforge-delta）
  --json=<file>  结果另存 JSON
  --keys-only    只输出实验 key 是否已配置（Sync / TTS / 抠图），不发任何网络请求
  --help         打印本说明`;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")] as const;
  }),
);
const base = (args.get("base") || process.env.NEXT_PUBLIC_APP_URL || "https://reelforge-delta.vercel.app").replace(/\/$/, "");

async function probe(line: string, run: () => Promise<{ verdict: Verdict; detail: string }>): Promise<Row> {
  const started = Date.now();
  try {
    const result = await run();
    return { line, ...result, ms: Date.now() - started };
  } catch (error) {
    return { line, verdict: "不通", detail: (error as Error).message.slice(0, 160), ms: Date.now() - started };
  }
}

async function http(url: string, init?: RequestInit, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function statusVerdict(status: number, blockedStatuses: number[] = [401, 402, 403]): Verdict {
  if (status >= 200 && status < 300) return "通";
  if (blockedStatuses.includes(status)) return "阻塞";
  return "不通";
}

function keyPresenceRows(): Row[] {
  return experimentKeyPresence(process.env).map((row) => ({ ...row, ms: 0 }));
}

function printRows(rows: Row[]) {
  console.table(rows.map((row) => ({ 线路: row.line, 结论: row.verdict, 说明: row.detail, 耗时: `${row.ms}ms` })));
}

async function main() {
  if (args.has("help") || args.has("h")) {
    console.log(HELP);
    return;
  }
  if (args.has("keys-only")) {
    printRows(keyPresenceRows());
    return;
  }
  const openaiKey = env("OPENAI_API_KEY");
  const rows = await Promise.all([
    probe("Shuyu（buddy 视频线 · 余额）", async () => {
      if (!env("SHUYU_API_KEY", "shuyu_api_key")) return { verdict: "未配置", detail: "缺 SHUYU_API_KEY" };
      const balance = await getShuyuBalance();
      return { verdict: "通", detail: `余额 ${JSON.stringify(balance).slice(0, 120)}` };
    }),
    probe("OpenAI 模型列表", async () => {
      if (!openaiKey) return { verdict: "未配置", detail: "缺 OPENAI_API_KEY" };
      const res = await http("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${openaiKey}` } });
      const count = res.status === 200 ? (JSON.parse(res.text).data ?? []).length : 0;
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status} · ${count} 个模型` };
    }),
    probe("OpenAI 文本（OPENAI_MODEL）", async () => {
      if (!openaiKey) return { verdict: "未配置", detail: "缺 OPENAI_API_KEY" };
      const model = env("OPENAI_MODEL") ?? "gpt-5.6-mini";
      const res = await http("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with OK." }], max_completion_tokens: 16 }),
      });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status} · ${model}` };
    }),
    probe("OpenAI 语音（TTS）", async () => {
      if (!openaiKey) return { verdict: "未配置", detail: "缺 OPENAI_API_KEY" };
      const res = await http("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts", voice: "alloy", input: "OK" }),
      });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status} · ${res.status === 200 ? "已返回音频" : res.text.slice(0, 100)}` };
    }),
    probe("OpenAI 内容审核", async () => {
      if (!openaiKey) return { verdict: "未配置", detail: "缺 OPENAI_API_KEY" };
      const res = await http("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "omni-moderation-latest", input: "window blinds" }),
      });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status}${res.status === 200 ? "" : ` · ${res.text.slice(0, 100)}`}` };
    }),
    probe("Firecrawl（链接起片抓取）", async () => {
      const key = env("FIRECRAWL_API_KEY");
      if (!key) return { verdict: "未配置", detail: "缺 FIRECRAWL_API_KEY" };
      const res = await http("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", formats: ["markdown"] }),
      }, 60_000);
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status}` };
    }),
    probe("Pexels（b-roll 素材）", async () => {
      const key = env("PEXELS_API_KEYS")?.split(",")[0]?.trim();
      if (!key) return { verdict: "未配置", detail: "缺 PEXELS_API_KEYS" };
      const res = await http("https://api.pexels.com/videos/search?query=window%20blinds&per_page=1", { headers: { Authorization: key } });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status}` };
    }),
    probe("remove.bg（产品抠图）", async () => {
      const key = env("REMOVE_BG_API_KEY");
      if (!key) return { verdict: "未配置", detail: "缺 REMOVE_BG_API_KEY" };
      const res = await http("https://api.remove.bg/v1.0/account", { headers: { "X-Api-Key": key } });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status}` };
    }),
    probe("火山引擎 ARK（国内降级视频线）", async () => {
      const key = env("ARK_API_KEY");
      if (!key) return { verdict: "未配置", detail: "缺 ARK_API_KEY" };
      const arkBase = (env("ARK_BASE_URL") ?? "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
      const res = await http(`${arkBase}/contents/generations/tasks?page_num=1&page_size=1`, { headers: { Authorization: `Bearer ${key}` } });
      const overdue = /Overdue|欠费/i.test(res.text);
      return { verdict: overdue ? "阻塞" : statusVerdict(res.status), detail: `HTTP ${res.status}${overdue ? " · 账户欠费" : ""}` };
    }),
    probe("BytePlus ARK（海外视频线）", async () => {
      const key = env("BYTEPLUS_ARK_API_KEY");
      if (!key) return { verdict: "未配置", detail: "缺 BYTEPLUS_ARK_API_KEY" };
      const res = await http("https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks?page_num=1&page_size=1", { headers: { Authorization: `Bearer ${key}` } });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status}${res.status >= 400 ? ` · ${res.text.slice(0, 100)}` : ""}` };
    }),
    probe("Shuyu 目录 · Seedance 2.5 档（E7′ 触发器）", async () => {
      const key = env("SHUYU_API_KEY", "shuyu_api_key");
      if (!key) return { verdict: "未配置", detail: "缺 SHUYU_API_KEY" };
      /// 读原始 JSON 而不是 getShuyuPrices：严格 schema 会把 30s 新档整份拒掉、新字段 strip 掉。
      const res = await http(`${SHUYU_API_BASE_URL}/prices`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
      });
      if (res.status !== 200) return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status}` };
      const payload: unknown = JSON.parse(res.text);
      const strictSchemaOk = shuyuPricesResponseSchema.safeParse(payload).success;
      const signal = detectShuyuSeedance25(payload);
      return {
        verdict: strictSchemaOk ? "通" : "不通",
        detail: describeSeedance25Signal(signal, strictSchemaOk),
      };
    }),
    probe("HeyGen（数字人）", async () => {
      const key = env("HEYGEN_API_KEY");
      if (!key) return { verdict: "未配置", detail: "缺 HEYGEN_API_KEY" };
      const res = await http("https://api.heygen.com/v2/user/remaining_quota", { headers: { "X-Api-Key": key } });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status}` };
    }),
    probe("Vercel Blob（素材存储）", async () => {
      return env("BLOB_READ_WRITE_TOKEN")
        ? { verdict: "通", detail: "令牌已配置（读写由旅程中的上传验证）" }
        : { verdict: "未配置", detail: "缺 BLOB_READ_WRITE_TOKEN" };
    }),
    probe("线上健康检查 /api/health", async () => {
      const res = await http(`${base}/api/health`);
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status} · ${res.text.slice(0, 120)}` };
    }),
    probe("线上媒体运行时 /api/health/media（ffmpeg）", async () => {
      const secret = env("CRON_SECRET");
      if (!secret) return { verdict: "未配置", detail: "缺 CRON_SECRET" };
      const res = await http(`${base}/api/health/media`, { headers: { Authorization: `Bearer ${secret}` } }, 120_000);
      return { verdict: statusVerdict(res.status, [404]), detail: `HTTP ${res.status} · ${res.text.slice(0, 160)}` };
    }),
    probe("青砚同步 /api/videos（机器鉴权）", async () => {
      const secret = env("CRON_SECRET");
      if (!secret) return { verdict: "未配置", detail: "缺 CRON_SECRET" };
      const res = await http(`${base}/api/videos?limit=1`, { headers: { Authorization: `Bearer ${secret}` } });
      return { verdict: statusVerdict(res.status), detail: `HTTP ${res.status} · ${res.text.slice(0, 120)}` };
    }),
  ]);
  rows.push(...keyPresenceRows());

  printRows(rows);
  const out = args.get("json");
  if (out) writeFileSync(out, JSON.stringify({ base, at: new Date().toISOString(), rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
