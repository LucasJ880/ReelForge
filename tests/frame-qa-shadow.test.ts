/**
 * 4.4 帧质检影子检查：黑边（cropdetect）与近静止（freezedetect）。只记录不拦截。
 *
 * 解析逻辑是纯函数；集成用例在本机有 ffmpeg 时用 lavfi 合成素材验证真实滤镜输出。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { probeMedia, runFfmpeg } from "../src/lib/media/ffmpeg-bin";
import {
  BLACK_BAR_RATIO_THRESHOLD,
  NEAR_STATIC_RATIO_THRESHOLD,
  parseCropdetect,
  parseFreezedetect,
  runFrameQaShadowChecks,
  shadowFilterChain,
} from "../src/lib/media/frame-qa-shadow";

test("[shadow] cropdetect：取最后一条（累计最大区域）算上下黑边比例", () => {
  const stderr = [
    "[Parsed_cropdetect_0 @ 0x1] x1:0 x2:719 y1:200 y2:1079 w:720 h:880 x:0 y:200 pts:1 t:0.04 limit:0.094118 crop=720:880:0:200",
    "[Parsed_cropdetect_0 @ 0x1] x1:0 x2:719 y1:140 y2:1139 w:720 h:1000 x:0 y:140 pts:2 t:0.08 limit:0.094118 crop=720:1000:0:140",
  ].join("\n");
  const result = parseCropdetect(stderr, { width: 720, height: 1280 });
  assert.ok(result);
  assert.equal(result.cropHeight, 1000);
  assert.equal(result.verticalBarRatio, 0.2188);
  assert.equal(result.horizontalBarRatio, 0);
  assert.equal(result.detected, true);
  assert.equal(result.threshold, BLACK_BAR_RATIO_THRESHOLD);
});

test("[shadow] cropdetect：满幅 / 舍入误差内不算黑边；全黑片 / 无输出不下结论", () => {
  const full = parseCropdetect("crop=720:1280:0:0", { width: 720, height: 1280 });
  assert.equal(full?.detected, false);
  const rounding = parseCropdetect("crop=718:1276:0:2", { width: 720, height: 1280 });
  assert.equal(rounding?.detected, false);
  assert.equal(parseCropdetect("crop=-704:-1264:712:1272", { width: 720, height: 1280 }), null);
  assert.equal(parseCropdetect("", { width: 720, height: 1280 }), null);
  assert.equal(parseCropdetect("crop=720:1280:0:0", { width: 0, height: 0 }), null);
});

test("[shadow] freezedetect：成对区间累加，最后一段没有 end 视为冻结到片尾", () => {
  const stderr = [
    "[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 1",
    "[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 3",
    "[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 4",
    "[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 9",
  ].join("\n");
  const result = parseFreezedetect(stderr, 15);
  assert.ok(result);
  assert.equal(result.frozenSec, 9);
  assert.equal(result.ratio, 0.6);
  assert.equal(result.detected, true);
  assert.equal(result.threshold, NEAR_STATIC_RATIO_THRESHOLD);

  const moving = parseFreezedetect("no freeze lines", 15);
  assert.equal(moving?.ratio, 0);
  assert.equal(moving?.detected, false);
  assert.equal(parseFreezedetect("", 0), null);
});

test("[shadow] 滤镜参数固定（阈值改动要同步校准说明）", () => {
  assert.equal(
    shadowFilterChain(),
    "cropdetect=limit=24:round=2:reset=0,freezedetect=n=-50dB:d=1",
  );
});

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await runFfmpeg(["-hide_banner", "-version"], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

test("integration: 真实 ffmpeg 检出上下黑边与整段静止，运动画面不误报", async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip("ffmpeg not installed");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "frame-qa-shadow-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  /// 运动画面 + 上下各 84px 黑边（共 29.6%）
  const letterboxed = path.join(dir, "letterboxed.mp4");
  await runFfmpeg([
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=s=320x400:d=3:r=24",
    "-vf", "pad=320:568:0:84:black",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", letterboxed,
  ]);
  /// 整段纯色 = 完全静止
  const frozen = path.join(dir, "frozen.mp4");
  await runFfmpeg([
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=gray:s=320x568:d=3:r=24",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", frozen,
  ]);

  const lbProbe = await probeMedia(letterboxed);
  const lb = await runFrameQaShadowChecks(letterboxed, lbProbe);
  assert.equal(lb.error, undefined);
  assert.equal(lb.blackBars?.detected, true, JSON.stringify(lb.blackBars));
  assert.ok((lb.blackBars?.verticalBarRatio ?? 0) > 0.25);
  assert.equal(lb.nearStatic?.detected, false, JSON.stringify(lb.nearStatic));

  const frProbe = await probeMedia(frozen);
  const fr = await runFrameQaShadowChecks(frozen, frProbe);
  assert.equal(fr.nearStatic?.detected, true, JSON.stringify(fr.nearStatic));
  assert.ok((fr.nearStatic?.ratio ?? 0) > 0.9);

  /// 输入坏掉：只落 error，不 throw
  const broken = await runFrameQaShadowChecks(path.join(dir, "missing.mp4"), {
    width: 320,
    height: 568,
    durationSec: 3,
  });
  assert.ok(broken.error);
  assert.equal(broken.blackBars, null);
});
