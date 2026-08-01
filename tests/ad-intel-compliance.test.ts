import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  adIntelObservationSchema,
  adStructureSchema,
  coerceStructure,
  structuresToPromptLines,
} from "../src/lib/services/ad-intel-service";

/**
 * PRD 风险 #7：广告情报的合规边界会滑坡 —— 从「提取结构」滑到「复用素材」。
 * 缓解措施写的是「采集层只保留结构标注不落素材文件；下载入口在代码层不存在，
 * 靠回归测试守住」。这个文件就是那道回归测试。
 */

const schemaSource = readFileSync(
  path.join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const serviceSource = readFileSync(
  path.join(process.cwd(), "src/lib/services/ad-intel-service.ts"),
  "utf8",
);

function adIntelModelBlock(): string {
  const start = schemaSource.indexOf("model AdIntelRecipe");
  assert.ok(start > 0, "AdIntelRecipe 模型必须存在");
  return schemaSource.slice(start, schemaSource.indexOf("\n}", start));
}

test("🔴 AdIntelRecipe 表里不存在任何素材字段", () => {
  const block = adIntelModelBlock();
  for (const forbidden of [
    "mediaUrl",
    "videoUrl",
    "downloadUrl",
    "thumbnailUrl",
    "thumbUrl",
    "imageUrl",
    "assetUrl",
    "sourceUrl",
    "blobUrl",
  ]) {
    assert.ok(
      !block.includes(forbidden),
      `AdIntelRecipe 不得有 ${forbidden} —— 加了就等于给「搬运」留了落脚点`,
    );
  }
});

test("🔴 观测入参会剥掉素材字段，采集器传了也进不来", () => {
  const parsed = adIntelObservationSchema.parse({
    source: "META_AD_LIBRARY",
    externalRef: "ad-1",
    industry: "定制窗帘",
    observedCopy: "画面：有人在量窗户。字幕：免费上门量尺。",
    observedAt: "2026-08-01T00:00:00Z",
    daysRunning: 45,
    /// 采集器可能拿到这些，但它们不该越过边界
    downloadUrl: "https://cdn.example.com/ad.mp4",
    videoUrl: "https://cdn.example.com/ad.mp4",
    thumbnailUrl: "https://cdn.example.com/ad.jpg",
  });
  for (const forbidden of ["downloadUrl", "videoUrl", "thumbnailUrl"]) {
    assert.ok(!(forbidden in parsed), `${forbidden} 必须被剥掉`);
  }
});

test("🔴 服务层不读、不写、不返回任何素材字段", () => {
  for (const forbidden of [
    "downloadUrl",
    "videoUrl",
    "thumbnailUrl",
    "mediaUrl",
  ]) {
    /// 只允许出现在说明「我们不做这个」的注释与测试里，服务层代码不许碰。
    const codeLines = serviceSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("///"))
      .join("\n");
    assert.ok(
      !codeLines.includes(forbidden),
      `ad-intel-service 的代码路径不得出现 ${forbidden}`,
    );
  }
});

test("结构标注的提示词明确禁止复制原文措辞", () => {
  /// 结构、策略、创意方向不受版权保护；受保护的是具体表达。
  assert.match(serviceSource, /Never copy or paraphrase/i);
  assert.match(serviceSource, /Never output URLs/i);
});

test("钩子类型与开场缺失时整条丢弃，不存半残配方", () => {
  assert.equal(coerceStructure({ hookType: "Vibes", openingBeats: "x", pacing: "y" }), null);
  assert.equal(coerceStructure({ hookType: "POV", pacing: "y" }), null);
  assert.equal(coerceStructure({ hookType: "POV", openingBeats: "x" }), null);
  assert.ok(coerceStructure({ hookType: "POV", openingBeats: "x", pacing: "y" }));
});

test("none / null 之类的占位串归一化为 null", () => {
  const structure = coerceStructure({
    hookType: "Demo",
    openingBeats: "有人打开卷帘",
    pacing: "5 秒 3 刀",
    socialProof: "none",
    ctaForm: "  ",
  });
  assert.equal(structure?.socialProof, null);
  assert.equal(structure?.ctaForm, null);
});

test("结构契约用的是与我方赛马同一套钩子枚举", () => {
  assert.throws(() =>
    adStructureSchema.parse({
      hookType: "Vibes",
      openingBeats: "x",
      pacing: "y",
      sellingPointOrder: [],
      socialProof: null,
      ctaForm: null,
    }),
  );
});

test("喂给生成的提示词只带结构与投放天数，不带原文", () => {
  const lines = structuresToPromptLines([
    {
      id: "r1",
      source: "META_AD_LIBRARY",
      industry: "定制窗帘",
      hookType: "Pain",
      openingBeats: "有人对着空窗户发愁",
      pacing: "前 3 秒两刀",
      sellingPointOrder: ["安装速度", "遮光"],
      socialProof: "评价截图",
      ctaForm: "私信预约",
      durationSec: 15,
      aspectRatio: "9:16",
      daysRunning: 92,
      observedAt: new Date("2026-08-01"),
    },
  ] as never);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /连续投放 92 天/);
  assert.match(lines[0], /钩子=Pain/);
  /// 提示词里不该出现任何指向原素材的东西
  assert.ok(!/https?:\/\//.test(lines[0]));
});

test("按行业取清单时排除没有投放天数的观测", () => {
  /// 拿不到「还在赚钱」这个信号，它就只是一条看起来不错的广告。
  assert.match(serviceSource, /daysRunning: \{ gte: args\.minDaysRunning \?\? 14 \}/);
  assert.match(serviceSource, /orderBy: \[\{ daysRunning: "desc" \}/);
});
