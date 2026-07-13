import { NextResponse } from "next/server";
import { requireBusinessUser } from "@/lib/api-auth";
import {
  listVoices,
  DEFAULT_VOICE_ID,
} from "@/lib/video-generation/digital-human/voice-catalog";
import {
  DIGITAL_HUMAN_SEALED_RESPONSE,
  isDigitalHumanFeatureEnabled,
} from "@/lib/features/digital-human";

/** 预置中文音色目录。 */
export async function GET() {
  if (!isDigitalHumanFeatureEnabled()) {
    return NextResponse.json(DIGITAL_HUMAN_SEALED_RESPONSE, { status: 404 });
  }
  const guard = await requireBusinessUser();
  if (!guard.ok) return guard.response;

  const voices = listVoices().map((v) => ({
    id: v.id,
    name: v.name,
    gender: v.gender,
    description: v.description,
    sampleUrl: v.sampleUrl ?? null,
  }));
  return NextResponse.json({ voices, defaultVoiceId: DEFAULT_VOICE_ID });
}
