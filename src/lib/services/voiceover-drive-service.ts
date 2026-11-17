import {
  checkVoiceoverDrive,
  voiceoverDriveOf,
  type VoiceoverDriveCheck,
} from "@/lib/video-generation/voiceover-drive";
import type { VideoRouteSnapshot } from "@/lib/video-generation/video-route-registry";
import type { VoiceoverSettings } from "@/types/video-generation";

/**
 * 派发入口用：拿当前线路快照判断口播驱动方式能不能做。native 直接放行。
 *
 * 配音（TTS）线路 2026-11-16 删除，「AI 配音」不再是一项能力：非 native 的驱动方式现在没有线路做得到
 * （voiceover-drive.ts 的 DRIVE_ROUTES 全空），一律在线路这一关就拒绝；这里把 ttsUsable 固定为 false，
 * 哪天给某条线路开了非 native 方式却没接回配音，会得到「AI 配音暂不可用」而不是静默放行。
 * 保持 async：两个调用方（单条 dispatch、createBatchJob）都在 await。
 */
export async function evaluateVoiceoverDrive(args: {
  voiceover: Pick<VoiceoverSettings, "drive"> | null | undefined;
  routeSnapshot: VideoRouteSnapshot;
}): Promise<VoiceoverDriveCheck> {
  return checkVoiceoverDrive({
    drive: voiceoverDriveOf(args.voiceover),
    routeId: args.routeSnapshot.videoRouteSnapshot,
    ttsUsable: false,
  });
}
