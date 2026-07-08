/**
 * 用 puppeteer-core + 本机 playwright chromium 截图验证恢复后的 UI。
 * 复用 curl cookie jar 的 next-auth session，免密码二次登录。
 */
import puppeteer from "puppeteer-core";
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const JAR = "/tmp/aivora_recover_jar";
const BRIEF_ID = process.argv[2] ?? "cmrcbuaji000rl404hzi2gzht";
const OUT_DIR = "tmp/recovery";

function findChromium() {
  const base = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dirs = readdirSync(base)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const d of dirs) {
    const p = path.join(
      base,
      d,
      "chrome-mac",
      "Chromium.app",
      "Contents",
      "MacOS",
      "Chromium",
    );
    try {
      readFileSync(p, { length: 1 });
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error("找不到 playwright chromium");
}

function sessionCookieFromJar() {
  const txt = readFileSync(JAR, "utf8");
  for (const line of txt.split("\n")) {
    if (line.includes("next-auth.session-token")) {
      const parts = line.trim().split(/\s+/);
      return parts[parts.length - 1];
    }
  }
  throw new Error("jar 里没有 session token");
}

const browser = await puppeteer.launch({
  executablePath: findChromium(),
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await browser.setCookie({
  name: "next-auth.session-token",
  value: sessionCookieFromJar(),
  domain: "localhost",
  path: "/",
  httpOnly: true,
});

for (const [name, url] of [
  ["videos-list", "http://localhost:3000/personal/videos"],
  ["video-detail", `http://localhost:3000/personal/videos/${BRIEF_ID}`],
]) {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const dest = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path: dest, fullPage: false });
  console.log(`shot: ${dest} ← ${url}`);
}

await browser.close();
