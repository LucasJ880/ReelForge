/**
 * 远程盲评页（claude.ai Artifact）：把一轮评测里两臂都出好的成片对填进 `scripts/eval/remote-review/template.html`。
 * 视频与商品照先作为 Artifact 资源上传（文件名 `<case>-L.mp4` / `<case>-R.mp4` / `<case>-<n>.jpg`，来自 `report`
 * 生成的 review/ 与 `score` 生成的 product-photos/），上传结果的地址记进 `<runDir>/remote-assets.json`。
 * 只收两段视频和全部商品照都已上传的用例；臂名绝不进页面（左右按 blind-key.json）。评分存在页面自己的数据库里，
 * 每位评审一份（votes/<评审 id>），评审之间互相看不到。
 *
 * 用法（仓库根目录）：npx tsx scripts/eval/build-review-page.ts <runDir> [out.html]
 *   golden-1029 的页面：https://claude.ai/artifact/Nb3ta8bSPoCwj3ynpJpxhh（换会话更新要带这个 url）
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN_SET_DIMENSIONS, parseGoldenSetCases } from "../lib/video-golden-set";

const [runDir, outArg] = process.argv.slice(2);
if (!runDir) throw new Error("用法：build-review-page.ts <runDir> [out.html]");
const outFile = outArg ?? join(runDir, "remote-review.html");
const templateFile = join(__dirname, "remote-review", "template.html");
const assetsFile = join(runDir, "remote-assets.json");

const cases = parseGoldenSetCases(JSON.parse(readFileSync(join(runDir, "cases.json"), "utf8")));
const key = JSON.parse(readFileSync(join(runDir, "blind-key.json"), "utf8")) as {
  runKey: string;
  layout: Array<{ caseId: string; left: string; right: string }>;
};
const assets: Record<string, string> = existsSync(assetsFile) ? JSON.parse(readFileSync(assetsFile, "utf8")) : {};
const uploaded = (name: string) => typeof assets[name] === "string" && assets[name].length > 0;

const ready = cases
  .filter((item) => key.layout.some((pair) => pair.caseId === item.id))
  .filter((item) => uploaded(`${item.id}-L.mp4`) && uploaded(`${item.id}-R.mp4`))
  .filter((item) => item.productImages.every((_, index) => uploaded(`${item.id}-${index + 1}.jpg`)));

const run = {
  runKey: key.runKey,
  dimensions: GOLDEN_SET_DIMENSIONS.map(({ id, label, question }) => ({ id, label, question })),
  cases: ready.map((item) => ({
    id: item.id,
    category: item.category,
    productName: item.productName,
    story: item.story,
    voiceover: item.voiceover,
    watchFor: item.watchFor,
    photos: item.productImages.map((_, index) => assets[`${item.id}-${index + 1}.jpg`]),
    left: assets[`${item.id}-L.mp4`],
    right: assets[`${item.id}-R.mp4`],
  })),
};

const json = JSON.stringify(run).replace(/</g, "\\u003c");
const armNames = new Set(key.layout.flatMap((pair) => [pair.left, pair.right]));
for (const arm of armNames) {
  if (new RegExp(`\\b${arm}\\b`).test(json)) throw new Error(`页面数据里出现了臂名 ${arm}，会破盲`);
}
const html = readFileSync(templateFile, "utf8")
  .replaceAll("__RUN_KEY__", key.runKey)
  .replace("__RUN_DATA__", () => json);
writeFileSync(outFile, html);
console.log(`[review-page] ${run.cases.length} 组（${run.cases.map((item) => item.id).join(", ") || "无"}）→ ${outFile}`);
