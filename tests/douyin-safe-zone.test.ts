/**
 * 抖音平台枚举与界面安全区：字幕让开底部约 20% 与右侧按钮列；其它平台输出不变。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { targetPlatformSchema, unifiedVideoGenerationRequestSchema } from "../src/lib/schemas/unified-input";
import { renderAssCaptions, type CaptionCue } from "../src/lib/video-generation/audio-post-production";
import {
  captionMarginsFor,
  DOUYIN_SAFE_ZONE,
  isDouyinPlatform,
  platformSafeZone,
  safeAreaNotesFor,
} from "../src/lib/video-generation/platform-safe-zone";

const cues: CaptionCue[] = [{ index: 1, text: "一拧即开，随时补水", startMs: 0, endMs: 2000 }];

function captionStyle(ass: string) {
  const line = ass.split("\n").find((row) => row.startsWith("Style: Captions,"));
  assert.ok(line);
  const fields = line.split(",");
  /// …, Alignment, MarginL, MarginR, MarginV, Encoding
  return {
    alignment: Number(fields.at(-5)),
    marginL: Number(fields.at(-4)),
    marginR: Number(fields.at(-3)),
    marginV: Number(fields.at(-2)),
  };
}

test("[douyin] 平台枚举接受 douyin，创作请求可以带 platform: douyin", () => {
  assert.equal(targetPlatformSchema.parse("douyin"), "douyin");
  assert.deepEqual(targetPlatformSchema.options, [
    "tiktok",
    "instagram_reels",
    "youtube_shorts",
    "generic_vertical",
    "douyin",
  ]);
  const parsed = unifiedVideoGenerationRequestSchema.safeParse({
    userType: "business",
    rawPrompt: "给保温杯拍一条 15 秒的抖音广告",
    attachments: [],
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
    platform: "douyin",
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.equal(targetPlatformSchema.safeParse("kuaishou").success, false);
});

test("[douyin] 安全区：底部 20%、右侧按钮列 14%、顶部 10%；只有抖音有专门规则", () => {
  assert.deepEqual(DOUYIN_SAFE_ZONE, { topRatio: 0.1, bottomRatio: 0.2, rightRatio: 0.14 });
  assert.equal(isDouyinPlatform("douyin"), true);
  assert.equal(isDouyinPlatform("Douyin "), true);
  assert.equal(isDouyinPlatform("tiktok"), false);
  assert.equal(isDouyinPlatform(null), false);
  assert.equal(platformSafeZone("douyin"), DOUYIN_SAFE_ZONE);
  assert.equal(platformSafeZone("tiktok"), null);
  assert.equal(platformSafeZone(undefined), null);
});

test("[douyin] 竖版字幕边距：下边距在底部 20% 之上，右边距让开按钮列", () => {
  const bottom = captionMarginsFor({
    platform: "douyin",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    position: "bottom",
  });
  assert.ok(bottom);
  assert.ok(bottom.marginV >= 1920 * 0.2, `marginV ${bottom.marginV}`);
  assert.ok(bottom.marginV <= 1920 * 0.22, `marginV ${bottom.marginV}`);
  assert.ok(bottom.marginR >= 1080 * 0.14, `marginR ${bottom.marginR}`);
  assert.ok(bottom.marginL < bottom.marginR);

  const top = captionMarginsFor({
    platform: "douyin",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    position: "top",
  });
  assert.equal(top?.marginV, 192);

  /// 横版 / 方版在信息流里上下留黑，界面盖不到画面；其它平台没有专门规则
  for (const aspectRatio of ["16:9", "1:1"]) {
    assert.equal(
      captionMarginsFor({ platform: "douyin", aspectRatio, width: 1920, height: 1080, position: "bottom" }),
      null,
    );
  }
  assert.equal(
    captionMarginsFor({ platform: "tiktok", aspectRatio: "9:16", width: 1080, height: 1920, position: "bottom" }),
    null,
  );
});

test("[douyin] 字幕烧录：抖音用安全区边距；不传平台 / 其它平台与之前逐字节一致", () => {
  const options = { aspectRatio: "9:16" as const, position: "bottom" as const, style: "word_by_word" as const };
  const legacy = renderAssCaptions(cues, options);
  assert.deepEqual(captionStyle(legacy), { alignment: 2, marginL: 80, marginR: 80, marginV: 150 });
  assert.equal(renderAssCaptions(cues, { ...options, platform: null }), legacy);
  assert.equal(renderAssCaptions(cues, { ...options, platform: "tiktok" }), legacy);
  assert.equal(renderAssCaptions(cues, { ...options, platform: "generic_vertical" }), legacy);

  const douyin = renderAssCaptions(cues, { ...options, platform: "douyin" });
  const style = captionStyle(douyin);
  assert.equal(style.alignment, 2);
  assert.ok(style.marginV >= 384, `marginV ${style.marginV}`);
  assert.ok(style.marginR >= 151, `marginR ${style.marginR}`);
  /// 只改边距，其余（字号、事件）不变
  assert.equal(
    douyin.replace(`,${style.marginL},${style.marginR},${style.marginV},1`, ",80,80,150,1"),
    legacy,
  );
  /// karaoke 样式行同样带安全区边距
  const karaoke = renderAssCaptions(
    [{ ...cues[0], words: [{ text: "一拧即开", startMs: 0, endMs: 1000 }, { text: "随时补水", startMs: 1000, endMs: 2000 }] }],
    { ...options, style: "karaoke", platform: "douyin", language: "zh-CN" },
  );
  const karaokeLine = karaoke.split("\n").find((row) => row.startsWith("Style: Karaoke,"));
  assert.ok(karaokeLine?.endsWith(`,${style.marginL},${style.marginR},${style.marginV},1`));
  /// 横版抖音不改
  assert.equal(
    renderAssCaptions(cues, { ...options, aspectRatio: "16:9", platform: "douyin" }),
    renderAssCaptions(cues, { ...options, aspectRatio: "16:9" }),
  );
});

test("[douyin] 导演方案的安全区说明按平台走，合成器把订单的目标平台交给管线", () => {
  assert.equal(safeAreaNotesFor("tiktok"), "Keep captions inside the central 80% to clear TikTok UI overlays.");
  assert.equal(safeAreaNotesFor(null), safeAreaNotesFor("tiktok"));
  const douyin = safeAreaNotesFor("douyin");
  assert.match(douyin, /bottom 20%/);
  assert.match(douyin, /right-hand 14%/);
  assert.match(douyin, /Douyin/);

  const director = readFileSync("src/lib/services/director-service.ts", "utf8");
  assert.match(director, /safeAreaNotes: safeAreaNotesFor\(ctx\.targetPlatform\)/);
  assert.doesNotMatch(director, /central 80% to clear TikTok/);

  const composer = readFileSync("src/lib/services/stitch-composer.ts", "utf8");
  assert.match(composer, /deliveryOrder: \{ select: \{ productInput: true, targetPlatform: true \} \}/);
  /// b-roll / assembly / legacy 三条分支都带上平台
  assert.equal(composer.match(/^\s+platform,$/gm)?.length, 3);
  const pipeline = readFileSync("src/lib/media/stitch-pipeline.ts", "utf8");
  assert.match(pipeline, /platform: input\.platform \?\? null/);
  assert.match(pipeline, /shouldBurnAiBadge\(\{ platform: input\.platform, explicit: input\.aiBadge \}\)/);
});
