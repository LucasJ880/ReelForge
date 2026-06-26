import { NextResponse } from "next/server";
import { requireBusinessUser } from "@/lib/api-auth";
import {
  listVoices,
  DEFAULT_VOICE_ID,
} from "@/lib/video-generation/digital-human/voice-catalog";

/** 预置中文音色目录。 */
export async function GET() {
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
