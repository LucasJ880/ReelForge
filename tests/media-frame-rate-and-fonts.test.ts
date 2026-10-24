/**
 * 4.5 拼接保留源帧率 + 4.2 中文字体 / fontconfig 的纯逻辑回归。
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  FALLBACK_STITCH_FPS,
  normalizeFrameRate,
  pickStitchFrameRate,
} from "../src/lib/media/frame-rate";
import {
  BUNDLED_CJK_FONT_CANDIDATES,
  CJK_FONT_FAMILY,
  __test__ as fontsTest,
  buildFontconfigXml,
  resolveCjkFontFile,
} from "../src/lib/media/media-fonts";

test("[frame-rate] 各种写法规范成 ffmpeg 可用的帧率", () => {
  assert.equal(normalizeFrameRate(24), "24");
  assert.equal(normalizeFrameRate("24/1"), "24");
  assert.equal(normalizeFrameRate("25"), "25");
  assert.equal(normalizeFrameRate(23.98), "24000/1001");
  assert.equal(normalizeFrameRate("30000/1001"), "30000/1001");
  assert.equal(normalizeFrameRate(29.97), "30000/1001");
  assert.equal(normalizeFrameRate(59.94), "60000/1001");
  assert.equal(normalizeFrameRate(12.5), "12.5");
});

test("[frame-rate] 非法 / 越界值返回 null（不把 tbn 之类的垃圾当帧率）", () => {
  for (const bad of [null, undefined, "", "0/0", "abc", 0, 2, 90000, "90000/1", Number.NaN]) {
    assert.equal(normalizeFrameRate(bad as never), null, String(bad));
  }
});

test("[frame-rate] 拼接帧率取第一段（主片）的源帧率，不再强转 30", () => {
  assert.equal(pickStitchFrameRate([24, 30]), "24");
  assert.equal(pickStitchFrameRate([null, "25/1"]), "25");
  assert.equal(pickStitchFrameRate([]), FALLBACK_STITCH_FPS);
  assert.equal(pickStitchFrameRate([null, undefined]), "30");
});

test("[media-fonts] 字体查找：MEDIA_CJK_FONT_FILE 优先，其次仓库内置，再其次 npm 包", () => {
  const cwd = "/var/task";
  const npmFont = path.join(cwd, BUNDLED_CJK_FONT_CANDIDATES[2]);
  assert.deepEqual(
    resolveCjkFontFile({
      env: { MEDIA_CJK_FONT_FILE: "/fonts/custom.otf" },
      cwd,
      exists: () => true,
    }),
    { file: "/fonts/custom.otf", source: "env" },
  );
  assert.deepEqual(
    resolveCjkFontFile({ env: {}, cwd, exists: (p) => p === npmFont }),
    { file: npmFont, source: "bundled" },
  );
  assert.equal(resolveCjkFontFile({ env: {}, cwd, exists: () => false }), null);
  /// 打包路径必须与 next.config.ts 的 outputFileTracingIncludes 一致
  assert.equal(
    BUNDLED_CJK_FONT_CANDIDATES[2],
    "node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf",
  );
});

test("[media-fonts] fonts.conf：字体目录 + /tmp 缓存 + 渲染代码用到的 family 全部别名到 Noto Sans SC", () => {
  const xml = buildFontconfigXml({
    fontDirs: ["/var/task/node_modules/@expo-google-fonts/noto-sans-sc/400Regular"],
    cacheDir: "/tmp/aivora-fontconfig/cache",
  });
  assert.match(xml, /<dir>\/var\/task\/node_modules\/@expo-google-fonts\/noto-sans-sc\/400Regular<\/dir>/);
  assert.match(xml, /<cachedir>\/tmp\/aivora-fontconfig\/cache<\/cachedir>/);
  /// ASS 样式写的是 Noto Sans CJK SC，尾卡 SVG 写 Helvetica / Arial
  for (const family of ["Noto Sans CJK SC", "Helvetica", "Arial", "sans-serif"]) {
    assert.ok(fontsTest.FAMILY_ALIASES.includes(family), family);
    assert.ok(
      xml.includes(`<family>${family}</family><prefer><family>${CJK_FONT_FAMILY}</family></prefer>`),
      family,
    );
  }
  /// 路径里的 XML 特殊字符必须转义
  const escaped = buildFontconfigXml({ fontDirs: ["/a&b<c>"], cacheDir: "/tmp/x" });
  assert.match(escaped, /<dir>\/a&amp;b&lt;c&gt;<\/dir>/);
});
