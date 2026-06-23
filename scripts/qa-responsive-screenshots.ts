/**
 * 用本机 Chrome（puppeteer-core）对 /showcase 在手机/平板宽度下抓全页 + 关键区块截图，
 * 供响应式适配人工核对。仅本地 QA 用，不进生产。
 *
 * 用法：先 `npm run dev`，再 `tsx scripts/qa-responsive-screenshots.ts`
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const URL = process.env.QA_URL || "http://localhost:3000/showcase";
const OUT_DIR = resolve(process.cwd(), "tmp/qa-responsive");
const CHROME =
  process.env.QA_CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, dsf: 2 },
  { name: "tablet", width: 820, height: 1180, dsf: 2 },
];

// 关键区块锚点：抓 element 截图看细节
const SECTIONS = [
  "hardware-kit",
  "demo-story",
  "auto-videos",
  "before-after",
  "collar-pov",
  "brand-proof-scenario",
  "benchmark",
  "flywheel",
];

async function main() {
  if (!existsSync(CHROME)) throw new Error(`找不到 Chrome：${CHROME}`);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars"],
  });

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.dsf,
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
    // 触发懒加载图片
    await autoScroll(page);

    const full = resolve(OUT_DIR, `${vp.name}-full.png`);
    await page.screenshot({ path: full as `${string}.png`, fullPage: true });
    console.log(`full  ${vp.name} -> ${full}`);

    for (const id of SECTIONS) {
      const el = await page.$(`#${id}`);
      if (!el) {
        console.log(`  (skip #${id}: not found)`);
        continue;
      }
      await el.scrollIntoView();
      const out = resolve(OUT_DIR, `${vp.name}-${id}.png`);
      try {
        await el.screenshot({ path: out as `${string}.png` });
        console.log(`  sec ${vp.name} #${id} -> ${out}`);
      } catch (e) {
        console.log(`  (fail #${id}: ${(e as Error).message})`);
      }
    }
    await page.close();
  }

  await browser.close();
  // 输出尺寸概览
  for (const vp of VIEWPORTS) {
    const full = resolve(OUT_DIR, `${vp.name}-full.png`);
    try {
      const dim = execFileSync("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        full,
      ])
        .toString()
        .trim();
      console.log(`${vp.name}-full dimensions: ${dim}`);
    } catch {
      /* ignore */
    }
  }
  console.log("done.");
}

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((res) => {
      let total = 0;
      const step = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          setTimeout(res, 400);
        }
      }, 80);
    });
  });
}

main().catch((err) => {
  console.error("QA 截图失败：", (err as Error).message);
  process.exit(1);
});
