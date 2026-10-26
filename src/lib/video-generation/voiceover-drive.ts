import type { VideoRouteId } from "@/lib/video-generation/video-route-registry";
import type { VoiceoverDrive, VoiceoverSettings } from "@/types/video-generation";

/**
 * P04-D · 口播驱动方式的能力闸（纯函数）。派发入口（单条 dispatch、createBatchJob）在任何提交之前调用；
 * 归一化只透传 drive，不在那里判断。
 */

/**
 * 非 native 驱动方式各自能走哪些线路。都为空 = 现在没有线路做得到：
 * tts_lipsync 等 P04-F（Sync Labs 后置对口型），audio_reference 等 P04-E（Shuyu 2.5 档参考音频）。
 */
const DRIVE_ROUTES: Record<Exclude<VoiceoverDrive, "native">, readonly VideoRouteId[]> = {
  tts_lipsync: [],
  audio_reference: [],
};

export function voiceoverDriveOf(voiceover: Pick<VoiceoverSettings, "drive"> | null | undefined): VoiceoverDrive {
  return voiceover?.drive ?? "native";
}

export type VoiceoverDriveCheck =
  | { ok: true; drive: VoiceoverDrive }
  | { ok: false; drive: VoiceoverDrive; reason: "route_unsupported" | "tts_unavailable"; message: string };

export function checkVoiceoverDrive(args: {
  drive: VoiceoverDrive;
  routeId: VideoRouteId;
  /** 当前 TTS 供应商配置齐全且「AI 配音」能力没有暂停 */
  ttsUsable: boolean;
}): VoiceoverDriveCheck {
  const { drive } = args;
  if (drive === "native") return { ok: true, drive };
  if (!DRIVE_ROUTES[drive].includes(args.routeId)) {
    return {
      ok: false,
      drive,
      reason: "route_unsupported",
      message: "当前视频线路暂不支持所选口播方式，请改用「视频原生口播」后重试。",
    };
  }
  if (!args.ttsUsable) {
    return {
      ok: false,
      drive,
      reason: "tts_unavailable",
      message: "AI 配音暂不可用，所选口播方式无法生成，请改用「视频原生口播」或稍后再试。",
    };
  }
  return { ok: true, drive };
}
