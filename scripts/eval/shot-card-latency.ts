/**
 * 镜头卡相关模型调用的量测（2026-11-10）：合格率与耗时。只调模型——不写库、不出图、不出片、不花供应商的钱。
 *
 * 为什么有这个脚本：11-09 把「建故事板一次看图调用」没量过就缺省打开，线上首跑只用上三样里的一样、耗时 59 秒。
 * 之后的做法是：新的模型调用先用评测集的 10 个品类量一遍，再决定开不开、要不要真机实验。
 *
 * 现在只量线上在用的那一种：text——纯文字写镜头卡。脚本按「写法」组织，新的写法加一个 Mode 就能并排量。
 * 当初一起量过的另外两种（看着商品图写卡 STORYBOARD_SHOT_CARDS_VISION、镜头卡 + 英译 + 盘点捆成一次看图调用
 * STORYBOARD_DIRECTION）都判了不值得，代码与开关 2026-11-16 删除；它们的量测结果留在下面备查。
 *
 * 用法（仓库根目录；需要 .env.local 里的 OPENAI_API_KEY，花费是每个用例一次模型调用）：
 *   npm run eval:shot-cards
 *   npm run eval:shot-cards -- --cases bottle,serum --concurrency 2
 *
 * 2026-11-10 的一次结果（每种 10 个用例各一次，本机并发 3）：
 *   text      10/10 合格，中位 14.4 秒，P90 31.3 秒
 *   vision    10/10 合格，0 次退回纯文字，中位 16.3 秒，P90 32.2 秒（已删）
 *   direction 三样齐全 9/10，中位 46.6 秒，P90 56.7 秒，1 次超过线上 55 秒超时线（已删）
 */
import { chatJsonByTier } from "../../src/lib/ai";
import { designStoryboardShotCards } from "../../src/lib/video-generation/shot-cards";
import casesFile from "./golden-set.cases.json";

type Mode = "text";
const ALL_MODES: Mode[] = ["text"];
const BEATS = ["0-4s · 开场钩子", "4-8s · 使用商品", "8-12s · 效果兑现", "12-15s · 收尾定格"];
/// 与线上一致的超时线，用来数「会撞上超时」的次数；量测本身不按它截断
const PRODUCTION_TIMEOUT_SEC: Record<Mode, number> = { text: 40 };

interface GoldenCase {
  id: string;
  story?: string;
  prompt?: string;
  rawPrompt?: string;
  productImages: string[];
  voiceoverScript?: string;
  voiceover?: string;
}

interface Row {
  id: string;
  sec: number;
  ok: boolean;
  note: string;
}

function parseArgs(argv: string[]) {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const modes = (value("--modes")?.split(",").map((mode) => mode.trim()) ?? ALL_MODES).filter((mode): mode is Mode =>
    (ALL_MODES as string[]).includes(mode),
  );
  const cases = value("--cases")?.split(",").map((id) => id.trim()).filter(Boolean) ?? null;
  const concurrency = Math.max(1, Math.min(5, Number(value("--concurrency") ?? 3) || 3));
  return { modes: modes.length > 0 ? modes : ALL_MODES, cases, concurrency };
}

function shotInput(item: GoldenCase) {
  return {
    story: item.story ?? item.prompt ?? item.rawPrompt ?? "",
    beats: BEATS,
    durationSec: 15,
    aspectRatio: "9:16",
    productImageCount: item.productImages.length,
    personImageCount: 0,
    voiceoverScript: item.voiceoverScript ?? item.voiceover ?? null,
  };
}

async function measure(_mode: Mode, item: GoldenCase): Promise<Row> {
  const input = shotInput(item);
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  const cards = await designStoryboardShotCards(input, {
    enabled: true,
    llmAvailable: () => true,
    timeoutMs: 180_000,
    chat: chatJsonByTier,
  });
  const sample = cards?.[0] ? `${cards[0].startState} | ${cards[0].action}` : "";
  return { id: item.id, sec: seconds(), ok: Boolean(cards), note: sample.slice(0, 140) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = (Array.isArray(casesFile) ? casesFile : (casesFile as { cases: GoldenCase[] }).cases) as GoldenCase[];
  const selected = args.cases ? all.filter((item) => args.cases?.includes(item.id)) : all;
  if (selected.length === 0) throw new Error("没有匹配的用例");
  console.log(`量测 ${args.modes.join(" / ")}：${selected.length} 个用例，并发 ${args.concurrency}。只调模型，不出图不出片。`);
  for (const mode of args.modes) {
    const queue = [...selected];
    const rows: Row[] = [];
    const worker = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        try {
          rows.push(await measure(mode, next));
        } catch (error) {
          rows.push({ id: next.id, sec: -1, ok: false, note: `报错：${String((error as Error).message).slice(0, 120)}` });
        }
      }
    };
    await Promise.all(Array.from({ length: args.concurrency }, worker));
    rows.sort((a, b) => a.id.localeCompare(b.id));
    console.log(`\n== ${mode}`);
    for (const row of rows) console.log(`${row.id.padEnd(10)} ${String(row.sec).padStart(6)}s  ${row.ok ? "合格" : "不合格"}  ${row.note}`);
    const secs = rows.map((row) => row.sec).filter((sec) => sec >= 0).sort((a, b) => a - b);
    const pct = (p: number) => (secs.length > 0 ? secs[Math.min(secs.length - 1, Math.floor(p * secs.length))] : null);
    console.log(
      `小结 ${mode}：合格 ${rows.filter((row) => row.ok).length}/${rows.length}，中位 ${pct(0.5)} 秒，P90 ${pct(0.9)} 秒，最慢 ${secs[secs.length - 1] ?? null} 秒，`
        + `超过线上超时线（${PRODUCTION_TIMEOUT_SEC[mode]} 秒）${secs.filter((sec) => sec > PRODUCTION_TIMEOUT_SEC[mode]).length} 次`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
