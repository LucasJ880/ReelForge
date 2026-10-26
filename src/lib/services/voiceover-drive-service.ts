import { findCapability, isBlockingStatus, type PublicCapabilities } from "@/lib/capabilities/registry";
import { getCapabilities } from "@/lib/services/capability-status-service";
import {
  checkVoiceoverDrive,
  voiceoverDriveOf,
  type VoiceoverDriveCheck,
} from "@/lib/video-generation/voiceover-drive";
import type { VideoRouteSnapshot } from "@/lib/video-generation/video-route-registry";
import type { VoiceoverSettings } from "@/types/video-generation";

/**
 * 派发入口用：拿当前线路快照与「AI 配音」能力判断口播驱动方式能不能做。
 * native 直接放行；只有线路支持所请求的非 native 方式时才读 voice 能力。
 */
export async function evaluateVoiceoverDrive(args: {
  voiceover: Pick<VoiceoverSettings, "drive"> | null | undefined;
  routeSnapshot: VideoRouteSnapshot;
  loadCapabilities?: () => Promise<PublicCapabilities>;
}): Promise<VoiceoverDriveCheck> {
  const drive = voiceoverDriveOf(args.voiceover);
  const routeId = args.routeSnapshot.videoRouteSnapshot;
  /// 线路做不到就不必读能力表。
  const routeCheck = checkVoiceoverDrive({ drive, routeId, ttsUsable: true });
  if (drive === "native" || !routeCheck.ok) return routeCheck;
  const capabilities = await (args.loadCapabilities ?? (() => getCapabilities()))();
  const voice = findCapability(capabilities, "voice");
  return checkVoiceoverDrive({
    drive,
    routeId,
    ttsUsable: voice ? !isBlockingStatus(voice.status) : false,
  });
}
