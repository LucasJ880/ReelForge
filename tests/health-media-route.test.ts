/**
 * 4.6 GET /api/health/media：handler 内 fail-closed 机器鉴权 + 合成探针。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  GET,
  createHealthMediaHandler,
  maxDuration,
} from "../src/app/api/health/media/route";
import {
  MEDIA_PROBE_SUBTITLE_TEXT,
  parseLibassFontLog,
  runMediaHealthProbe,
  type MediaHealthReport,
} from "../src/lib/media/media-health";
import { runFfmpeg } from "../src/lib/media/ffmpeg-bin";

function request(query = "", authorization?: string) {
  return new NextRequest(`http://localhost/api/health/media${query}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

function withSecret<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  return fn().finally(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
}

function fakeReport(ok: boolean): MediaHealthReport {
  return {
    ok,
    checkedAt: "2026-10-25T00:00:00.000Z",
    ffmpeg: { path: "/var/task/node_modules/ffmpeg-static/ffmpeg", source: "ffmpeg-static", version: "ffmpeg version 6.1.1" },
    fonts: { fontFile: "/var/task/x.ttf", fontSource: "bundled", fontconfigFile: "/tmp/fonts.conf", fontconfigSource: "generated" },
    bgm: { path: "scripts/assets/pet-kit-bgm.mp3", present: true, bytes: 1 },
    probe: {
      endCard: { ok: true, ms: 1, bytes: 10 },
      synthesis: { ok, ms: 1, bytes: 20, subtitlesBurned: ok, subtitleFont: null, missingGlyphs: 0 },
      outputBytes: 20,
    },
  };
}

test("[health/media] CRON_SECRET 缺失 → 503 fail closed，且不跑探针", async () => {
  let ran = false;
  const handler = createHealthMediaHandler({
    runMediaHealthProbe: async () => {
      ran = true;
      return { report: fakeReport(true), frameJpeg: null };
    },
  });
  const response = await withSecret(undefined, () => handler(request()));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /CRON_SECRET|ffmpeg/i);
  assert.equal(ran, false);
});

test("[health/media] 错误 bearer → 401；默认导出的 GET 同样守卫", async () => {
  const handler = createHealthMediaHandler({
    runMediaHealthProbe: async () => {
      throw new Error("must not run");
    },
  });
  await withSecret("machine-secret", async () => {
    assert.equal((await handler(request("", "Bearer wrong"))).status, 401);
    assert.equal((await GET(request("", "Bearer wrong"))).status, 401);
    assert.equal((await GET(request())).status, 401);
  });
});

test("[health/media] 鉴权通过：全部通过 200，探针失败 503；?frame=1 返回 JPEG", async () => {
  await withSecret("machine-secret", async () => {
    const ok = createHealthMediaHandler({
      runMediaHealthProbe: async () => ({ report: fakeReport(true), frameJpeg: null }),
    });
    const okResponse = await ok(request("", "Bearer machine-secret"));
    assert.equal(okResponse.status, 200);
    const body = (await okResponse.json()) as MediaHealthReport;
    assert.equal(body.ffmpeg.version, "ffmpeg version 6.1.1");
    assert.equal(body.probe.outputBytes, 20);

    const failing = createHealthMediaHandler({
      runMediaHealthProbe: async () => ({ report: fakeReport(false), frameJpeg: null }),
    });
    assert.equal((await failing(request("", "Bearer machine-secret"))).status, 503);

    let askedFrame = false;
    const frame = createHealthMediaHandler({
      runMediaHealthProbe: async (opts) => {
        askedFrame = opts?.withFrame === true;
        return { report: fakeReport(true), frameJpeg: Buffer.from([0xff, 0xd8, 0xff]) };
      },
    });
    const frameResponse = await frame(request("?frame=1", "Bearer machine-secret"));
    assert.equal(askedFrame, true);
    assert.equal(frameResponse.status, 200);
    assert.equal(frameResponse.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await frameResponse.arrayBuffer()).length, 3);
  });
  assert.equal(maxDuration, 60);
});

test("[health/media] libass 日志解析：选中字体与缺字数", () => {
  const log = [
    "[Parsed_ass_2 @ 0x1] fontselect: (Noto Sans CJK SC, 400, 0) -> /var/task/node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf, 0, NotoSansSC-Regular",
    "[Parsed_ass_2 @ 0x1] fontselect: failed to find any fallback with glyph 0x6D4B for font: (Noto Sans CJK SC, 400, 0)",
  ].join("\n");
  assert.deepEqual(parseLibassFontLog(log), {
    subtitleFont:
      "/var/task/node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf",
    missingGlyphs: 1,
  });
  assert.deepEqual(parseLibassFontLog(""), { subtitleFont: null, missingGlyphs: 0 });
  assert.match(MEDIA_PROBE_SUBTITLE_TEXT, /[一-鿿]/);
});

test("[health/media] 探针 = 拼接器真实路径：调用 composeTimeline + 加粗字幕 + BGM，不再自带一段平行的 ffmpeg", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/lib/media/media-health.ts", "utf8");
  assert.match(source, /import \{ composeTimeline \} from "\.\/stitch-pipeline";/);
  assert.match(source, /composeTimeline\(\{/);
  assert.doesNotMatch(source, /ass=filename=/, "字幕烧录参数只住在 stitch-pipeline");
  const { mediaProbePostProduction } = await import("../src/lib/media/media-health");
  const plan = mediaProbePostProduction();
  assert.equal(plan.captions.enabled, true);
  assert.equal(plan.captions.style, "word_by_word", "加粗描边样式");
  assert.equal(plan.audio.bgm.trackId, "wholesome");
  assert.ok(plan.audio.bgm.volume > 0, "开 BGM 走闪避混音");
});

test("integration: 本机真跑探针——尾卡中文 SVG 栅格化成功，报告结构完整、永不 throw", async (t) => {
  try {
    await runFfmpeg(["-hide_banner", "-version"], { timeoutMs: 5_000 });
  } catch {
    t.skip("ffmpeg not installed");
    return;
  }
  const { report, frameJpeg } = await runMediaHealthProbe({ withFrame: true });
  assert.ok(report.ffmpeg.version?.startsWith("ffmpeg version"), report.ffmpeg.version ?? "");
  assert.equal(report.probe.endCard.ok, true, report.probe.endCard.error);
  assert.ok((report.probe.endCard.bytes ?? 0) > 1000);
  assert.equal(report.bgm.present, true);
  /// C3：探针跑的是拼接器自己的合成函数（不是一段平行的小 ffmpeg 片段）
  assert.equal(report.probe.synthesis.pipeline, "stitch-pipeline.composeTimeline");
  if (report.probe.synthesis.subtitlesBurned) {
    assert.equal(report.probe.synthesis.audioMixed, true, "加粗字幕 + BGM 闪避混音都走过");
  }
  /// 本机 ffmpeg 可能不带 libass（Homebrew 8.x 默认就没有）：此时探针必须如实报
  /// 字幕失败并给出 503，而不是假装成功；带 libass 时必须真烧出来并产出字节。
  if (report.probe.synthesis.subtitlesBurned) {
    assert.ok((report.probe.outputBytes ?? 0) > 0);
    assert.ok(frameJpeg && frameJpeg.length > 0);
  } else {
    assert.equal(report.ok, false);
    assert.match(report.probe.synthesis.error ?? "", /subtitle burn failed/);
  }
});
