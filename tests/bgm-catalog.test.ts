import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BgmPicker } from "../src/components/video-generation/bgm-picker";
import { BGM_BUNDLE_FILES, BGM_CATALOG, BGM_TRACK_IDS, isBgmTrackId } from "../src/lib/video-generation/bgm-catalog";
import { BGM_TRACKS } from "../src/lib/video-generation/audio-post-production";
import { bgmSettingsSchema } from "../src/lib/schemas/unified-input";
import { resolvePostProductionEffects } from "../src/lib/media/stitch-pipeline";
import type { PostProductionPlan } from "../src/types/video-generation";

/**
 * 2026-11-10 配乐曲库从 1 首扩到 8 首（7 首由 Runway 生成配乐接口一次性生成、随仓库带）。
 * 守住：目录是唯一来源；每首曲子的文件真的在、会被打进合成函数；新曲目不会被悄悄静音。
 */
test("目录：第一项是不加音乐；id 不重复；每首曲子的文件都在仓库里", () => {
  assert.equal(BGM_CATALOG[0].id, "none");
  assert.equal(BGM_CATALOG[0].path, null);
  assert.equal(new Set(BGM_TRACK_IDS).size, BGM_TRACK_IDS.length);
  assert.equal(BGM_CATALOG.filter((track) => track.path).length, 8);
  for (const track of BGM_CATALOG) {
    assert.ok(track.zh && track.en, `${track.id} 缺名字`);
    if (!track.path) continue;
    assert.ok(existsSync(track.path), `${track.id} 的文件不在：${track.path}`);
    const size = statSync(track.path).size;
    assert.ok(size > 100_000 && size < 3_000_000, `${track.id} 文件大小异常：${size}`);
    assert.ok(track.mood.zh && track.mood.en, `${track.id} 缺气质说明`);
  }
});

test("能试听的曲子：试听地址就是 public 下的同一个文件（听到的就是会混进成片的那一首）", () => {
  const previewable = BGM_CATALOG.filter((track) => track.previewUrl);
  assert.equal(previewable.length, 7);
  for (const track of previewable) {
    assert.equal(`public${track.previewUrl}`, track.path, track.id);
  }
});

test("打包：目录里的每个文件都被 next.config 的两条清单盖住；合成函数带着它们", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /const BGM_FILES = \["\.\/scripts\/assets\/pet-kit-bgm\.mp3", "\.\/public\/audio\/bgm\/\*\.mp3"\];/);
  for (const file of BGM_BUNDLE_FILES) {
    const covered = file === "./scripts/assets/pet-kit-bgm.mp3" || /^\.\/public\/audio\/bgm\/[a-z0-9-]+\.mp3$/.test(file);
    assert.ok(covered, `${file} 不在 next.config 的打包清单里：线上合成会找不到文件`);
  }
  assert.match(config, /"\/api\/cron\/stitch-dispatch": MEDIA_RENDER_FILES,/);
});

test("校验与类型都从目录取：新曲目能通过入参校验，认不出的 id 被拒", () => {
  assert.equal(isBgmTrackId("warm-acoustic"), true);
  assert.equal(isBgmTrackId("wholesome"), true);
  assert.equal(isBgmTrackId("constructor"), false);
  assert.equal(isBgmTrackId(null), false);
  const schema = readFileSync("src/lib/schemas/unified-input.ts", "utf8");
  assert.match(schema, /trackId: z\.enum\(BGM_TRACK_IDS\),/);
  assert.doesNotMatch(schema, /z\.enum\(\["none", "wholesome"\]\)/);
  const audio = (trackId: string) => bgmSettingsSchema.safeParse({ trackId, volume: 0.2 });
  assert.equal(audio("warm-acoustic").success, true);
  assert.equal(audio("modern-pulse").success, true);
  assert.equal(audio("no-such-track").success, false);
  assert.deepEqual(BGM_TRACKS.map((track) => track.id), [...BGM_TRACK_IDS]);
});

test("合成器认得新曲目；音量上限不再只认最早那一首", () => {
  const plan = (trackId: string, volume: number) =>
    ({
      audio: { voiceover: { enabled: true, voiceId: "warm-confident", language: "zh-CN", script: "今天试试这只杯子。" }, bgm: { trackId, volume } },
      captions: { enabled: false, style: "plain", language: "zh-CN", position: "bottom", exportSrt: false },
    }) as unknown as PostProductionPlan;
  const effects = resolvePostProductionEffects(plan("lofi-chill", 0.2));
  assert.equal(effects.bgmPath, "public/audio/bgm/lofi-chill.mp3");
  assert.equal(effects.bgmVolume, 0.2);
  assert.equal(resolvePostProductionEffects(plan("none", 0.2)).bgmPath, null);
  assert.equal(resolvePostProductionEffects(plan("lofi-chill", 0)).bgmPath, null, "音量为 0 = 不混");
  /// 认不出的曲目：合成器照旧明确报错（不悄悄交付一条没有配乐的成片）；入参校验在更前面就拦住了
  assert.throws(() => resolvePostProductionEffects(plan("no-such-track", 0.2)), /BGM_TRACK_UNKNOWN/);
  const supervisor = readFileSync("src/lib/video-generation/generation-supervisor.ts", "utf8");
  assert.match(supervisor, /bgm && bgm\.trackId !== "none"\s+\? Math\.min\(0\.35, Math\.max\(0, bgm\.volume\)\)/);
  assert.doesNotMatch(supervisor, /bgm\?\.trackId === "wholesome"/, "只认一首会把新曲目的音量压成 0");
});

test("两处选曲界面共用同一个组件，曲目从目录列出", () => {
  /// 原来没配乐的成片音量是 0：选了曲子要给起始音量，否则「选了等于没选」
  const restitch = readFileSync("src/components/library/restitch-form.tsx", "utf8");
  assert.match(restitch, /if \(next !== "none" && bgmVolume === 0\) setBgmVolume\(DEFAULT_BGM_VOLUME\);/);
  const picker = readFileSync("src/components/video-generation/bgm-picker.tsx", "utf8");
  assert.match(picker, /BGM_CATALOG\.map\(\(track\) => \(\s*<option key=\{track\.id\} value=\{track\.id\}>/);
  assert.match(picker, /data-testid="bgm-preview"/);
  for (const file of ["src/components/video-generation/audio-caption-controls.tsx", "src/components/library/restitch-form.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<BgmPicker/, file);
    assert.doesNotMatch(source, /<option value="wholesome">/, `${file} 不再手写曲目`);
  }
});

test("选曲组件：选中的曲目显示气质说明和试听；不加音乐与没有试听文件的曲目不出试听钮", () => {
  const render = (value: Parameters<typeof BgmPicker>[0]["value"], english = false) =>
    renderToStaticMarkup(createElement(BgmPicker, { value, english, selectClassName: "x", onChange: () => {} }));
  const lofi = render("lofi-chill");
  assert.match(lofi, /电钢琴加慵懒鼓点，松弛、居家/);
  assert.match(lofi, /data-testid="bgm-preview"/);
  assert.match(lofi, /试听/);
  assert.match(lofi, /<audio[^>]*src="\/audio\/bgm\/lofi-chill\.mp3"/);
  assert.equal((lofi.match(/<option/g) ?? []).length, BGM_CATALOG.length, "曲目全部列出");
  const none = render("none");
  assert.doesNotMatch(none, /data-testid="bgm-preview"/);
  assert.doesNotMatch(none, /<audio/);
  const wholesome = render("wholesome");
  assert.match(wholesome, /发布时需要署名/);
  assert.doesNotMatch(wholesome, /data-testid="bgm-preview"/, "最早那一首不在 public 下，没有试听");
  assert.match(render("upbeat-pop", true), /Preview/);
});
