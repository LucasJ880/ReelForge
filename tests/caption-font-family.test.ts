import assert from "node:assert/strict";
import test from "node:test";
import { CJK_FONT_FAMILY } from "../src/lib/media/media-fonts";
import { subtitleFontIsBundledCjk } from "../src/lib/media/media-health";
import { CAPTION_FONT_FAMILY, renderAssCaptions } from "../src/lib/video-generation/audio-post-production";

/**
 * 1025 真机验收：中文字幕在 macOS 渲染成豆腐块——ASS 样式写的 family 与打包字体不一致，
 * 探针还报了假绿灯。锁住：字幕 family = 打包字体 family；探针只认打包字体。
 */
test("字幕 ASS 样式用打包字体的真实 family", () => {
  assert.equal(CAPTION_FONT_FAMILY, CJK_FONT_FAMILY);
  const ass = renderAssCaptions([{ index: 1, startMs: 0, endMs: 1000, text: "测试字幕" }], { aspectRatio: "9:16", position: "bottom", style: "plain" });
  assert.match(ass, /^Style: Captions,Noto Sans SC,/m);
});

test("媒体探针：选中 Helvetica / 未知字体都不算通过", () => {
  assert.equal(subtitleFontIsBundledCjk("/System/Library/Fonts/Helvetica.ttc"), false);
  assert.equal(subtitleFontIsBundledCjk(null), false);
  assert.equal(subtitleFontIsBundledCjk("NotoSansSC-Regular"), true);
  assert.equal(subtitleFontIsBundledCjk("/var/task/node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf"), true);
});
