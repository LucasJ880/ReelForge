/**
 * 成片烧入的常驻「AI生成」角标：开关判定 + 滤镜图 + 真跑一次 ffmpeg 看像素。
 * 集成部分用 lavfi 合成素材，不连任何外部服务；本机没有带 libass 的 ffmpeg 时跳过。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  AI_BADGE_FONT_FAMILY,
  AI_BADGE_TEXT,
  aiBadgeGeometry,
  renderAiBadgeAss,
  shouldBurnAiBadge,
} from "../src/lib/compliance/ai-generated-badge";
import { runFfmpeg } from "../src/lib/media/ffmpeg-bin";
import { CJK_FONT_FAMILY } from "../src/lib/media/media-fonts";
import { buildTimelineFilterGraph, composeTimeline } from "../src/lib/media/stitch-pipeline";
import { ffmpegHasLibass, ffmpegUsable, makeClip, useBundledCjkFont } from "./helpers/synthetic-media";

test("[ai-badge] 开关：显式开关优先；抖音默认烧；部署开关可全开；其余不烧", () => {
  const env = {};
  assert.equal(shouldBurnAiBadge({ platform: "douyin", env }), true);
  assert.equal(shouldBurnAiBadge({ platform: " Douyin ", env }), true);
  assert.equal(shouldBurnAiBadge({ platform: "tiktok", env }), false);
  assert.equal(shouldBurnAiBadge({ platform: null, env }), false);
  assert.equal(shouldBurnAiBadge({ env }), false);
  /// 显式开关两头都说了算
  assert.equal(shouldBurnAiBadge({ platform: "tiktok", explicit: true, env }), true);
  assert.equal(shouldBurnAiBadge({ platform: "douyin", explicit: false, env }), false);
  assert.equal(shouldBurnAiBadge({ platform: "douyin", explicit: null, env }), true);
  /// 部署级开关
  assert.equal(shouldBurnAiBadge({ platform: "tiktok", env: { AI_BADGE_BURN_IN: "1" } }), true);
  assert.equal(shouldBurnAiBadge({ platform: "tiktok", env: { AI_BADGE_BURN_IN: "TRUE" } }), true);
  assert.equal(shouldBurnAiBadge({ platform: "tiktok", env: { AI_BADGE_BURN_IN: "0" } }), false);
  assert.equal(
    shouldBurnAiBadge({ platform: "tiktok", explicit: false, env: { AI_BADGE_BURN_IN: "1" } }),
    false,
  );
});

test("[ai-badge] 角标文字、字体与落点：字号按短边 9%，抖音竖版让开顶部页签", () => {
  assert.equal(AI_BADGE_TEXT, "AI生成");
  assert.equal(AI_BADGE_FONT_FAMILY, CJK_FONT_FAMILY);
  const generic = aiBadgeGeometry({ width: 1080, height: 1920 });
  const douyin = aiBadgeGeometry({ width: 1080, height: 1920, platform: "douyin" });
  assert.equal(generic.fontSize, 97);
  assert.equal(douyin.fontSize, 97);
  assert.equal(generic.x, douyin.x);
  /// 抖音：顶部 10% 是「关注 / 推荐」页签
  assert.ok(douyin.y > 1920 * 0.1, `douyin y ${douyin.y}`);
  assert.ok(generic.y < 1920 * 0.06, `generic y ${generic.y}`);
  /// 横版没有顶部遮挡
  assert.ok(aiBadgeGeometry({ width: 1920, height: 1080, platform: "douyin" }).y < 1080 * 0.08);

  const ass = renderAiBadgeAss({ width: 1080, height: 1920, platform: "douyin" });
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, new RegExp(`Style: AiBadge,${CJK_FONT_FAMILY},97,`));
  /// 一条 Dialogue 从第 0 帧铺到片尾
  const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogues.length, 1);
  assert.match(dialogues[0], /^Dialogue: 9,0:00:00\.00,9:59:59\.99,AiBadge,/);
  assert.ok(dialogues[0].endsWith(`{\\an7\\pos(${douyin.x},${douyin.y})}AI生成`));
  /// 自定义文字里的 ASS 控制符被剥掉
  assert.ok(renderAiBadgeAss({ width: 1080, height: 1920, text: "AI{\\b1}生成\n" }).includes("}AIb1生成\n"));
});

test("[ai-badge] 滤镜图：不开角标与之前逐字节一致；开了叠在字幕之后", () => {
  const base = {
    clips: [{ videoInput: 0, audioInput: 0, frames: 48, samples: 88200 }],
    width: 1080,
    height: 1920,
    fps: "24",
    audioPlanFilter: null,
    audioPlanOutput: null,
  };
  const ass = { path: "/tmp/work/captions.ass", fontsDir: "/fonts" };
  const badgeAss = { path: "/tmp/work/ai-badge.ass", fontsDir: "/fonts" };

  const plain = buildTimelineFilterGraph({ ...base, ass: null });
  assert.equal(plain.videoLabel, "[vcat]");
  assert.deepEqual(buildTimelineFilterGraph({ ...base, ass: null, badgeAss: null }), plain);
  assert.doesNotMatch(plain.filterComplex, /ai-badge|vbadge/);

  const captionsOnly = buildTimelineFilterGraph({ ...base, ass });
  assert.equal(captionsOnly.videoLabel, "[vout]");
  assert.doesNotMatch(captionsOnly.filterComplex, /vbadge/);

  const badgeOnly = buildTimelineFilterGraph({ ...base, ass: null, badgeAss });
  assert.equal(badgeOnly.videoLabel, "[vbadge]");
  assert.ok(badgeOnly.filterComplex.endsWith("[vcat]ass=filename='/tmp/work/ai-badge.ass':fontsdir='/fonts'[vbadge]"));

  const both = buildTimelineFilterGraph({ ...base, ass, badgeAss });
  assert.equal(both.videoLabel, "[vbadge]");
  assert.ok(both.filterComplex.startsWith(captionsOnly.filterComplex));
  assert.ok(both.filterComplex.endsWith("[vout]ass=filename='/tmp/work/ai-badge.ass':fontsdir='/fonts'[vbadge]"));
});

/** 抽一帧灰度图，返回亮像素（白字）的包围盒；没有亮像素返回 null */
async function brightBox(videoPath: string, seekSec: number, dir: string, name: string) {
  const framePath = path.join(dir, `${name}.png`);
  await runFfmpeg(
    ["-y", "-loglevel", "error", "-ss", seekSec.toFixed(2), "-i", videoPath, "-frames:v", "1", framePath],
    { timeoutMs: 30_000 },
  );
  const { data, info } = await sharp(framePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] > 200) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, width: info.width, height: info.height };
}

test("integration：开关开 → 整条成片（含末帧）左上角都有角标，字高不低于短边 5%；关 → 画面干净", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  if (!(await ffmpegHasLibass())) return t.skip("ffmpeg has no libass");
  useBundledCjkFont(t);
  const dir = mkdtempSync(path.join(tmpdir(), "ai-badge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /// 纯黑底：画面里唯一的亮像素只可能是角标的白字
  const clip = await makeClip(path.join(dir, "black.mp4"), {
    durationSec: 2,
    audio: { kind: "tone", hz: 440, speechSec: 1.5 },
    color: "black",
  });
  const compose = (name: string, options: { platform?: string; aiBadge?: boolean }) =>
    composeTimeline({
      clips: [{ path: clip, intendedDurationSec: null, trimToFit: false }],
      aspectRatio: "9:16",
      postProduction: null,
      workDir: path.join(dir, name),
      outputName: `${name}.mp4`,
      ...options,
    });

  const off = await compose("off", { platform: "tiktok" });
  assert.equal(off.applied.aiBadge, false);
  assert.equal(await brightBox(off.videoPath, 0.5, dir, "off"), null);

  const on = await compose("on", { platform: "douyin" });
  assert.equal(on.applied.aiBadge, true);
  const geometry = aiBadgeGeometry({ width: 1080, height: 1920, platform: "douyin" });
  for (const [name, seek] of [["first", 0], ["last", 1.9]] as const) {
    const box = await brightBox(on.videoPath, seek, dir, `on-${name}`);
    assert.ok(box, `${name} 帧没有角标`);
    assert.equal(box.width, 1080);
    const glyphHeight = box.maxY - box.minY + 1;
    /// 国标：文字高度不低于画面最短边的 5%
    assert.ok(glyphHeight >= 1080 * 0.05, `${name} 帧字高 ${glyphHeight}px < ${1080 * 0.05}px`);
    /// 左上角、在抖音顶部页签之下、不进右侧按钮列
    assert.ok(box.minX >= geometry.x - 4 && box.minX < 1080 * 0.12, `${name} minX ${box.minX}`);
    assert.ok(box.minY >= 1920 * 0.1, `${name} minY ${box.minY}`);
    assert.ok(box.maxY < 1920 * 0.2, `${name} maxY ${box.maxY}`);
    assert.ok(box.maxX < 1080 * 0.5, `${name} maxX ${box.maxX}`);
  }

  /// 显式开关：非抖音平台也能烧；抖音平台也能显式关
  const explicitOn = await compose("explicit-on", { platform: "tiktok", aiBadge: true });
  assert.equal(explicitOn.applied.aiBadge, true);
  assert.ok(await brightBox(explicitOn.videoPath, 0.5, dir, "explicit-on"));
  const explicitOff = await compose("explicit-off", { platform: "douyin", aiBadge: false });
  assert.equal(explicitOff.applied.aiBadge, false);
  assert.equal(await brightBox(explicitOff.videoPath, 0.5, dir, "explicit-off"), null);
});
