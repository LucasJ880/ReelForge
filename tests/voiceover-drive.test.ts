import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { } from "node:test";
import {
  voiceoverSettingsSchema,
  VOICEOVER_DRIVES,
} from "../src/lib/schemas/unified-input";
import { evaluateVoiceoverDrive } from "../src/lib/services/voiceover-drive-service";
import { normalizePostProductionSettings } from "../src/lib/video-generation/generation-supervisor";
import { checkVoiceoverDrive } from "../src/lib/video-generation/voiceover-drive";
import { createVideoRouteSnapshot, VIDEO_ROUTE_IDS } from "../src/lib/video-generation/video-route-registry";
import type { UnifiedVideoGenerationRequest } from "../src/types/video-generation";

/**
 * P04-D · voiceover.drive：schema 可选（旧快照照常解析）、归一化只透传、能力闸在派发入口。
 */

const VOICEOVER = { enabled: true, voiceId: "warm-confident", language: "zh-CN", script: "先上门量尺寸，再报价。" };

function request(drive?: (typeof VOICEOVER_DRIVES)[number]): UnifiedVideoGenerationRequest {
  const voiceover = voiceoverSettingsSchema.parse(drive ? { ...VOICEOVER, drive } : VOICEOVER);
  return { language: "zh-CN", audio: { voiceover } } as UnifiedVideoGenerationRequest;
}

test("归一化：drive 原样透传（含当前线路做不到的值），缺省补 native——不在这里做能力判断", () => {
  assert.equal(normalizePostProductionSettings(request()).audio.voiceover.drive, "native");
  assert.equal(normalizePostProductionSettings(request("tts_lipsync")).audio.voiceover.drive, "tts_lipsync");
  assert.equal(normalizePostProductionSettings(request("audio_reference")).audio.voiceover.drive, "audio_reference");
  const source = readFileSync("src/lib/video-generation/generation-supervisor.ts", "utf8");
  assert.doesNotMatch(source, /checkVoiceoverDrive|evaluateVoiceoverDrive|getCapabilities/);
});

test("能力闸（纯函数）：native 在每条线路都放行；非 native 目前没有线路做得到", () => {
  for (const routeId of VIDEO_ROUTE_IDS) {
    assert.deepEqual(checkVoiceoverDrive({ drive: "native", routeId, ttsUsable: false }), { ok: true, drive: "native" });
    for (const drive of ["tts_lipsync", "audio_reference"] as const) {
      const check = checkVoiceoverDrive({ drive, routeId, ttsUsable: true });
      assert.equal(check.ok, false, `${routeId} × ${drive}`);
      assert.equal(!check.ok && check.reason, "route_unsupported");
    }
  }
});

test("能力闸（服务）：native 放行，非 native 在线路这一关就拒绝；不读能力表（配音线路 2026-11-16 删除，不再有「AI 配音」这项能力）", async () => {
  const routeSnapshot = createVideoRouteSnapshot("buddy");
  assert.equal((await evaluateVoiceoverDrive({ voiceover: undefined, routeSnapshot })).ok, true);
  assert.equal((await evaluateVoiceoverDrive({ voiceover: { drive: "native" }, routeSnapshot })).ok, true);
  for (const drive of ["tts_lipsync", "audio_reference"] as const) {
    const rejected = await evaluateVoiceoverDrive({ voiceover: { drive }, routeSnapshot });
    assert.equal(rejected.ok, false, drive);
    assert.match(!rejected.ok ? rejected.message : "", /暂不支持所选口播方式/);
  }
  const service = readFileSync("src/lib/services/voiceover-drive-service.ts", "utf8");
  assert.doesNotMatch(service, /getCapabilities|findCapability|capability-status-service/);
  /// 哪天给某条线路开了非 native 方式却没接回配音：得到「AI 配音暂不可用」，而不是静默放行
  assert.match(service, /ttsUsable: false/);
  assert.deepEqual(
    checkVoiceoverDrive({ drive: "native", routeId: routeSnapshot.videoRouteSnapshot, ttsUsable: false }),
    { ok: true, drive: "native" },
  );
});

test("dispatch：能力闸在幂等登记、扣额与供应商提交之前，返回契约内 422 VALIDATION_FAILED", () => {
  const source = readFileSync("src/app/api/video-generation/dispatch/route.ts", "utf8");
  const gate = source.indexOf("evaluateVoiceoverDrive({ voiceover, routeSnapshot: videoRouteSnapshot })");
  assert.ok(gate > 0);
  for (const later of ["claimVideoDispatchRequest({", "assertQuotaBatchForSession(", "dispatchVideoForBrief("]) {
    const at = source.indexOf(later);
    assert.ok(at > gate, `${later} 必须在能力闸之后`);
  }
  const window = source.slice(gate, gate + 400);
  assert.match(window, /dispatchErrorResponse\(422/);
  assert.match(window, /code: "VALIDATION_FAILED"/);
  /// 2026-11-16 起没有「不可用时换线路」这一步：线路快照选定后不再改写，能力闸只需要判这一次
  assert.doesNotMatch(source, /routeResolution|failedOver/);
  assert.doesNotMatch(source, /\n\s*videoRouteSnapshot = (?!selectVideoRouteSnapshot\()/, "快照只在选线路时赋值一次");
  assert.equal(source.split("evaluateVoiceoverDrive({ voiceover, routeSnapshot: videoRouteSnapshot })").length - 1, 1);
});

